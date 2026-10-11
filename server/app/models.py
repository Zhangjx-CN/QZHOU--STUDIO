# -*- coding: utf-8 -*-
"""模型与连接 / n8n 引擎 CRUD（2026-09-18 模块库清档）。"""
import json
import uuid

from . import db


def list_providers():
    out = []
    for p in db.query("SELECT * FROM model_providers ORDER BY created_at"):
        d = dict(p)
        d["capabilities"] = json.loads(p["capabilities_json"] or "{}")
        d["models"] = [dict(m) for m in db.query(
            "SELECT id, model_key, display_name, context_window, enabled FROM models WHERE provider_id=?", (p["id"],))]
        out.append(d)
    return out


def create_provider(data):
    pid = f"prov_{uuid.uuid4().hex[:8]}"
    db.execute(
        "INSERT INTO model_providers (id, provider_key, name, base_url, api_connection_id, capabilities_json, enabled) "
        "VALUES (?,?,?,?,?,?,?)",
        (pid, data.provider_key, data.name or data.provider_key, data.base_url, data.api_connection_id,
         json.dumps(data.capabilities, ensure_ascii=False), 1 if data.enabled else 0))
    return pid


def delete_provider(provider_id):
    db.execute("DELETE FROM models WHERE provider_id=?", (provider_id,))
    db.execute("DELETE FROM model_providers WHERE id=?", (provider_id,))
    return {"id": provider_id, "deleted": True}


# 线上模型服务（一键接入）
ONLINE_SERVICES = {
    "deepseek": {"name": "DeepSeek", "base_url": "https://api.deepseek.com/v1",
                 "models": [("deepseek-chat", "DeepSeek Chat"), ("deepseek-reasoner", "DeepSeek Reasoner")]},
    "zhipu": {"name": "智谱 GLM", "base_url": "https://open.bigmodel.cn/api/paas/v4",
              "models": [("glm-4-plus", "GLM-4-Plus"), ("glm-4-flash", "GLM-4-Flash"), ("glm-4-air", "GLM-4-Air")]},
    "openai": {"name": "OpenAI", "base_url": "https://api.openai.com/v1",
               "models": [("gpt-4o-mini", "GPT-4o mini"), ("gpt-4o", "GPT-4o")]},
    "moonshot": {"name": "Moonshot Kimi", "base_url": "https://api.moonshot.cn/v1",
                 "models": [("moonshot-v1-8k", "Kimi 8K"), ("moonshot-v1-32k", "Kimi 32K"), ("kimi-latest", "Kimi Latest")]},
    "qwen": {"name": "通义千问", "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
             "models": [("qwen-plus", "Qwen-Plus"), ("qwen-max", "Qwen-Max"), ("qwen-turbo", "Qwen-Turbo")]},
    "xai": {"name": "xAI Grok", "base_url": "https://api.x.ai/v1",
            "models": [("grok-2", "Grok 2")]},
    "doubao": {"name": "豆包（火山方舟）", "base_url": "https://ark.cn-beijing.volces.com/api/v3",
               "models": None},  # 用户填 ep- 接入点
}


def add_online_service(service_key: str, api_key: str, base_url: str = "", models: str = ""):
    if not api_key.strip():
        raise ValueError("API Key 不能为空")
    if service_key == "custom":
        if not base_url.strip():
            raise ValueError("自定义服务需填写 Base URL（OpenAI 兼容接口）")
        models_list = [m.strip() for m in models.split(",") if m.strip()]
        if not models_list:
            raise ValueError("自定义服务需至少填写一个模型名（逗号分隔）")
        prov_key = f"custom_{uuid.uuid4().hex[:6]}"
        name = "自定义线上模型"
        base = base_url.strip().rstrip("/")
        model_defs = [(m, m) for m in models_list]
    elif service_key in ONLINE_SERVICES:
        svc = ONLINE_SERVICES[service_key]
        prov_key = service_key
        name = svc["name"]
        base = svc["base_url"]
        if svc.get("models"):
            model_defs = svc["models"]
        else:
            models_list = [m.strip() for m in models.split(",") if m.strip()]
            if not models_list:
                raise ValueError(f"{name} 需填写模型 ID 或推理接入点 ID（豆包为 ep- 开头）")
            model_defs = [(m, m) for m in models_list]
    else:
        raise ValueError(f"未知服务：{service_key}")

    existing = db.query_one("SELECT id FROM api_connections WHERE name=? AND provider_type=?",
                            (name, prov_key))
    if existing:
        conn_id = existing["id"]
        db.execute("UPDATE api_connections SET encrypted_key=?, key_hint=?, extra_config_json=? WHERE id=?",
                   (api_key, _key_hint(api_key), "{}", conn_id))
    else:
        conn_id = f"conn_{uuid.uuid4().hex[:8]}"
        db.execute("INSERT INTO api_connections (id, name, provider_type, encrypted_key, key_hint, extra_config_json) "
                   "VALUES (?,?,?,?,?,?)",
                   (conn_id, name, prov_key, api_key, _key_hint(api_key), "{}"))

    prov = db.query_one("SELECT id FROM model_providers WHERE provider_key=?", (prov_key,))
    if prov:
        provider_id = prov["id"]
        db.execute("UPDATE model_providers SET api_connection_id=?, base_url=?, enabled=1 WHERE id=?",
                   (conn_id, base, provider_id))
    else:
        provider_id = f"prov_{uuid.uuid4().hex[:8]}"
        db.execute(
            "INSERT INTO model_providers (id, provider_key, name, base_url, api_connection_id, capabilities_json, enabled) "
            "VALUES (?,?,?,?,?,?,1)",
            (provider_id, prov_key, name, base, conn_id,
             json.dumps({"tool_calling": True, "json_mode": True, "vision": False, "streaming": True}, ensure_ascii=False)))

    added = 0
    for mkey, disp in model_defs:
        has = db.query_one("SELECT id FROM models WHERE provider_id=? AND model_key=?", (provider_id, mkey))
        if not has:
            db.execute(
                "INSERT INTO models (id, provider_id, model_key, display_name, capabilities_json, context_window, enabled) "
                "VALUES (?,?,?,?,NULL,0,1)",
                (f"model_{uuid.uuid4().hex[:10]}", provider_id, mkey, disp))
            added += 1
    return {"provider_id": provider_id, "connection_id": conn_id, "models_added": added,
            "provider_key": prov_key, "name": name}


