# -*- coding: utf-8 -*-
"""轻舟 · FastAPI 本地守护进程入口（2026-09-18 模块库清档：删 ensure_default_tools）。"""
import os
import secrets
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from .api import router
from .db import DATA_DIR, UPLOAD_DIR
from .seed import seed_once

os.makedirs(UPLOAD_DIR, exist_ok=True)
PORT = int(os.environ.get("AIBO_PORT", "8000"))

TOKEN_PATH = os.path.join(DATA_DIR, ".aibo_token")
DEV_ORIGINS = ("http://localhost:5173", "http://127.0.0.1:5173")
# 开发模式（AIBO_DEV=1）下 vite dev server 免 token；Electron 生产模式不开放此通道。
DEV_MODE = os.environ.get("AIBO_DEV") == "1"


def _load_or_create_token() -> str:
    try:
        if os.path.exists(TOKEN_PATH):
            t = open(TOKEN_PATH, encoding="utf-8").read().strip()
            if t:
                return t
    except Exception:
        pass
    t = secrets.token_hex(24)
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(TOKEN_PATH, "w", encoding="utf-8") as f:
        f.write(t)
    return t


AIBO_TOKEN = _load_or_create_token()


class TokenAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.method == "OPTIONS" or request.url.path == "/api/health":
            return await call_next(request)
        # 静态文件：生产模式只认 ?token=xxx 的签名地址（<img> 标签无法加自定义请求头）；
        # dev 模式下来自 vite dev server 的请求放行。
        if request.url.path.startswith("/static/"):
            origin = request.headers.get("origin", "")
            if DEV_MODE and origin in DEV_ORIGINS:
                return await call_next(request)
            if request.method == "GET" and request.query_params.get("token") == AIBO_TOKEN:
                return await call_next(request)
            return JSONResponse({"detail": "未授权：静态文件访问被拒绝"}, status_code=401)
        # dev 模式（AIBO_DEV=1）下 vite dev server 免 token，方便本地开发
        if DEV_MODE:
            origin = request.headers.get("origin", "")
            if origin in DEV_ORIGINS:
                return await call_next(request)
        if request.headers.get("x-aibo-token") == AIBO_TOKEN:
            return await call_next(request)
        return JSONResponse({"detail": "未授权：缺少本地访问令牌"}, status_code=401)


@asynccontextmanager
async def lifespan(app: FastAPI):
    seed_once()
    yield


app = FastAPI(title="轻舟", version="0.1.0",
              description="本地统一 AI 调度壳（工作流 / 模型 / n8n 调用）", lifespan=lifespan)

# Electron 生产模式下前端是 file:// 页面，Origin 头为字符串 "null"，必须放行，否则前端连不上后端。
# 安全不依赖 CORS：真正的闸门是 TokenAuthMiddleware——恶意网页拿不到本地 token
#（token 只经 Electron preload 的 IPC 通道从本地文件读取，网页没有这个通道）。
_cors_origins = (["http://localhost:5173", "http://127.0.0.1:5173"] if DEV_MODE else []) + ["null"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(TokenAuthMiddleware)

app.mount("/static", StaticFiles(directory=UPLOAD_DIR), name="static")
app.include_router(router)


if __name__ == "__main__":
    import uvicorn
    print(f"[轻舟] 本地服务启动: http://127.0.0.1:{PORT}")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
