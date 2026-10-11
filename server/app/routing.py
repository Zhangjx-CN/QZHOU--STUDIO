# -*- coding: utf-8 -*-
"""统一对话路由（2026-09-18 模块库清档）：单入口 stream_chat，支持「模型」或「n8n」两种目标。

不做任何配方 / 工具 / 三态 / agent 编排 —— 本机只调度，不再造轮子。
工作流 / 重活 → 调 n8n 或外部服务（由目标侧实现）。
"""
import json
import time
from . import db
from . import adapters
from .adapters import call_model_stream, call_n8n_webhook, call_agent_session
from .agents import get_agent, reveal_agent_key

SESSION_WINDOW = 8


def _save_chat(session_key, role, content, meta=None):
    db.execute(
        "INSERT INTO chat_messages (session_key, role, content, meta_json) VALUES (?,?,?,?)",
        (session_key, role, content or "",
         json.dumps(meta, ensure_ascii=False) if meta else None))


def _load_history(session_key, limit=SESSION_WINDOW):
    if not session_key:
        return []
    rows = db.query(
        "SELECT role, content FROM ("
        "  SELECT role, content, id FROM chat_messages WHERE session_key=? ORDER BY id DESC LIMIT ?"
        ") t ORDER BY id ASC", (session_key, limit * 2))
    return [{"role": r["role"], "content": r["content"]}
            for r in rows if r["role"] in ("user", "assistant")]


def _log_execution(target, message, status, output="", started_at=None, usage=0):
    """记录真实调用，供仪表盘使用；不记录 API Key 等敏感信息。"""
    elapsed = max(0, int((time.time() - (started_at or time.time())) * 1000))
    provider = target.get("provider_name") or target.get("name") or target.get("type")
    model = target.get("model_key") or target.get("name") or target.get("type")
    db.execute(
        "INSERT INTO execution_logs "
        "(model_provider, model_name, execution_time, input_json, output_json, status, "
        "token_usage_json, cost_estimate, duration_ms) VALUES (?,?,?,?,?,?,?,?,?)",
        (provider, model, time.strftime("%Y-%m-%d %H:%M:%S"),
         json.dumps({"source": "live_router", "target_type": target.get("type"), "message": (message or "")[:2000]}, ensure_ascii=False),
         json.dumps({"text": (output or "")[:4000]}, ensure_ascii=False), status,
         json.dumps({"tokens": int(usage or 0)}, ensure_ascii=False), 0.0, elapsed))


def _resolve_target(model_id=None, n8n_id=None, agent_id=None):
    """返回 dict：{"type": "agent"|"model"|"n8n", ...}。
    优先级：agent_id > n8n_id > model_id > 默认第一个可用模型。"""
    if agent_id:
        a = get_agent(agent_id)
        if a:
            return {"type": "agent", "available": bool(a.get("endpoint")), "id": a["id"],
                    "name": a.get("name") or "agent", "endpoint": a.get("endpoint") or "",
                    "api_key": reveal_agent_key(agent_id) or ""}
    if n8n_id:
        r = db.query_one("SELECT * FROM n8n_instances WHERE id=? AND status='enabled'", (n8n_id,))
        if r:
            return {"type": "n8n", "id": r["id"], "name": r["name"], "endpoint": r["endpoint"],
                    "token": _dec(r["token"]) if r.get("token") else ""}
    if model_id:
        r = db.query_one(
            "SELECT mo.id, mo.model_key, mo.display_name, p.id AS pid, p.name AS provider_name, p.base_url, c.encrypted_key "
            "FROM models mo "
            "JOIN model_providers p ON mo.provider_id=p.id "
            "LEFT JOIN api_connections c ON p.api_connection_id=c.id "
            "WHERE mo.id=? AND mo.enabled=1 AND p.enabled=1", (model_id,))
        if r:
            return _pack_model_target(r)
    # 默认：取第一个已启用的 provider 下的第一个模型
    r = db.query_one(
        "SELECT mo.id, mo.model_key, mo.display_name, p.id AS pid, p.name AS provider_name, p.base_url, c.encrypted_key "
        "FROM models mo JOIN model_providers p ON mo.provider_id=p.id "
        "LEFT JOIN api_connections c ON p.api_connection_id=c.id "
        "WHERE mo.enabled=1 AND p.enabled=1 ORDER BY p.created_at, mo.id LIMIT 1")
    return _pack_model_target(r) if r else {"type": "model", "available": False}


def _pack_model_target(row):
    base = row["base_url"] or ""
    api_key = row["encrypted_key"] or ""   # 字段名保留（历史遗留），值已是明文
    return {"type": "model", "available": bool(base), "id": row["id"],
            "model_key": row["model_key"], "display_name": row["display_name"] or row["model_key"],
            "provider_name": row["provider_name"], "base_url": base, "api_key": api_key}


def _dec(v):
    return v or ""


