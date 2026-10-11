# -*- coding: utf-8 -*-
"""外部 AI 调用适配器（2026-09-18 模块库清档）。
- 模型：OpenAI 兼容 /chat/completions（流式 + 非流式）
- n8n：直调 webhook（独立函数，不依赖 recipe）
- 多模态：图片引用（/static/xxx | data URL）→ base64 data URL
- 本地地址：自动绕过系统代理（Ollama 救命代码，保留）
- Ollama 未启动自动拉起
"""
import base64
import datetime
import hashlib
import json
import mimetypes
import os
import re
import socket
import subprocess
import shutil
import time
import uuid
import urllib.error
import urllib.request
import atexit
from urllib.parse import urlparse

from . import db

REQUEST_TIMEOUT = 300  # 本地模型首启到 GPU 可能 200 秒
_OLLAMA_CHILD = None

def stop_owned_ollama():
    """只停止由轻舟本次自动拉起的 Ollama，不影响用户手动运行的实例。"""
    global _OLLAMA_CHILD
    p, _OLLAMA_CHILD = _OLLAMA_CHILD, None
    if not p or p.poll() is not None:
        return
    try:
        p.terminate()
        p.wait(timeout=5)
    except Exception:
        try:
            p.kill()
        except Exception:
            pass

atexit.register(stop_owned_ollama)

# agent 会话流（长连接，不会自己关）——本地不设任何"任务长度闸门"：
# 只要上游还在产出事件，读多久都不限制；静默/断流只触发"重开事件流续读"
# （上游会回放历史事件，按时间戳 + 事件签名去重跳过已收部分），任务本身不受影响。
# 唯一的收尾条件：上游终止信号 / 连接彻底重连不上 / 连续多轮零新事件（判定上游失联）。
# 以下数值全部可用环境变量覆盖；0 表示不启用对应限制/判定。
def _env_int(name, default):
    try:
        return int(str(os.environ.get(name, "")).strip() or default)
    except (TypeError, ValueError):
        return default

FIRST_EVENT_TIMEOUT = _env_int("AIBO_AGENT_FIRST_TIMEOUT", 300)    # 单连接等首个事件（秒）：纯心跳探测，触发续读，不终止任务
IDLE_AFTER_EVENT = _env_int("AIBO_AGENT_IDLE_TIMEOUT", 300)        # 单连接事件后空闲（秒）：同上
AGENT_TOTAL_TIMEOUT = _env_int("AIBO_AGENT_TOTAL_TIMEOUT", 0)      # 单轮总上限（秒）。0 = 不设上限（默认）
AGENT_MAX_RESUMES = _env_int("AIBO_AGENT_MAX_RESUMES", 0)          # 续读重开次数上限。0 = 不限（默认）
AGENT_EMPTY_ROUNDS = _env_int("AIBO_AGENT_EMPTY_ROUNDS", 3)        # 连续零新事件轮数 → 判定上游失联收尾。0 = 不判定（慎用）
N8N_TIMEOUT = _env_int("AIBO_N8N_TIMEOUT", 300)                    # n8n webhook 等待（秒）：一次性 POST 无流可续，必须有限值
HISTORY_CHAR_LIMIT = _env_int("AIBO_HISTORY_CHARS", 2000)  # 每条历史消息最大字符数，超出截断（可用环境变量调整）
# 注意：urllib 的 socket 一旦 read 超时就废了（再读必抛
# "cannot read from timed out object"），所以**不能**用"短超时 + 重试"来做心跳，
# 只能整条连接作废后重开新连接续读；等待期间的进度由前端自己计时显示。


def _is_local_url(base_url):
    return any(x in (base_url or "").lower() for x in ("localhost", "127.0.0.1", "[::1]"))


def _port_open(host, port, timeout=2):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


def _open(req, timeout):
    url = getattr(req, "full_url", "") or ""
    if _is_local_url(url):
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        return opener.open(req, timeout=timeout)
    return urllib.request.urlopen(req, timeout=timeout)


# ---------- Ollama 自动启 ----------
OLLAMA_CANDIDATES = [
    os.environ.get("OLLAMA_PATH", ""),
    os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Ollama", "ollama.exe"),
    r"C:\Program Files\Ollama\ollama.exe",
]


def _find_ollama_exe():
    # 先查 PATH，避免 Ollama 安装在非默认目录时只能依赖桌面程序已打开。
    candidates = [shutil.which("ollama"), *OLLAMA_CANDIDATES,
                  os.path.join(os.environ.get("ProgramW6432", ""), "Ollama", "ollama.exe"),
                  os.path.join(os.environ.get("ProgramFiles", ""), "Ollama", "ollama.exe"),
                  os.path.join(os.environ.get("LOCALAPPDATA", ""), "Ollama", "ollama.exe")]
    seen = set()
    for p in candidates:
        if not p or p in seen:
            continue
        seen.add(p)
        if p and os.path.isfile(p):
            return p
    return None


