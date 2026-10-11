# -*- coding: utf-8 -*-
"""Pydantic 请求/响应模型（2026-09-18 模块库清档）：删 RecipeCreate/Update/MarketCollectRequest/TaskCreate/TaskRun。"""
from typing import Optional, List
from pydantic import BaseModel, Field


class ApiConnectionCreate(BaseModel):
    name: str
    provider_type: str
    api_key: str = ""
    base_url: Optional[str] = None
    extra_config: dict = {}


class ProviderCreate(BaseModel):
    provider_key: str
    name: str = ""
    base_url: Optional[str] = None
    api_connection_id: Optional[str] = None
    capabilities: dict = {}
    enabled: bool = True


class OnlineServiceAdd(BaseModel):
    service_key: str  # deepseek | zhipu | openai | moonshot | qwen | xai | doubao | custom
    api_key: str
    base_url: str = ""
    models: str = ""


class LocalModelCreate(BaseModel):
    """本地 OpenAI 兼容服务（Ollama / LM Studio / vLLM 等）。"""
    name: str = "本地模型"
    base_url: str = Field(..., min_length=1)
    models: str = Field(..., min_length=1)


class CommandRequest(BaseModel):
    """统一对话请求：模型 / n8n / agent 都用这一份。"""
    message: str
    project_id: Optional[str] = None     # 会话上下文：按项目隔离
    model_id: Optional[str] = None       # 直接选已注册模型
    n8n_id: Optional[str] = None         # 或选 n8n 实例
    agent_id: Optional[str] = None       # 或选 agent库 条目
    image: Optional[str] = None          # 多模态：图片引用（/static/xxx 或 data URL）


class FileSave(BaseModel):
    content: str
    save_dir: str = ""
    filename_hint: str = ""
    meta: dict = {}


class FileSaveAs(BaseModel):
    content: str
    path: str
    meta: dict = {}


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str = ""
    folder_path: str = ""
    cover: str = ""


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    description: Optional[str] = None
    folder_path: Optional[str] = None
    cover: Optional[str] = None


class N8nInstanceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    endpoint: str = Field(..., min_length=1)
    token: str = ""
    description: str = ""


class AgentEntryCreate(BaseModel):
    """agent库条目：外部 AI 连接信息与调用示例。"""
    name: str = Field(..., min_length=1, max_length=120)
    description: str = ""
    endpoint: str = ""
    code: str = ""          # ① 调用示例代码
    stream_code: str = ""   # ② SSE 流监控代码
    api_key: str = ""


class AgentEntryUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    description: Optional[str] = None
    endpoint: Optional[str] = None
    code: Optional[str] = None
    stream_code: Optional[str] = None
    api_key: Optional[str] = None


class ArkCsvSessionCreate(BaseModel):
    """真实方舟写操作：上传 CSV 并创建 Agent Session。"""
    base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    api_key: str = ""
    agent_id: str = Field(..., min_length=1)
    environment_id: str = Field(..., min_length=1)
    local_csv_path: str = Field(..., min_length=1)
    name: str = "火山方舟 CSV 会话"
    description: str = "通过 CSV 创建的火山方舟 Agent 会话"
