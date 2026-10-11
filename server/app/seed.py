# -*- coding: utf-8 -*-
"""最小种子（2026-09-18 模块库清档）：只 seed 一个本地 Ollama 占位 provider + 模型。
用户自建 / 添加模型 / n8n 实例：到「模型与连接」页一键接入。
"""
import json
from . import db


def seed_once():
    db.init_db()
    # 已经接入任何 provider → 不做预设
    has = db.query_one("SELECT COUNT(*) AS c FROM model_providers")
    if has and has["c"] > 0:
        return False
    # 默认补一个本地 Ollama 占位（用户未启动也无所谓：调用时友好报错）
    providers = [
        ("prov_local", "local", "本地模型 (Ollama)", "http://localhost:11434/v1",
         {"tool_calling": False, "json_mode": False, "vision": False, "streaming": True, "context_window": 32000}),
    ]
    for pid, key, name, url, cap in providers:
        db.execute(
            "INSERT INTO model_providers (id, provider_key, name, base_url, api_connection_id, capabilities_json, enabled) "
            "VALUES (?,?,?,?,NULL,?,1)",
            (pid, key, name, url, json.dumps(cap, ensure_ascii=False)))
    models = [("prov_local", "llama3.1", "Llama 3.1 (本地)")]
    for pid, key, disp in models:
        db.execute("INSERT INTO models (id, provider_id, model_key, display_name, capabilities_json, context_window, enabled) "
                   "VALUES (?,?,?,?,NULL,0,1)",
                   ("model_" + key, pid, key, disp))
    return True