def _ensure_ollama_running(base_url):
    """仅对 Ollama 默认端口自动启动，其他本地运行器必须由用户自行启动。"""
    if not _is_local_url(base_url):
        return
    try:
        parsed = urlparse(base_url)
        host = parsed.hostname or "127.0.0.1"
        port = parsed.port or 11434
    except Exception:
        host, port = "127.0.0.1", 11434
    if port != 11434 or _port_open(host, port):
        return
    exe = _find_ollama_exe()
    if not exe:
        return
    try:
        env = os.environ.copy()
        # 明确绑定本机地址，避免系统环境中的 OLLAMA_HOST 把服务启动到别的端口。
        env["OLLAMA_HOST"] = f"{host}:{port}"
        global _OLLAMA_CHILD
        _OLLAMA_CHILD = subprocess.Popen([exe, "serve"], cwd=os.path.dirname(exe), env=env,
                         creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        return
    for _ in range(30):
        time.sleep(1)
        if _port_open(host, port):
            return


def _local_unavailable_hint(base_url):
    if not _is_local_url(base_url):
        return None
    parsed = urlparse(base_url)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 11434
    if _port_open(host, port):
        return None
    return f"本地模型服务未启动（{host}:{port}）。启动 Ollama：ollama serve。" if port == 11434         else f"本地模型服务未启动（{host}:{port}）。请启动对应运行器。"


# ---------- 多模态图片解析 ----------
_IMG_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
             ".gif": "image/gif", ".webp": "image/webp"}


def _resolve_image(image_ref):
    if not image_ref:
        return None
    if image_ref.startswith("data:"):
        return image_ref
    name = os.path.basename(image_ref.rsplit("/", 1)[-1])
    path = os.path.join(db.UPLOAD_DIR, name)
    if not os.path.isfile(path):
        return None
    mime = _IMG_MIME.get(os.path.splitext(path)[1].lower())
    if not mime:
        return None
    try:
        with open(path, "rb") as f:
            return f"data:{mime};base64,{base64.b64encode(f.read()).decode()}"
    except Exception:
        return None


def _event_usage_tokens(obj):
    """从 usage 事件里取真实 token 消耗（prompt + completion + cache）。

    兼容两种形状：
    ① OpenAI 标准流式：最后一帧 `{"usage": {"prompt_tokens", "completion_tokens", "total_tokens"}}`
    ② 火山方舟 / 其他：usage 嵌套在 data 里，字段名可能是 input/output/cache 等。
    """
    acc = {}

    def walk(x):
        if isinstance(x, dict):
            for k, v in x.items():
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    lk = str(k).lower()
                    if any(s in lk for s in ("token", "input", "output", "cache")):
                        acc[lk] = acc.get(lk, 0) + int(v)
                else:
                    walk(v)
        elif isinstance(x, list):
            for i in x:
                walk(i)

    t = str(obj.get("type") or "").lower()
    # 无论 type 是什么，只要带 usage / model_usage 字段就抠；否则按 type 名兜底
    if "usage" in t:
        walk(obj)
    else:
        u = obj.get("usage") or obj.get("model_usage")
        if u:
            walk(u)
        elif "usage" in json.dumps(obj, ensure_ascii=False)[:200]:
            walk(obj)
    # 优先用 total_tokens（标准字段，最准）；否则累加 input/output/cache 等非 total 字段
    total = sum(v for k, v in acc.items() if "total" in k)
    if total:
        return total
    rest = {k: v for k, v in acc.items() if "total" not in k}
    return sum(rest.values())


# ---------- 模型流式 ----------
def _build_messages(system_prompt, input_text, history=None, image=None):
    system = system_prompt or "你是专业的 AI 助手，请直接、清楚地回答用户。"
    messages = [{"role": "system", "content": system}]
    for h in (history or []):
        role = h.get("role") if h.get("role") in ("user", "assistant") else "user"
        messages.append({"role": role, "content": (h.get("content") or "")[:HISTORY_CHAR_LIMIT]})
    data_url = _resolve_image(image)
    if data_url:
        user_content = [{"type": "text", "text": input_text},
                        {"type": "image_url", "image_url": {"url": data_url}}]
    else:
        user_content = input_text
    messages.append({"role": "user", "content": user_content})
    return messages


