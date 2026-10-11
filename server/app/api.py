# -*- coding: utf-8 -*-
"""FastAPI 路由层（2026-09-18 模块库清档）。
- 保留：模型 / API 连接 / n8n / 项目 / 材料 / 对话 / 文件上传 / Dashboard / Health
- 删除：recipes/* / market/collect / tools / tasks / command(非流式) / recent-recipes
"""
import json
import os
import time
import uuid

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse

from . import adapters as ad
from . import services as svc
from .db import UPLOAD_DIR
from .schemas import (ApiConnectionCreate, ProviderCreate, OnlineServiceAdd, LocalModelCreate,
                      CommandRequest, FileSave, FileSaveAs, ProjectCreate, ProjectUpdate, N8nInstanceCreate,
                      AgentEntryCreate, AgentEntryUpdate, ArkCsvSessionCreate)

router = APIRouter(prefix="/api")
ALLOWED_IMG_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
MAX_IMG_SIZE = 8 * 1024 * 1024


# ---------------- 文件上传 ----------------

@router.post("/upload")
async def api_upload(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "文件名为空")
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_IMG_EXT:
        raise HTTPException(400, f"不支持的格式：{ext}（仅支持 png/jpg/jpeg/gif/webp/svg）")
    content = await file.read()
    if len(content) > MAX_IMG_SIZE:
        raise HTTPException(400, f"文件过大：{len(content)//1024}KB（上限8MB）")
    safe_name = f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:8]}{ext}"
    dest = os.path.join(UPLOAD_DIR, safe_name)
    with open(dest, "wb") as f:
        f.write(content)
    return {"url": f"/static/{safe_name}", "filename": safe_name, "size": len(content)}


@router.post("/assistant/avatar")
async def api_set_assistant_avatar(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(400, "文件名为空")
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_IMG_EXT:
        raise HTTPException(400, f"不支持的格式：{ext}")
    content = await file.read()
    if len(content) > MAX_IMG_SIZE:
        raise HTTPException(400, f"文件过大：{len(content)//1024}KB（上限8MB）")
    try:
        from io import BytesIO
        from PIL import Image
        img = Image.open(BytesIO(content))
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        img.thumbnail((512, 512), Image.LANCZOS)
        buf = BytesIO()
        img.save(buf, format="PNG", optimize=True)
        content = buf.getvalue()
    except Exception:
        pass
    dest = os.path.join(UPLOAD_DIR, "assistant-avatar.png")
    with open(dest, "wb") as f:
        f.write(content)
    return {"url": "/static/assistant-avatar.png", "size": len(content)}


# ---------------- 对话：统一入口 ----------------

@router.post("/command/stream")
def api_command_stream(data: CommandRequest):
    """统一对话流式入口（模型 或 n8n 任选其一）。"""
    if not data.message.strip():
        raise HTTPException(400, "指令不能为空")
    sess = data.project_id or "default"
    body = {"message": data.message, "project_id": sess,
            "model_id": data.model_id, "n8n_id": data.n8n_id,
            "agent_id": data.agent_id, "image": data.image}

    def gen():
        for evt in svc.stream_chat(data.message, project_id=sess,
                                    model_id=data.model_id, n8n_id=data.n8n_id,
                                    agent_id=data.agent_id, image=data.image):
            yield f"data: {json.dumps(evt, ensure_ascii=False)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


# ---------------- 模型 / API 连接 / n8n ----------------

@router.get("/models/providers")
def api_list_providers():
    return svc.list_providers()


@router.post("/models/providers")
def api_create_provider(data: ProviderCreate):
    return {"id": svc.create_provider(data)}


@router.delete("/models/providers/{provider_id}")
def api_delete_provider(provider_id: str):
    try:
        return svc.delete_provider(provider_id)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/api-connections")
def api_list_connections():
    return svc.list_connections()


@router.post("/api-connections")
def api_create_connection(data: ApiConnectionCreate):
    return svc.create_connection(data)


@router.delete("/api-connections/{conn_id}")
def api_delete_connection(conn_id: str):
    return svc.delete_connection(conn_id)


@router.post("/models/online-services")
def api_add_online_service(data: OnlineServiceAdd):
    try:
        return svc.add_online_service(data.service_key, data.api_key, data.base_url, data.models)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/models/local")
def api_add_local_model(data: LocalModelCreate):
    try:
        return svc.add_local_model(data.name, data.base_url, data.models)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/n8n-instances")
def api_list_n8n():
    return svc.list_n8n_instances()


@router.post("/n8n-instances")
def api_create_n8n(data: N8nInstanceCreate):
    return svc.create_n8n_instance(data)


@router.delete("/n8n-instances/{n8n_id}")
def api_delete_n8n(n8n_id: str):
    return svc.delete_n8n_instance(n8n_id)


# ---------------- agent库（真 agent：可在「对话」里选中直接调用） ----------------

@router.get("/agents")
def api_list_agents():
    return svc.list_agents()


@router.post("/agents")
def api_create_agent(data: AgentEntryCreate):
    try:
        return svc.create_agent(data.name, data.description, data.endpoint, data.code,
                                data.stream_code, data.api_key)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/agents/{agent_id}")
def api_get_agent(agent_id: str):
    r = svc.get_agent(agent_id)
    if not r:
        raise HTTPException(404, "条目不存在")
    return r


@router.put("/agents/{agent_id}")
def api_update_agent(agent_id: str, data: AgentEntryUpdate):
    r = svc.update_agent(agent_id, name=data.name, description=data.description,
                         endpoint=data.endpoint, code=data.code, stream_code=data.stream_code,
                         api_key=data.api_key)
    if not r:
        raise HTTPException(404, "条目不存在")
    return r


@router.delete("/agents/{agent_id}")
def api_delete_agent(agent_id: str):
    r = svc.delete_agent(agent_id)
    if not r:
        raise HTTPException(404, "条目不存在")
    return r


@router.get("/agents/{agent_id}/probe")
def api_probe_agent(agent_id: str):
    """链路通道探测：只开事件流、不推消息，**零 token 消耗**。
    用来判断 Key 是否被拒 / 账户是否欠费 / 通道通不通，不烧钱。"""
    r = svc.get_agent(agent_id)
    if not r:
        raise HTTPException(404, "条目不存在")
    return ad.probe_agent_channel(r.get("endpoint"), svc.reveal_agent_key(agent_id))


@router.get("/agents/{agent_id}/key")
def api_reveal_agent_key(agent_id: str):
    """本地保险库：返回解密后的明文 Key（仅本机）。"""
    k = svc.reveal_agent_key(agent_id)
    if k is None:
        raise HTTPException(404, "条目不存在")
    return {"api_key": k}


@router.post("/agents/from-csv")
def api_create_agent_from_csv(data: ArkCsvSessionCreate):
    """上传本地 CSV、创建真实方舟 Session，并落一条可调用 agent 条目。"""
    if not data.api_key.strip():
        raise HTTPException(400, "API Key 必填")
    try:
        file_id = ad.upload_agent_file(data.base_url, data.api_key, data.local_csv_path)
        endpoint = ad.create_agent_session(data.base_url, data.api_key, data.agent_id,
                                           data.environment_id, [file_id])
        return svc.create_agent(data.name, data.description, endpoint,
                                "", "", data.api_key)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))


