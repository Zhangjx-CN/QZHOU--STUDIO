# -*- coding: utf-8 -*-
"""项目：业务工作区（项目文件 data/projects.json 为唯一数据源）。"""
import datetime
import json
import os
import re
import time
import uuid

from .db import PROJECT_ROOT

PROJECT_INDEX_PATH = os.path.join(PROJECT_ROOT, "data", "projects.json")
PROJECT_INFO_FILENAME = "项目信息.json"


def _project_info_path(folder):
    return os.path.join(folder, PROJECT_INFO_FILENAME)


def _write_project_info(item):
    """在项目文件夹内写入命名信息文件（保存项目信息与产出清单）。"""
    fp = item.get("folder_path") or ""
    if not fp:
        return
    try:
        os.makedirs(fp, exist_ok=True)
        with open(_project_info_path(fp), "w", encoding="utf-8") as f:
            json.dump(item, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def _load_project_index():
    """读取项目文件：data/projects.json（每个生成的项目一条记录，含文件夹地址与产出清单）。"""
    if not os.path.exists(PROJECT_INDEX_PATH):
        return []
    try:
        with open(PROJECT_INDEX_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_project_index(items):
    with open(PROJECT_INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)


def list_projects():
    return _load_project_index()


def get_project(pid):
    return next((p for p in _load_project_index() if p["id"] == pid), None)


def create_project(name, description="", folder_path="", cover=""):
    pid = f"proj_{uuid.uuid4().hex[:8]}"
    folder = folder_path.strip()
    safe = re.sub(r'[\\/:*?"<>|\r\n]', "_", name).strip(" .")[:40] or "project"
    if folder:
        folder = os.path.join(folder, safe)
    else:
        folder = os.path.join(PROJECT_ROOT, "Dialogue", f"{time.strftime('%Y%m%d-%H%M%S')}-{safe}")
    os.makedirs(os.path.abspath(folder), exist_ok=True)
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    item = {"id": pid, "name": name, "description": description, "folder_path": folder,
            "created_at": now, "updated_at": now, "materials": [], "cover": cover.strip()}
    items = _load_project_index()
    items.insert(0, item)
    _save_project_index(items)
    _write_project_info(item)
    return item


def delete_project(pid):
    items0 = _load_project_index()
    if not any(p.get("id") == pid for p in items0):
        return None
    items = [p for p in items0 if p["id"] != pid]
    _save_project_index(items)
    return {"id": pid, "deleted": True}


def update_project(pid, name=None, description=None, folder_path=None, cover=None):
    """重命名 / 更新项目字段（仅更新传入的非 None 字段）。"""
    items = _load_project_index()
    item = next((p for p in items if p["id"] == pid), None)
    if not item:
        return None
    if name is not None:
        item["name"] = name
    if description is not None:
        item["description"] = description
    if folder_path is not None:
        item["folder_path"] = folder_path
    if cover is not None:
        item["cover"] = cover
    item["updated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    _save_project_index(items)
    _write_project_info(item)
    return item


def _touch_project_material(save_dir, file_path):
    """把生成的产出登记进所属项目的项目文件（materials 清单）。"""
    if not save_dir or not file_path:
        return
    abs_dir = os.path.abspath(save_dir)
    items = _load_project_index()
    changed = False
    for p in items:
        fp = p.get("folder_path") or ""
        if fp:
            abs_fp = os.path.abspath(fp)
            if abs_dir == abs_fp or abs_dir.startswith(abs_fp + os.sep):
                mats = p.setdefault("materials", [])
                now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
                mats.insert(0, {"file": os.path.basename(file_path), "path": file_path, "time": now})
                p["updated_at"] = now
                changed = True
                break
    if changed:
        _save_project_index(items)
        for p in items:
            if p.get("folder_path"):
                _write_project_info(p)


def list_project_files(project_id: str):
    """项目产出文件：扫描项目文件夹（模型生成的文件将出现在这里，可右键另存为/打开）。"""
    p = next((x for x in _load_project_index() if x["id"] == project_id), None)
    folder = (p or {}).get("folder_path") or ""
    files = []
    if folder and os.path.isdir(folder):
        try:
            names = sorted(os.listdir(folder),
                           key=lambda n: os.path.getmtime(os.path.join(folder, n)) if os.path.isfile(os.path.join(folder, n)) else 0,
                           reverse=True)
        except Exception:
            names = []
        for name in names:
            fp = os.path.join(folder, name)
            if os.path.isfile(fp):
                try:
                    files.append({
                        "name": name, "path": fp, "size": os.path.getsize(fp),
                        "modified": time.strftime("%Y-%m-%d %H:%M", time.localtime(os.path.getmtime(fp))),
                    })
                except Exception:
                    continue
    return {"project_id": project_id, "folder": folder, "files": files}


__all__ = ["list_projects", "get_project", "create_project", "delete_project", "update_project", "list_project_files"]