def call_model_stream(base_url, api_key, model_key, input_text,
                      history=None, image=None, system_prompt=None, temperature=0.4):
    """流式调用 OpenAI 兼容 /chat/completions。生成器 yield 字符串片段 / dict。"""
    _ensure_ollama_running(base_url)
    hint = _local_unavailable_hint(base_url)
    if hint:
        raise ConnectionError(hint)
    url = base_url.rstrip("/") + "/chat/completions"
    body = {"model": model_key,
            "messages": _build_messages(system_prompt, input_text, history, image=image),
            "temperature": temperature, "stream": True,
            "stream_options": {"include_usage": True}}   # 让上游在最后一帧回传真实 token 用量
    if _is_local_url(base_url):
        body["keep_alive"] = -1
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"),
                                 headers=headers, method="POST")
    with _open(req, timeout=REQUEST_TIMEOUT) as resp:
        for raw in resp:
            line = raw.decode("utf-8", errors="replace").strip()
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload == "[DONE]":
                break
            try:
                chunk = json.loads(payload)
                # 标准 OpenAI：usage 只在最后一帧（choices 为空）返回
                if "usage" in chunk:
                    usage = _event_usage_tokens(chunk)
                    if usage:
                        yield {"type": "usage", "tokens": usage}
                delta = (chunk.get("choices") or [{}])[0].get("delta", {}).get("content") or ""
                if delta:
                    yield delta
            except Exception:
                continue