# ---------------- 材料 / 项目 ----------------

@router.post("/files/save")
def api_save_file(data: FileSave):
    try:
        r = svc.save_material(data.content, data.save_dir, data.filename_hint, None, data.meta)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not r:
        raise HTTPException(400, "内容为空，无法保存")
    return r


@router.post("/files/save-as")
def api_save_as(data: FileSaveAs):
    try:
        r = svc.save_as(data.content, data.path, None, data.meta)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not r:
        raise HTTPException(400, "内容为空，无法保存")
    return r


@router.get("/projects")
def api_list_projects():
    return svc.list_projects()


@router.post("/projects")
def api_create_project(data: ProjectCreate):
    return svc.create_project(data.name, data.description, data.folder_path, data.cover)


@router.delete("/projects/{project_id}")
def api_delete_project(project_id: str):
    r = svc.delete_project(project_id)
    if not r:
        raise HTTPException(404, "项目不存在")
    return r


@router.put("/projects/{project_id}")
def api_update_project(project_id: str, data: ProjectUpdate):
    r = svc.update_project(project_id, name=data.name, description=data.description,
                           folder_path=data.folder_path, cover=data.cover)
    if not r:
        raise HTTPException(404, "项目不存在")
    return r


@router.get("/projects/{project_id}/history")
def api_project_history(project_id: str):
    return svc.project_history(project_id)


@router.get("/projects/{project_id}/files")
def api_project_files(project_id: str):
    return svc.list_project_files(project_id)


# ---------------- Dashboard / Health / AppConfig ----------------

@router.get("/dashboard")
def api_dashboard():
    return svc.dashboard_stats()


@router.get("/app-config")
def api_app_config():
    return svc.app_config()


@router.get("/health")
def api_health():
    return {"status": "ok", "service": "轻舟", "version": "0.1.0"}

@router.post("/shutdown")
def api_shutdown():
    """应用退出前清理由轻舟自动启动的本地推理进程。"""
    from .adapters import stop_owned_ollama
    stop_owned_ollama()
    return {"ok": True}
