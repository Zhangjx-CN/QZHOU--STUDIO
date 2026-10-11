# -*- coding: utf-8 -*-
"""SQLite 数据层（2026-09-18 模块库清档：_migrate 简化、_cleanup_presets 删除）。"""
import sqlite3
import os
import threading

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
DB_PATH = os.path.join(DATA_DIR, "app.db")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
WORKSPACE_DIR = os.path.join(DATA_DIR, "workspace")

_local = threading.local()

# 2026-09-18：模块库字段（recipes.pipeline_json 等）暂不主动删除，避免破坏现有数据；
# 这些列在 SQLite 上不能直接 DROP，需要以迁移表的方式清理，下一轮再做。
SCHEMA = """
-- ============ 历史「配方」表（暂留，旧数据兼容） ============
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY, plugin_id TEXT, name TEXT NOT NULL,
  description TEXT, category TEXT, system_prompt TEXT, model_id TEXT,
  input_schema_json TEXT, output_schema_json TEXT,
  memory_scope_json TEXT, config_json TEXT,
  status TEXT DEFAULT 'draft', current_version INTEGER DEFAULT 1,
  keywords TEXT, deleted_at TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT,
  runtime_type TEXT DEFAULT 'model', avatar TEXT,
  runtime_config_json TEXT, pipeline_json TEXT
);
CREATE TABLE IF NOT EXISTS recipe_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, recipe_id TEXT NOT NULL,
  version INTEGER NOT NULL, name TEXT, description TEXT, system_prompt TEXT,
  model_id TEXT, model_snapshot TEXT, tool_ids_json TEXT,
  input_schema_json TEXT, output_schema_json TEXT, config_json TEXT,
  runtime_type TEXT, runtime_config_json TEXT, keywords TEXT, pipeline_json TEXT,
  changelog TEXT, created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(recipe_id, version)
);
CREATE TABLE IF NOT EXISTS recipe_tools (
  recipe_id TEXT, tool_id TEXT, permissions_json TEXT, enabled INTEGER DEFAULT 1,
  PRIMARY KEY(recipe_id, tool_id)
);
CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY, tool_key TEXT UNIQUE NOT NULL, plugin_id TEXT,
  name TEXT, description TEXT, version TEXT, category TEXT,
  input_schema_json TEXT, output_schema_json TEXT,
  permissions_required_json TEXT, status TEXT DEFAULT 'enabled',
  config_json TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT
);

-- ============ 模型 / 连接 / n8n ============
CREATE TABLE IF NOT EXISTS api_connections (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, provider_type TEXT NOT NULL,
  encrypted_key BLOB, key_hint TEXT, extra_config_json TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT
);
CREATE TABLE IF NOT EXISTS model_providers (
  id TEXT PRIMARY KEY, provider_key TEXT UNIQUE NOT NULL, name TEXT,
  base_url TEXT, api_connection_id TEXT,
  capabilities_json TEXT, enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY, provider_id TEXT, model_key TEXT NOT NULL, display_name TEXT,
  capabilities_json TEXT, context_window INTEGER, enabled INTEGER DEFAULT 1,
  UNIQUE(provider_id, model_key)
);
CREATE TABLE IF NOT EXISTS n8n_instances (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, endpoint TEXT NOT NULL,
  token TEXT, description TEXT, status TEXT DEFAULT 'enabled',
  created_at TEXT DEFAULT (datetime('now'))
);

-- ============ 运行与日志（兼容旧 execution_logs，但不再写入） ============
CREATE TABLE IF NOT EXISTS execution_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id TEXT, recipe_version_id INTEGER,
  workflow_id TEXT, workflow_version INTEGER,
  node_run_id TEXT, task_run_id TEXT,
  model_provider TEXT, model_name TEXT,
  execution_time TEXT DEFAULT (datetime('now')),
  input_json TEXT, output_json TEXT, status TEXT,
  token_usage_json TEXT, cost_estimate REAL, duration_ms INTEGER
);

-- ============ 任务（历史） ============
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
  status TEXT DEFAULT 'pending', recipe_id TEXT, input_text TEXT,
  output_file TEXT, output_summary TEXT,
  created_at TEXT DEFAULT (datetime('now')), completed_at TEXT
);

-- ============ 项目 ============
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
  folder_path TEXT, cover TEXT,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);

-- ============ 会话 ============
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
  meta_json TEXT, created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_key, id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT, action TEXT, resource_type TEXT, resource_id TEXT,
  detail_json TEXT, created_at TEXT DEFAULT (datetime('now'))
);
"""


def get_conn():
    conn = getattr(_local, "conn", None)
    if conn is None:
        os.makedirs(DATA_DIR, exist_ok=True)
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
    return conn


def init_db():
    conn = get_conn()
    conn.executescript(SCHEMA)
    conn.commit()


def execute(sql, params=()):
    cur = get_conn().execute(sql, params)
    get_conn().commit()
    return cur


def query(sql, params=()):
    return get_conn().execute(sql, params).fetchall()


def query_one(sql, params=()):
    return get_conn().execute(sql, params).fetchone()


def last_id():
    return get_conn().execute("SELECT last_insert_rowid()").fetchone()[0]