# ---------- n8n webhook ----------
def call_n8n_webhook(endpoint, token, message, timeout=None):
    """直调 n8n webhook。不依赖 recipe / 配方。返回文本片段的生成器。"""
    timeout = int(timeout or N8N_TIMEOUT)
    if not (endpoint or "").strip():
        yield {"type": "unmatched", "reason": "n8n endpoint 未配置"}
        return
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps({"query": message, "source": "aibrandos"}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(endpoint.strip(), data=body, headers=headers, method="POST")
    try:
        with _open(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except Exception as e:  # noqa: BLE001
        yield {"type": "unmatched", "reason": f"n8n 调用失败：{e}"}
        return
    for path in (("output",), ("result",), ("text",), ("message",), ("reply",),
                 ("data", "output"), ("data", "content"), ("answer",)):
        node = _dig(raw, path)
        if isinstance(node, str) and node.strip():
            yield {"type": "delta", "text": node}
            yield {"type": "done", "ok": True, "text": node}
            return
    # 没有匹配字段，原样返回（截断 2000）
    yield {"type": "delta", "text": raw[:2000]}
    yield {"type": "done", "ok": True, "text": raw[:2000]}


def _dig(raw, path):
    try:
        data = json.loads(raw)
    except Exception:
        return None
    node = data
    for seg in path:
        if isinstance(node, dict) and seg in node:
            node = node[seg]
        else:
            return None
    return node


# ---------- agent 会话事件流（火山方舟 Session 事件流等） ----------
def _agent_stream_url(endpoint):
    """.../events -> .../events/stream"""
    ep = (endpoint or "").rstrip("/")
    if not ep:
        return ""
    if ep.endswith("/events/stream"):
        return ep
    if ep.endswith("/events"):
        return ep + "/stream"
    return ep + "/stream"


def _session_endpoint_error(endpoint):
    """校验 endpoint 是否为完整的会话事件地址；合格返回 ''，否则返回可读的错误说明。"""
    ep = (endpoint or "").strip().rstrip("/")
    if "/sessions/" not in ep:
        return ("endpoint 必须是完整的会话事件地址，形如 "
                "https://ark.cn-beijing.volces.com/api/v3/sessions/{会话ID}/events，"
                "不能只填根地址（如 …/api/v3），否则会被拼成 …/stream 而返回 404。")
    tail = ep.split("/sessions/", 1)[1]
    sid = tail.split("/", 1)[0]
    if not sid or not ep.endswith("/events"):
        return ("endpoint 路径不完整，应以 /sessions/{会话ID}/events 结尾；"
                "请在方舟控制台该会话页点「API 接入」复制完整事件地址。")
    return ""


def _sse_text(obj):
    """从一个 SSE data JSON 里尽量抠出文本：各家字段不同，宽容处理。"""
    if isinstance(obj, str):
        return obj
    if not isinstance(obj, dict):
        return ""
    for k in ("delta", "text", "output_text"):
        v = obj.get(k)
        if isinstance(v, str) and v:
            return v
        if isinstance(v, dict):
            s = _sse_text(v)
            if s:
                return s
    c = obj.get("content")
    if isinstance(c, list):
        parts = []
        for it in c:
            if isinstance(it, dict):
                if it.get("type") in (None, "text", "output_text"):
                    t = it.get("text")
                    if isinstance(t, str) and t:
                        parts.append(t)
            elif isinstance(it, str):
                parts.append(it)
        if parts:
            return "".join(parts)
    if isinstance(c, str) and c:
        return c
    ch = obj.get("choices")          # OpenAI 兼容形状兜底
    if isinstance(ch, list) and ch:
        d = ch[0].get("delta") or ch[0].get("message") or {}
        t = d.get("content") if isinstance(d, dict) else None
        if isinstance(t, str) and t:
            return t
    return ""


def _agent_event_text(obj):
    """只取「真正的回答」：跳过用户消息回显、思考过程、span 遥测。
    实测火山方舟事件类型：user.message(回显) / agent.thinking / agent.message(回答) / span.* / *status_idle(终止)。
    """
    etype = str(obj.get("type") or "")
    low = etype.lower()
    if not low:                       # 没有 type 的事件：按形状抠
        return _sse_text(obj)
    if low.startswith("span."):
        return ""
    if "thinking" in low:
        return ""
    if low.startswith("user"):        # 用户消息回显，不当作回复
        return ""
    if "message" in low or "delta" in low or low.endswith(".text"):
        return _sse_text(obj)
    return ""


def _agent_thinking_text(obj):
    """单独抠 agent.thinking 的思考文本（不并入正文，前端折叠展示）。"""
    if "thinking" not in str(obj.get("type") or "").lower():
        return ""
    c = obj.get("content")
    if isinstance(c, list):
        parts = []
        for it in c:
            if isinstance(it, dict) and it.get("text"):
                parts.append(str(it["text"]))
            elif isinstance(it, str):
                parts.append(it)
        return "".join(parts)
    if isinstance(c, str):
        return c
    return ""


def _agent_is_error(obj):
    low = str(obj.get("type") or "").lower()
    return "error" in low or bool(obj.get("error"))


def _agent_error_text(obj):
    """上游报错原文（失败不回吞，原文回传）。"""
    e = obj.get("error")
    if e:
        return json.dumps(e, ensure_ascii=False)[:400] if not isinstance(e, str) else e[:400]
    c = obj.get("content")
    if isinstance(c, list):
        parts = [str(x.get("text") or x.get("content") or "") for x in c if isinstance(x, dict)]
        s = " ".join(p for p in parts if p).strip()
        if s:
            return s[:400]
    return json.dumps(obj, ensure_ascii=False)[:400]


def _agent_is_terminal(obj):
    """会话流是长连接，靠状态回到 idle 判定本轮结束。"""
    low = str(obj.get("type") or "").lower()
    return ("status_idle" in low) or low.endswith(".completed") or low.endswith(".done")


def _iter_sse_json(resp):
    """按标准 SSE 分帧读取 agent 事件，兼容多行 data、event 名和嵌套 data。"""
    data_lines = []
    event_name = ""

    def flush():
        nonlocal data_lines, event_name
        if not data_lines:
            event_name = ""
            return None
        payload = "\n".join(data_lines).strip()
        data_lines = []
        name = event_name
        event_name = ""
        if not payload or payload == "[DONE]":
            return {"type": "__done__"} if payload == "[DONE]" else None
        try:
            obj = json.loads(payload)
        except Exception:
            return None
        if isinstance(obj, dict) and isinstance(obj.get("data"), str):
            try:
                obj["data"] = json.loads(obj["data"])
            except Exception:
                pass
        if isinstance(obj, dict) and isinstance(obj.get("data"), (dict, list)):
            nested = obj["data"]
            if isinstance(nested, dict):
                merged = dict(nested)
                for k, v in obj.items():
                    if k != "data" and k not in merged:
                        merged[k] = v
                obj = merged
        if isinstance(obj, dict) and name and not obj.get("type"):
            obj["type"] = name
        return obj if isinstance(obj, dict) else {"type": name or "event", "data": obj}

    for raw in resp:
        line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
        if not line:
            item = flush()
            if item is not None:
                yield item
            continue
        if line.startswith(":"):
            continue
        if line.startswith("event:"):
            event_name = line[6:].strip()
        elif line.startswith("data:"):
            data_lines.append(line[5:].lstrip())
    item = flush()
    if item is not None:
        yield item


# ---------- agent 产物文件：从事件流里抠出来落盘 ----------
# 智能体在云端沙箱生成的文件（PPT/表格等）只存在于上游，要拿到本地只有两条路：
# ① 它把文件塞进 data URI（base64）回传  ② 它给出可直接下载的 URL
FILE_URL_RE = re.compile(r"https?://[^\s\"'<>()]+", re.I)
FILE_EXT_RE = re.compile(r"\.(pptx?|xlsx?|docx?|pdf|csv|md|html?|txt|json|zip|png|jpe?g|gif|webp)(?:$|[?#])", re.I)
B64_RE = re.compile(r"data:([A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]{200,})")


def _files_dir():
    d = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                     "data", "downloads")
    os.makedirs(d, exist_ok=True)
    return d


def _unique_path(name):
    safe = re.sub(r"[\\/:*?\"<>|]", "_", (name or "agent_file").strip()) or "agent_file"
    p = os.path.join(_files_dir(), safe)
    if os.path.exists(p):
        stem, ext = os.path.splitext(safe)
        p = os.path.join(_files_dir(), f"{stem}_{int(time.time())}{ext}")
    return p


def _event_ts(obj):
    """事件自带的产生时间（上游回放历史时带旧时间戳）。
    注意：方舟给的是 9 位小数（2026-09-19T20:15:07.983138063+08:00），
    datetime.fromisoformat 吃不下，只能截到秒。"""
    s = str(obj.get("processed_at") or "")
    m = re.match(r"(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})", s)
    if m:
        try:
            return time.mktime(time.strptime(f"{m.group(1)} {m.group(2)}", "%Y-%m-%d %H:%M:%S"))
        except Exception:
            pass
    return None


def _scan_files(obj, headers, source_url=""):
    """扫事件中的附件：兼容 data URI、带 query 的签名 URL 和无扩展名下载 URL。"""
    found = []
    s = obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)
    for m in B64_RE.finditer(s):
        b64 = re.sub(r"\s", "", m.group(2))
        try:
            data = base64.b64decode(b64)
        except Exception:
            continue
        if not data:
            continue
        ext = mimetypes.guess_extension(m.group(1)) or ".bin"
        p = _unique_path("agent_file" + ext)
        with open(p, "wb") as f:
            f.write(data)
        found.append({"name": os.path.basename(p), "path": p, "size": len(data)})
    for m in FILE_URL_RE.finditer(s):
        url = m.group(0)
        # 普通网页/引用链接不是交付物；没有扩展名的 URL 先允许请求，
        # 再根据响应 Content-Type 判断，兼容云端签名下载地址。
        try:
            req = urllib.request.Request(url)
            source, dest = urlparse(source_url), urlparse(url)
            if source.scheme == dest.scheme and source.netloc == dest.netloc:
                for key, value in (headers or {}).items():
                    if key.lower() == "authorization":
                        req.add_unredirected_header(key, value)
            with _open(req, timeout=60) as r:
                data = r.read()
                ctype = (r.headers.get("Content-Type") or "").split(";", 1)[0].lower()
                disposition = r.headers.get("Content-Disposition") or ""
        except Exception:
            continue
        if not data:
            continue
        known_file = bool(FILE_EXT_RE.search(url)) or ctype.startswith(("image/", "application/pdf")) or \
            any(x in ctype for x in ("presentation", "spreadsheet", "word", "zip", "octet-stream"))
        explicit_file = bool(FILE_EXT_RE.search(url)) or "attachment" in disposition.lower()
        if not (known_file or explicit_file) or (ctype in ("text/html", "text/plain") and not explicit_file):
            continue
        name_match = re.search(r"filename\*?=(?:UTF-8''|\"?)([^\";]+)", disposition, re.I)
        name = name_match.group(1).strip() if name_match else os.path.basename(urlparse(url).path)
        if not os.path.splitext(name)[1]:
            ext = mimetypes.guess_extension(ctype) or ".bin"
            name += ext
        p = _unique_path(name or "agent_file")
        with open(p, "wb") as f:
            f.write(data)
        found.append({"name": os.path.basename(p), "path": p, "size": len(data)})
    return found


