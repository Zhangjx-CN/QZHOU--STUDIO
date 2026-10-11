# -*- coding: utf-8 -*-
"""材料保存（2026-09-18 模块库清档：删 recipe_name 引用，recipe_id 参数保留兼容）。"""
import os
import re
import time

from . import projects
from .db import PROJECT_ROOT


def _allowed_write_roots():
    roots = [os.path.abspath(os.path.join(PROJECT_ROOT, "data", "workspace"))]
    for p in projects._load_project_index():
        fp = p.get("folder_path") or ""
        if fp:
            roots.append(os.path.abspath(fp))
    return roots


def _is_path_allowed(target: str) -> bool:
    t = os.path.realpath(os.path.abspath(target))
    for r in _allowed_write_roots():
        r = os.path.realpath(os.path.abspath(r))
        if t == r or t.startswith(r + os.sep):
            return True
    return False


def save_material(content, save_dir="", filename_hint="", recipe_id=None, meta=None):
    if not content or not content.strip():
        return None
    base = (save_dir or "").strip() or os.path.join(PROJECT_ROOT, "data", "workspace")
    base = os.path.abspath(base)
    if not _is_path_allowed(base):
        raise ValueError("保存目录超出允许范围（仅限项目文件夹与本地工作区）")
    os.makedirs(base, exist_ok=True)
    hint0 = (filename_hint or "material").strip()
    ext = ".md"
    _ext = os.path.splitext(hint0)[1].lower()
    if _ext in (".md", ".markdown", ".txt", ".html", ".htm", ".json", ".csv", ".log", ".xml", ".yaml", ".yml"):
        ext = _ext
        hint0 = os.path.splitext(hint0)[0]
    safe = re.sub(r'[\\/:*?"<>|\r\n]', "_", hint0).strip(" .")[:60] or "material"
    ts = time.strftime("%Y%m%d-%H%M%S")
    fname = f"{ts}-{safe}{ext}"
    path = os.path.join(base, fname)
    lines = [
        "# 轻舟 · 生成材料",
        "",
        f"- 生成时间：{time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 来源：{meta.get('source', '对话') if meta else '对话'}",
    ]
    if meta:
        if meta.get("target_name"):
            lines.append(f"- 目标：{meta['target_name']}")
        if meta.get("message"):
            lines.append(f"- 指令：{meta['message']}")
    lines += ["", "---", "", content, ""]
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    return {"path": path, "filename": fname, "size": os.path.getsize(path), "saved_at": ts}


def save_as(content, path, recipe_id=None, meta=None):
    if not content or not content.strip():
        return None
    if not _is_path_allowed(path):
        raise ValueError("保存路径超出允许范围")
    abspath = os.path.abspath(path)
    os.makedirs(os.path.dirname(abspath), exist_ok=True)
    with open(abspath, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    return {"path": abspath, "filename": os.path.basename(abspath), "size": os.path.getsize(abspath)}


__all__ = ["save_material", "save_as"]