def stream_chat(message, project_id=None, model_id=None, n8n_id=None, agent_id=None, image=None):
    """统一流式对话入口。yield SSE 事件 dict：meta / delta / done / unmatched。"""
    sess = project_id or "default"
    if not (message or "").strip():
        yield {"type": "unmatched", "reason": "消息为空", "channel": "chat"}
        return
    target = _resolve_target(model_id=model_id, n8n_id=n8n_id, agent_id=agent_id)

    yield {"type": "meta", "channel": "chat", "target": {
        "type": target["type"], "name": target.get("name") or target.get("display_name") or "默认模型",
        "model_key": target.get("model_key"), "provider_name": target.get("provider_name")}}
    # 先读取上一轮历史，再写入本轮用户消息；否则本轮会被重复追加到模型上下文。
    history = _load_history(sess) if target["type"] == "model" else []
    _save_chat(sess, "user", message)

    buf = ""
    saved_files = []
    started_at = time.time()
    usage = 0
    failure = ""
    try:
        if target["type"] == "agent":
            if not target.get("available"):
                yield {"type": "unmatched",
                       "reason": f"agent「{target.get('name')}」没有 endpoint，无法调用（去 agent库 补上）"}
                return
            for ev in call_agent_session(target["endpoint"], target["api_key"], message):
                if ev.get("type") == "delta":
                    buf += ev.get("text", "")
                elif ev.get("type") == "file" and ev.get("name") and ev.get("path"):
                    if not any(f.get("path") == ev.get("path") for f in saved_files):
                        saved_files.append({"name": ev["name"], "path": ev["path"]})
                usage = max(usage, int(ev.get("tokens") or ev.get("usage") or 0))
                if ev.get("type") == "unmatched":
                    failure = ev.get("reason") or "调用失败"
                if ev.get("type") == "done":
                    continue  # 仅在路由保存结果后发送最终完成事件
                yield ev
            full = buf
        elif target["type"] == "n8n":
            for ev in call_n8n_webhook(target["endpoint"], target["token"], message):
                if ev.get("type") == "delta":
                    buf += ev.get("text", "")
                if ev.get("type") == "unmatched":
                    failure = ev.get("reason") or "调用失败"
                if ev.get("type") == "done":
                    continue
                yield ev
            full = buf
        elif target["type"] == "model":
            if not target.get("available"):
                yield {"type": "unmatched",
                       "reason": "无可用模型：请先到「模型与连接」配置（火山方舟 / DeepSeek / 本地 Ollama 等）"}
                return
            for d in call_model_stream(
                    base_url=target["base_url"], api_key=target["api_key"],
                    model_key=target["model_key"], input_text=message,
                    history=history, image=image):
                if isinstance(d, str):
                    buf += d
                    yield {"type": "delta", "text": d}
                else:
                    usage = max(usage, int(d.get("tokens") or d.get("usage") or 0)) if isinstance(d, dict) else usage
                    yield d
            full = buf
        else:
            yield {"type": "unmatched", "reason": "未知目标类型"}
            return
        if failure:
            if full or saved_files:
                _save_chat(sess, "assistant", full, meta={"target_type": target["type"],
                           "target_name": target.get("name"), "files": saved_files,
                           "status": "failed", "note": failure})
            _log_execution(target, message, "failed", full, started_at, usage)
            return
        if not (full or "").strip() and not saved_files:
            # 空回复不许入库、不许报"完成"——那就是假成功（agent 的失败原因由适配器原文回传过了）
            if target["type"] != "agent":
                yield {"type": "unmatched", "reason": "上游没有返回任何内容", "channel": "chat"}
            _log_execution(target, message, "failed", full, started_at, usage)
            return
        assistant_meta = {"target_type": target["type"], "target_name": target.get("name")}
        if saved_files:
            assistant_meta["files"] = saved_files
        _save_chat(sess, "assistant", full, meta=assistant_meta)
        _log_execution(target, message, "completed", full, started_at, usage)
        yield {"type": "done", "ok": True, "text": full, "target_type": target["type"], "files": saved_files}
    except Exception as e:  # noqa: BLE001
        if buf or saved_files:
            _save_chat(sess, "assistant", buf, meta={"target_type": target["type"],
                       "target_name": target.get("name"), "files": saved_files,
                       "status": "failed", "note": f"调用失败：{e}"})
        _log_execution(target, message, "failed", buf, started_at, usage)
        yield {"type": "unmatched", "reason": f"调用失败：{e}", "channel": "chat"}


# 兼容旧入口签名（api.py 可能还在用 stream_command）
def stream_command(message, session_key=None, image=None, recipe_id=None, model_id=None, mode=None):
    return stream_chat(message, project_id=session_key, model_id=model_id,
                       n8n_id=None, image=image)


def route_command(message, session_key=None, image=None, recipe_id=None, model_id=None):
    """非流式入口（兼容旧调用）：一次性返回完整结果。"""
    out = {"reply": "", "matched": False, "route": {"channel": "chat"}}
    parts = []
    for evt in stream_chat(message, project_id=session_key, model_id=model_id, image=image):
        if evt.get("type") == "delta":
            parts.append(evt.get("text", ""))
        elif evt.get("type") in ("done", "unmatched"):
            out["reply"] = (out.get("reply") or "") + "".join(parts) if evt.get("type") == "done" else                            evt.get("reason", "调用失败")
            out["matched"] = evt.get("type") == "done"
            out["route"]["channel"] = "chat"
            out["note"] = "已通过聊天通道执行" if out["matched"] else evt.get("reason", "")
    return out


def project_history(project_id):
    rows = db.query(
        "SELECT role, content, meta_json, created_at FROM chat_messages WHERE session_key=? ORDER BY id ASC",
        (project_id,))
    out = []
    for r in rows:
        item = {"role": r["role"], "content": r["content"], "created_at": r["created_at"]}
        if r["meta_json"]:
            try:
                item["meta"] = json.loads(r["meta_json"])
            except Exception:
                pass
        out.append(item)
    return {"project_id": project_id, "messages": out}


def load_chat_history(session_key, window=SESSION_WINDOW):
    return _load_history(session_key, window)


def save_chat(session_key, role, content, meta=None):
    _save_chat(session_key, role, content, meta)


__all__ = ["stream_chat", "stream_command", "route_command", "load_chat_history", "save_chat",
           "project_history"]