def probe_agent_channel(endpoint, api_key, seconds=8):
    """链路通道探测：**只开 SSE 流，绝不 POST 消息**。

    POST /events 才会让智能体开始推理 = 花钱；只开 /events/stream 只是建立长连接，
    上游最多回放历史事件，不产生任何模型推理，所以这个探测是 **零 token 消耗**的。
    要判断"通道通不通 / Key 有没有被拒 / 账户是不是欠费"，用它就够了。
    """
    ep = (endpoint or "").strip()
    if not ep:
        return {"ok": False, "http_status": None, "error": "agent endpoint 未配置",
                "events": [], "n_events": 0, "cost": "0", "elapsed": 0}
    bad = _session_endpoint_error(ep)
    if bad:
        return {"ok": False, "http_status": None, "error": bad,
                "events": [], "n_events": 0, "cost": "0", "elapsed": 0}
    url = _agent_stream_url(ep)
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    headers["Accept"] = "text/event-stream"
    t0 = time.time()
    types, err, status, resp = [], "", None, None
    try:
        resp = _open(urllib.request.Request(url, headers=headers, method="GET"),
                     timeout=max(10, seconds + 10))
        status = getattr(resp, "status", 200)
        try:
            resp.fp.raw._sock.settimeout(min(seconds, 10))
        except Exception:
            pass
        for raw in resp:
            s = raw.decode("utf-8", "replace").strip()
            if not s.startswith("data:"):
                continue
            p = s[5:].strip()
            if not p or p == "[DONE]":
                continue
            try:
                obj = json.loads(p)
            except Exception:
                continue
            t = str(obj.get("type") or "?")
            types.append(t)
            if _agent_is_error(obj):
                err = _agent_error_text(obj)
                break
            if time.time() - t0 > seconds:
                break
    except urllib.error.HTTPError as e:
        status = e.code
        try:
            err = e.read()[:300].decode("utf-8", "replace")
        except Exception:
            err = str(e)
    except socket.timeout:
        pass                      # 只开流没新事件是正常的，说明通道建起来了
    except Exception as e:  # noqa: BLE001
        err = repr(e)
    finally:
        if resp is not None:
            try:
                resp.close()
            except Exception:
                pass
    return {"ok": (not err) and status in (200, None),
            "http_status": status,
            "events": types[:10],
            "n_events": len(types),
            "error": err,
            "cost": "0 token（只开流，未推送消息，不触发模型推理）",
            "elapsed": round(time.time() - t0, 1)}


