# -*- coding: utf-8 -*-
"""数据后台：按「模型 / 项目 / 工作流」维度统计（2026-09-18 模块库清档）。
无 配方 维度。"""
import os
import time

from . import db
from .db import PROJECT_ROOT
from .agents import list_agents


def dashboard_stats():
    """前端 Dashboard 新接口契约：providers/models/n8n_instances/projects/sessions + cost.per_model。"""
    providers = db.query_one("SELECT COUNT(*) AS c FROM model_providers WHERE enabled=1")["c"]
    models = db.query_one("SELECT COUNT(*) AS c FROM models WHERE enabled=1")["c"]
    n8n = db.query_one("SELECT COUNT(*) AS c FROM n8n_instances WHERE status='enabled'")["c"]
    projects = db.query_one("SELECT COUNT(*) AS c FROM projects")["c"]
    sessions = db.query_one("SELECT COUNT(DISTINCT session_key) AS c FROM chat_messages WHERE session_key != ''")["c"]
    live = "json_extract(input_json, '$.source') = 'live_router'"
    cost = db.query_one(
        f"SELECT COALESCE(SUM(cost_estimate),0) AS total, COUNT(*) AS calls, "
        f"SUM(CASE WHEN cost_estimate > 0 THEN 1 ELSE 0 END) AS priced_calls, "
        f"COALESCE(SUM(CAST(json_extract(token_usage_json, '$.tokens') AS INTEGER)),0) AS tokens "
        f"FROM execution_logs WHERE {live}")
    today = db.query_one(
        f"SELECT COALESCE(SUM(cost_estimate),0) AS t FROM execution_logs WHERE {live} AND date(execution_time)=date('now')")
    # 「做实仪表台」补的三个真实指标：今日调用 / 成功率 / 平均耗时
    today_calls = db.query_one(
        f"SELECT COUNT(*) AS c FROM execution_logs WHERE {live} AND date(execution_time)=date('now')")["c"]
    ok_calls = db.query_one(f"SELECT COUNT(*) AS c FROM execution_logs WHERE {live} AND status='completed'")["c"]
    total_calls = db.query_one(f"SELECT COUNT(*) AS c FROM execution_logs WHERE {live}")["c"]
    avg_dur = db.query_one(
        f"SELECT COALESCE(AVG(duration_ms),0) AS d FROM execution_logs WHERE {live} AND duration_ms > 0")["d"]
    per_model = [dict(r) for r in db.query(
        "SELECT model_name AS model_key, COUNT(*) AS calls, "
        "COALESCE(SUM(CAST(json_extract(token_usage_json, '$.tokens') AS INTEGER)),0) AS tokens, "
        "ROUND(COALESCE(SUM(cost_estimate),0),4) AS cost "
        f"FROM execution_logs WHERE {live} AND model_name IS NOT NULL "
        "GROUP BY model_name ORDER BY cost DESC LIMIT 12")]
    model_inventory = [dict(r) for r in db.query(
        "SELECT p.name AS provider_name, mo.model_key, mo.display_name, mo.enabled, "
        "COALESCE(x.calls, 0) AS calls, COALESCE(x.last_used, '') AS last_used "
        "FROM models mo JOIN model_providers p ON p.id=mo.provider_id "
        "LEFT JOIN (SELECT model_name, COUNT(*) AS calls, MAX(execution_time) AS last_used "
        f"           FROM execution_logs WHERE {live} GROUP BY model_name) x ON x.model_name=mo.model_key "
        "WHERE p.enabled=1 ORDER BY p.name, mo.display_name")]
    agent_inventory = []
    for a in list_agents():
        row = db.query_one(
            "SELECT COUNT(*) AS calls, COALESCE(MAX(execution_time), '') AS last_used "
            "FROM execution_logs WHERE " + live + " AND json_extract(input_json, '$.target_type')='agent' "
            "AND model_name=?", (a.get("name"),))
        agent_inventory.append({"name": a.get("name") or "agent", "description": a.get("description") or "",
                                "available": bool(a.get("endpoint") and a.get("key_hint")),
                                "calls": row["calls"], "last_used": row["last_used"]})
    logs = [dict(r) for r in db.query(
        "SELECT model_provider, model_name, status, cost_estimate, duration_ms, execution_time, token_usage_json, "
        "json_extract(input_json, '$.target_type') AS target_type "
        f"FROM execution_logs WHERE {live} ORDER BY execution_time DESC LIMIT 8")]
    return {
        "providers": providers,
        "models": models,
        "n8n_instances": n8n,
        "projects": projects,
        "sessions": sessions,
        "cost": {"total": round(cost["total"] or 0, 4),
                 "calls": cost["calls"],
                 "priced_calls": cost["priced_calls"] or 0,
                 "tokens": cost["tokens"] or 0,
                 "today": round(today["t"] or 0, 4),
                 "per_model": per_model},
        "model_inventory": model_inventory,
        "agent_inventory": agent_inventory,
        "calls_today": today_calls,
        "calls_total": total_calls,
        "calls_success": ok_calls,
        "success_rate": round(ok_calls / total_calls * 100, 1) if total_calls else None,
        "avg_duration_ms": round(avg_dur or 0),
        "recent_logs": logs,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


def recent_recipes(limit=5):
    """历史入口（前端不再调），保留避免 api.py 路由 500。"""
    return []


def app_config():
    return {"dialogue_root": os.path.join(PROJECT_ROOT, "Dialogue")}


__all__ = ["dashboard_stats", "recent_recipes", "app_config"]
