# -*- coding: utf-8 -*-
"""agent库：外部 AI 调用示例的纯参考面板（2026-09-18 用户开白）。

每条 = 名称 + 描述 + endpoint + 示例代码片段(code) + API Key（复用 KeyVault 加密落盘）。
定位：管理外部 agent 的连接信息与调用示例；真实执行走 adapters.call_agent_session()，不在本地编排。
数据源：data/agents.json（与 projects.json 同构的本地 JSON 索引）。
"""
import json
import os
import time
import uuid

from .db import PROJECT_ROOT

AGENTS_PATH = os.path.join(PROJECT_ROOT, "data", "agents.json")


def _load():
    if not os.path.exists(AGENTS_PATH):
        return []
    try:
        with open(AGENTS_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save(items):
    os.makedirs(os.path.dirname(AGENTS_PATH), exist_ok=True)
    with open(AGENTS_PATH, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)


def _key_hint(plain):
    """只用于展示的末 4 位提示。"""
    if not plain:
        return ""
    return "••••" + plain[-4:] if len(plain) >= 4 else "••••"


def _mask(item):
    """列表/详情对外只返回掩码提示，绝不回传明文 Key。"""
    out = dict(item)
    out.pop("api_key", None)
    out.setdefault("stream_code", "")  # 兼容加字段前建的旧条目
    return out


def list_agents():
    return [_mask(it) for it in _load()]


def get_agent(aid):
    it = next((x for x in _load() if x["id"] == aid), None)
    return _mask(it) if it else None


def reveal_agent_key(aid):
    """返回明文 Key（本地明文存储，仅本机）。"""
    it = next((x for x in _load() if x["id"] == aid), None)
    if not it:
        return None
    return it.get("api_key") or ""


def create_agent(name, description="", endpoint="", code="", stream_code="", api_key=""):
    name = (name or "").strip()
    if not name:
        raise ValueError("名称必填")
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    item = {
        "id": f"agent_{uuid.uuid4().hex[:8]}",
        "name": name,
        "description": description or "",
        "endpoint": endpoint or "",
        "code": code or "",                # ① 调用示例代码
        "stream_code": stream_code or "",  # ② SSE 流监控代码
        "api_key": api_key or "",
        "key_hint": _key_hint(api_key),
        "created_at": now,
        "updated_at": now,
    }
    items = _load()
    items.insert(0, item)
    _save(items)
    return _mask(item)


def update_agent(aid, name=None, description=None, endpoint=None, code=None, stream_code=None, api_key=None):
    items = _load()
    it = next((x for x in items if x["id"] == aid), None)
    if not it:
        return None
    if name is not None:
        it["name"] = name.strip() or it["name"]
    if description is not None:
        it["description"] = description
    if endpoint is not None:
        it["endpoint"] = endpoint
    if code is not None:
        it["code"] = code
    if stream_code is not None:
        it["stream_code"] = stream_code
    if api_key is not None:
        if api_key == "":
            it["api_key"] = ""
            it["key_hint"] = ""
        else:
            it["api_key"] = api_key
            it["key_hint"] = _key_hint(api_key)
    it["updated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    _save(items)
    return _mask(it)


def delete_agent(aid):
    items0 = _load()
    if not any(x.get("id") == aid for x in items0):
        return None
    items = [x for x in items0 if x["id"] != aid]
    _save(items)
    return {"id": aid, "deleted": True}


__all__ = ["list_agents", "get_agent", "reveal_agent_key", "create_agent", "update_agent", "delete_agent"]