def call_agent_session(endpoint, api_key, message, timeout=None):
    """调 agent 的会话事件流：先开 SSE /events/stream → POST /events 推 user.message → 读回文本。

    本地不设任务长度闸门：静默/断流自动重开事件流续读（回放去重），
    直到上游真正终止，或判定上游失联（连续多轮零新事件）/ 重连失败。
    timeout 仅为可选保险（秒）；0 或 None = 不限。
    yield dict：{"type": "delta"|"done"|"unmatched"}。
    """
    timeout = int(timeout if timeout is not None else AGENT_TOTAL_TIMEOUT)
    ep = (endpoint or "").strip()
    if not ep:
        yield {"type": "unmatched", "reason": "agent endpoint 未配置"}
        return
    bad = _session_endpoint_error(ep)
    if bad:
        yield {"type": "unmatched", "reason": bad}
        return
    stream_url = _agent_stream_url(ep)
    auth = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    stream_headers = dict(auth, **{"Accept": "text/event-stream"})
    post_headers = dict(auth, **{"Content-Type": "application/json"})
    body = json.dumps({"events": [{"type": "user.message",
                                   "content": [{"type": "text", "text": message}]}]},
                      ensure_ascii=False).encode("utf-8")

    # ① 先开长连接
    stream_resp = None
    open_err = ""
    try:
        stream_resp = _open(urllib.request.Request(stream_url, headers=stream_headers, method="GET"),
                            timeout=(FIRST_EVENT_TIMEOUT if timeout <= 0
                                     else min(FIRST_EVENT_TIMEOUT, timeout)))
    except Exception as e:  # noqa: BLE001
        open_err = str(e)

    # 事件流未建立时不能继续 POST：否则上游可能已经开始推理，
    # 但本地没有接收通道，既浪费调用又必然丢结果。
    if stream_resp is None:
        yield {"type": "unmatched", "reason": f"agent 调用失败（无法建立事件流）：{open_err}"}
        return

    # ② 推消息（记下时刻：早于它的事件都是上游回放的历史，不算本轮）
    t_post = time.time()
    try:
        req = urllib.request.Request(ep, data=body, headers=post_headers, method="POST")
        with _open(req, timeout=60) as r:
            r.read()
    except Exception as e:  # noqa: BLE001
        if stream_resp is not None:
            try:
                stream_resp.close()
            except Exception:
                pass
        yield {"type": "unmatched", "reason": f"agent 调用失败（推送消息）：{e}"}
        return

    # ③ 读流：阻塞读（socket 超时一触发连接就废，不能短超时重试）。
    #    socket 超时在这里只是"心跳探测"，不是闸门：本次连接首事件前给 FIRST_EVENT_TIMEOUT，
    #    出过事件后收紧到 IDLE_AFTER_EVENT；触发后作废这条连接、重开续读，任务本身不受影响。
    #    收尾只有三种：上游终止信号 / 连接重连不上 / 连续多轮零新事件（判定上游失联）。
    buf = ""
    n_events = 0        # 本轮累计事件数（跨续读）
    used_tokens = 0
    seen_files = set()   # 同一文件可能在 tool_result 与 message 里出现两次
    seen_sigs = set()    # 已处理事件签名：续读回放去重（时间戳只有秒级精度，签名兜底）
    saved = []
    t0 = time.time()
    deadline = (t0 + timeout) if timeout and timeout > 0 else None   # None = 不限时
    stop_reason = ""
    unmatched_sent = False
    completed = False

    def _remaining():
        if deadline is None:
            return None
        return max(0.0, deadline - time.time())

    def _sock_timeout(base):
        rem = _remaining()
        if rem is None:
            return base
        return min(base, max(1, int(rem)))

    def _open_stream(open_to):
        for i in range(3):
            try:
                return _open(urllib.request.Request(stream_url, headers=stream_headers,
                                                    method="GET"), timeout=open_to)
            except Exception:  # noqa: BLE001
                time.sleep(1.5 * (i + 1))
        return None

    def _event_sig(obj):
        return hashlib.md5(json.dumps(obj, ensure_ascii=False).encode("utf-8")).hexdigest()

    def _read_attempt(resp):
        """读一条已打开的事件流。返回 (状态, 本次连接新事件数)：
        done=本轮 DONE / terminal=状态回 idle / error=上游报错（已 yield unmatched）/
        cap=总时长到顶（仅显式设上限时）/ timeout_first / timeout_idle / closed=被上游掐断"""
        nonlocal n_events, used_tokens, saved, stop_reason, buf, unmatched_sent
        n_new = 0
        sock = None
        try:
            try:
                sock = resp.fp.raw._sock
                sock.settimeout(_sock_timeout(FIRST_EVENT_TIMEOUT))
            except Exception:
                sock = None
            for obj in _iter_sse_json(resp):
                if deadline is not None and time.time() > deadline:
                    return "cap", n_new
                if obj.get("type") == "__done__":
                    # 回放结束也会给 [DONE]：只有**本次连接**已出过新事件，这个 [DONE] 才算真结束
                    if n_new > 0:
                        return "done", n_new
                    continue
                ts = _event_ts(obj)
                if ts is not None and ts < t_post - 1:
                    continue        # 历史回放（本轮之前的老事件）：不是本轮产生的，别拿来判定结束
                if _agent_is_error(obj):
                    unmatched_sent = True
                    yield {"type": "unmatched", "reason": f"上游报错：{_agent_error_text(obj)}"}
                    return "error", n_new
                sig = _event_sig(obj)
                if sig in seen_sigs:
                    # 续读回放：本轮已收过的事件，跳过；但终止事件要重新判定（上游可能已收工）
                    if _agent_is_terminal(obj):
                        return "terminal", n_new
                    continue
                seen_sigs.add(sig)
                n_new += 1
                n_events += 1
                u = _event_usage_tokens(obj)
                if u:
                    used_tokens += u
                    yield {"type": "usage", "tokens": used_tokens}
                if n_new == 1 and sock is not None:
                    sock.settimeout(_sock_timeout(IDLE_AFTER_EVENT))
                for f in _scan_files(obj, stream_headers, ep):
                    fsig = f"{f['size']}:{f['name']}"
                    if fsig in seen_files:
                        continue
                    seen_files.add(fsig)
                    saved.append(f)
                    yield {"type": "file", **f}
                th = _agent_thinking_text(obj)
                if th:
                    yield {"type": "thinking", "text": th}
                t = _agent_event_text(obj)
                if t:
                    if B64_RE.search(t):        # 别把几十 KB base64 灌进对话正文
                        t = B64_RE.sub("[附件已保存到本地]", t)
                    buf += t
                    yield {"type": "delta", "text": t}
                if _agent_is_terminal(obj):
                    return "terminal", n_new
            return "closed", n_new           # 上游把连接关了（没给 [DONE]）
        except socket.timeout:
            return ("timeout_idle" if n_new > 0 else "timeout_first"), n_new
        except Exception as e:  # noqa: BLE001
            stop_reason = f"事件流中断（{e}）"
            return "error", n_new

    resp = stream_resp
    resumed = 0          # 已重开流次数
    empty_rounds = 0     # 连续「一条新事件都没等到」的读流轮数（上游失联判定）
    try:
        while True:
            status, n_new = yield from _read_attempt(resp)
            if status in ("done", "terminal", "error"):
                completed = status in ("done", "terminal")
                break
            if status == "cap":
                stop_reason = stop_reason or f"超过总时长上限 {int(timeout)}s"
                break
            if status == "timeout_first":
                stop_reason = stop_reason or (
                    f"单连接 {FIRST_EVENT_TIMEOUT}s 内没有首个事件" if n_events == 0
                    else f"续读后 {FIRST_EVENT_TIMEOUT}s 内没有新事件")
            elif status == "timeout_idle":
                stop_reason = stop_reason or f"事件后空闲超过 {IDLE_AFTER_EVENT}s"
            elif status == "closed":
                stop_reason = stop_reason or "事件流被上游关闭"
            if n_new == 0:
                empty_rounds += 1
            else:
                empty_rounds = 0
            # 唯二不由上游终止的收尾：失联判定（可配 0 = 永不判定）/ 显式设了续读上限（默认不限）
            if (AGENT_EMPTY_ROUNDS > 0 and empty_rounds >= AGENT_EMPTY_ROUNDS) or \
                    (AGENT_MAX_RESUMES > 0 and resumed >= AGENT_MAX_RESUMES):
                stop_reason = stop_reason or (
                    f"连续 {empty_rounds} 轮未收到任何新事件，判定上游已结束或失联")
                break
            try:
                resp.close()
            except Exception:
                pass
            remain = _remaining()
            if remain is not None and remain <= 1:
                stop_reason = stop_reason or f"超过总时长上限 {int(timeout)}s"
                break
            reopened = _open_stream(_sock_timeout(FIRST_EVENT_TIMEOUT))
            if reopened is None:
                stop_reason = stop_reason or f"事件流断开且重连失败（已读 {int(time.time() - t0)}s）"
                break
            resumed += 1
            resp = reopened
    finally:
        try:
            resp.close()
        except Exception:
            pass

    yield {"type": "usage", "tokens": used_tokens, "final": True}

    if unmatched_sent:
        return
    if not completed:
        yield {"type": "unmatched", "reason": f"任务接收中断：{stop_reason or '未收到上游完成信号'}。已接收内容保留，上游任务可能仍在运行。", "usage": used_tokens}
        return
    if not buf and not saved:
        waited = int(time.time() - t0)
        if n_events == 0:
            reason = (f"智能体在 {waited}s 内没有回任何事件"
                      f"（{stop_reason}）。已自动续读重试仍无事件："
                      f"Key 与网络已验证正常，请重试或把任务拆小；"
                      f"如确需等待更久可调大 AIBO_AGENT_FIRST_TIMEOUT，"
                      f"或设 AIBO_AGENT_EMPTY_ROUNDS=0 取消失联判定（慎用）")
        else:
            reason = (f"收到 {n_events} 个事件但没有回复文本（{stop_reason or '事件流结束'}），"
                      f"只有思考/工具调用。已等待 {waited}s")
        yield {"type": "unmatched", "reason": reason, "usage": used_tokens}
        return
    extra = {"stop_reason": stop_reason} if stop_reason else {}
    yield {"type": "done", "ok": True, "text": buf, "files": saved, "usage": used_tokens, **extra}