def add_local_model(name: str, base_url: str, models: str):
    base = (base_url or "").strip().rstrip("/")
    model_defs = [(m.strip(), m.strip()) for m in (models or "").split(",") if m.strip()]
    if not base:
        raise ValueError("本地模型需填写 Base URL")
    if not model_defs:
        raise ValueError("本地模型需至少填写一个模型名")
    provider_id = f"prov_{uuid.uuid4().hex[:8]}"
    db.execute(
        "INSERT INTO model_providers (id, provider_key, name, base_url, api_connection_id, capabilities_json, enabled) "
        "VALUES (?,?,?,?,NULL,?,1)",
        (provider_id, "local_" + uuid.uuid4().hex[:8], name.strip() or "本地模型", base,
         json.dumps({"tool_calling": False, "json_mode": True, "vision": False, "streaming": True}, ensure_ascii=False)))
    for mkey, disp in model_defs:
        db.execute(
            "INSERT INTO models (id, provider_id, model_key, display_name, capabilities_json, context_window, enabled) "
            "VALUES (?,?,?,?,NULL,0,1)",
            (f"model_{uuid.uuid4().hex[:10]}", provider_id, mkey, disp))
    return {"provider_id": provider_id, "name": name.strip() or "本地模型", "base_url": base,
            "models_added": len(model_defs)}


def _key_hint(plain):
    """末 4 位提示（仅展示用）。"""
    if not plain:
        return ""
    return "••••" + plain[-4:] if len(plain) >= 4 else "••••"


def list_connections():
    return [{"id": c["id"], "name": c["name"], "provider_type": c["provider_type"],
             "key_hint": c["key_hint"], "created_at": c["created_at"]}
            for c in db.query("SELECT * FROM api_connections ORDER BY created_at")]


def create_connection(data):
    cid = f"conn_{uuid.uuid4().hex[:8]}"
    key = data.api_key or ""
    db.execute(
        "INSERT INTO api_connections (id, name, provider_type, encrypted_key, key_hint, extra_config_json) "
        "VALUES (?,?,?,?,?,?)",
        (cid, data.name, data.provider_type, key, _key_hint(key), json.dumps(data.extra_config, ensure_ascii=False)))
    return {"id": cid, "name": data.name, "provider_type": data.provider_type, "key_hint": _key_hint(key)}


def delete_connection(conn_id):
    db.execute("DELETE FROM api_connections WHERE id=?", (conn_id,))
    return {"id": conn_id, "deleted": True}


# ================= n8n 引擎 =================

def _n8n_token_hint(tok):
    if not tok:
        return None
    return _key_hint(tok)


def list_n8n_instances():
    out = []
    for r in db.query("SELECT * FROM n8n_instances ORDER BY created_at"):
        d = dict(r)
        d["token_hint"] = _n8n_token_hint(d.get("token") or "")
        d.pop("token", None)
        out.append(d)
    return out


def create_n8n_instance(data):
    nid = f"n8n_{uuid.uuid4().hex[:8]}"
    db.execute(
        "INSERT INTO n8n_instances (id, name, endpoint, token, description, status) "
        "VALUES (?,?,?,?,?,'enabled')",
        (nid, data.name, data.endpoint, data.token or "", data.description))
    return {"id": nid}


def delete_n8n_instance(n8n_id):
    db.execute("DELETE FROM n8n_instances WHERE id=?", (n8n_id,))
    return {"id": n8n_id, "deleted": True}


__all__ = ["list_providers", "create_provider", "delete_provider", "add_online_service", "add_local_model",
           "list_connections", "create_connection", "delete_connection",
           "list_n8n_instances", "create_n8n_instance", "delete_n8n_instance"]