def _ark_http_error(prefix, exc):
    """保留方舟 HTTP 错误原文，避免入口把上游原因吞掉。"""
    try:
        raw = exc.read().decode("utf-8", "replace")[:2000]
    except Exception:
        raw = str(exc)
    return f"{prefix}（HTTP {getattr(exc, 'code', '?')}）：{raw}"


def upload_agent_file(base_url, api_key, local_csv_path):
    """把本地 CSV 原样上传到方舟 Files API，返回上游 file_id。"""
    path = os.path.abspath((local_csv_path or "").strip())
    if not path or not os.path.isfile(path):
        raise FileNotFoundError(f"CSV 文件不存在：{local_csv_path}")
    if os.path.splitext(path)[1].lower() != ".csv":
        raise ValueError("只允许上传 .csv 文件")
    boundary = f"----QingzhouBoundary{uuid.uuid4().hex}"
    filename = os.path.basename(path)
    with open(path, "rb") as f:
        data = f.read()
    body = (f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            "Content-Type: text/csv\r\n\r\n").encode("utf-8") + data + \
           f"\r\n--{boundary}--\r\n".encode("utf-8")
    url = base_url.rstrip("/") + "/files"
    headers = {"Authorization": f"Bearer {api_key}",
               "Content-Type": f"multipart/form-data; boundary={boundary}"}
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with _open(req, timeout=REQUEST_TIMEOUT) as resp:
            payload = json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(_ark_http_error("上传 CSV 失败", e)) from e
    except Exception as e:
        raise RuntimeError(f"上传 CSV 失败：{e}") from e
    file_id = payload.get("id") or payload.get("file_id") or (payload.get("data") or {}).get("id")
    if not file_id:
        raise RuntimeError(f"上传 CSV 失败：上游未返回 file_id。原文：{json.dumps(payload, ensure_ascii=False)[:2000]}")
    return str(file_id)


def create_agent_session(base_url, api_key, agent_id, environment_id, file_ids):
    """用方舟 Agent、Environment 和文件资源创建 Session，返回 events endpoint。"""
    ids = [str(x).strip() for x in (file_ids or []) if str(x).strip()]
    body = {"agent_id": str(agent_id).strip(),
            "environment_id": str(environment_id).strip(),
            "resources": [{"type": "file", "file_id": x} for x in ids]}
    if not body["agent_id"] or not body["environment_id"] or not ids:
        raise ValueError("agent_id、environment_id 和 file_ids 均必填")
    url = base_url.rstrip("/") + "/sessions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    req = urllib.request.Request(url, data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                                 headers=headers, method="POST")
    try:
        with _open(req, timeout=REQUEST_TIMEOUT) as resp:
            payload = json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(_ark_http_error("创建 Agent Session 失败", e)) from e
    except Exception as e:
        raise RuntimeError(f"创建 Agent Session 失败：{e}") from e
    session_id = payload.get("id") or payload.get("session_id") or (payload.get("data") or {}).get("id")
    if not session_id:
        raise RuntimeError(f"创建 Agent Session 失败：上游未返回 session_id。原文：{json.dumps(payload, ensure_ascii=False)[:2000]}")
    return url + "/" + str(session_id) + "/events"


__all__ = ["call_model_stream", "call_n8n_webhook", "call_agent_session",
           "upload_agent_file", "create_agent_session", "_resolve_image",
           "_ensure_ollama_running", "_is_local_url"]
