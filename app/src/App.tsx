import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ToastProvider } from "./api/ui";
import Dashboard from "./pages/Dashboard";
import CommandCenter from "./pages/CommandCenter";
import ModelsApi from "./pages/ModelsApi";
import AgentLibrary from "./pages/AgentLibrary";
import ProjectFiles from "./pages/ProjectFiles";
import { api, ensureToken } from "./api/client";
import type { Project } from "./api/types";
import { useI18n } from "./i18n";

// 极简 hash 路由（不引入 react-router 依赖）
type View = "dashboard" | "chat" | "models" | "agents" | "files";
const VIEWS: View[] = ["dashboard", "chat", "models", "agents", "files"];

function useHashView(): [View, (v: View) => void] {
  const [view, setView] = useState<View>(() => {
    const h = (window.location.hash.replace(/^#\/?/, "") || "chat") as View;
    return (VIEWS.includes(h) ? h : "chat") as View;
  });
  useEffect(() => {
    const onHash = () => {
      const h = (window.location.hash.replace(/^#\/?/, "") || "chat") as View;
      setView((VIEWS.includes(h) ? h : "chat") as View);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return [view, (v) => { window.location.hash = "#/" + v; setView(v); }];
}

export default function App() {
  const { language, setLanguage, t } = useI18n();
  const [view, go] = useHashView();
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [loadKey, setLoadKey] = useState(0);
  const [showFiles, setShowFiles] = useState<Project | null>(null);

  // 过往项目操作菜单状态
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editFolder, setEditFolder] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [settingsPosition, setSettingsPosition] = useState<{ top: number; left: number } | null>(null);
  const [projectAddOpen, setProjectAddOpen] = useState(false);
  const [addPosition, setAddPosition] = useState<{ top: number; left: number } | null>(null);
  const [projectSubmenu, setProjectSubmenu] = useState<"group" | "filter" | null>(null);
  const [projectSort, setProjectSort] = useState<"updated" | "name">("updated");
  const [projectFilter, setProjectFilter] = useState<"all" | "active">("all");
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [newProjectFolder, setNewProjectFolder] = useState("");
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState("");
  const [showHistoryManager, setShowHistoryManager] = useState(false);

  const refreshProjects = async () => {
    try {
      const ps = await api.listProjects();
      setProjects(ps);
      if (activeProject) setActiveProject(ps.find(p => p.id === activeProject.id) || null);
    } catch { /* ignore */ }
  };
  const [imgAuthV, setImgAuthV] = useState(0);
  useEffect(() => {
    // 先确保本地 token 就绪：resolveImg 拼图片签名地址依赖它，完成后触发一次重渲染
    ensureToken().then(() => setImgAuthV(v => v + 1));
    refreshProjects();
  }, []);

  const visibleProjects = useMemo(() => {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const result = projects.filter(p => {
      if (projectFilter === "all" || activeProject?.id === p.id) return true;
      const updated = new Date(p.updated_at || p.created_at || "").getTime();
      return Number.isFinite(updated) && updated >= cutoff;
    });
    return result.sort((a, b) => projectSort === "name"
      ? a.name.localeCompare(b.name, "zh-CN")
      : new Date(b.updated_at || b.created_at || "").getTime() - new Date(a.updated_at || a.created_at || "").getTime());
  }, [projects, projectSort, projectFilter, activeProject?.id]);

  // 点击侧栏非 proj-item 区域时关闭菜单
  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".proj-item") && !t.closest(".proj-menu")) setMenuFor(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuFor]);

  useEffect(() => {
    if (!projectSettingsOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".project-settings-menu") && !t.closest(".project-toolbar")) {
        setProjectSettingsOpen(false);
        setProjectSubmenu(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [projectSettingsOpen]);

  useEffect(() => {
    if (!projectAddOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".project-add-menu") && !t.closest(".project-toolbar")) setProjectAddOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [projectAddOpen]);

  const selectProject = (p: Project) => {
    setActiveProject(p);
    setLoadKey(k => k + 1);
    setMenuFor(null);
  };

  const startNewConversation = () => {
    setActiveProject(null);
    setLoadKey(k => k + 1);
    setMenuFor(null);
    setRenamingId(null);
    setConfirmDel(null);
    setShowFiles(null);
    setProjectAddOpen(false);
    if (view !== "chat") go("chat");
  };
  const startRename = (p: Project) => {
    setRenamingId(p.id);
    setRenameValue(p.name);
    setMenuFor(null);
    setConfirmDel(null);
  };

  const startEdit = (p: Project) => {
    setEditingProject(p);
    setEditName(p.name);
    setEditDescription(p.description || "");
    setEditFolder(p.folder_path || "");
    setMenuFor(null);
    setConfirmDel(null);
  };

  const saveEdit = async () => {
    if (!editingProject || editSaving) return;
    const name = editName.trim();
    if (!name) return;
    setEditSaving(true);
    try {
      await api.updateProject(editingProject.id, {
        name,
        description: editDescription.trim(),
        folder_path: editFolder.trim(),
      });
      setEditingProject(null);
      await refreshProjects();
    } catch { /* ignore */ }
    finally { setEditSaving(false); }
  };

  const openCreateProject = () => {
    setNewProjectName("");
    setNewProjectDescription("");
    setNewProjectFolder("");
    setCreateError("");
    setCreatingProject(true);
    setProjectSettingsOpen(false);
    setProjectSubmenu(null);
    setProjectAddOpen(false);
  };

  const createProject = async () => {
    const name = newProjectName.trim();
    if (!name || createSaving) return;
    setCreateSaving(true);
    try {
      const p = await api.createProject({ name, description: newProjectDescription.trim(), folder_path: newProjectFolder.trim() });
      await refreshProjects();
      setActiveProject(p);
      setLoadKey(k => k + 1);
      setCreatingProject(false);
      if (view !== "chat") go("chat");
    } catch (e) { setCreateError("创建失败：" + (e as Error).message); }
    finally { setCreateSaving(false); }
  };

  const commitRename = async (p: Project) => {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name || name === p.name) return;
    try {
      await api.updateProject(p.id, { name });
      await refreshProjects();
    } catch { /* ignore */ }
  };

  const doDelete = async (p: Project) => {
    setConfirmDel(null);
    setMenuFor(null);
    try {
      await api.deleteProject(p.id);
      if (activeProject?.id === p.id) setActiveProject(null);
      await refreshProjects();
    } catch { /* ignore */ }
  };

  const onAutoProject = (p: Project) => { setActiveProject(p); refreshProjects(); };

  const navItems = useMemo(() => ([
    { key: "chat" as const, label: t("chat"), icon: "✦" },
    { key: "agents" as const, label: t("agents"), icon: "◇" },
    { key: "models" as const, label: t("models"), icon: "⌘" },
    { key: "dashboard" as const, label: t("dashboard"), icon: "▥" },
    { key: "files" as const, label: t("files"), icon: "▤" },
  ]), [t]);

  const win = (window as unknown as { aibo?: { winMin?: () => void; winMax?: () => void; winClose?: () => void } }).aibo;
  return (
    <ToastProvider>
      <div className="app-shell" data-auth={imgAuthV}>
        <div className="window-drag-region" aria-hidden="true" />
        <div className="win-controls" role="group" aria-label="窗口控制">
          <button type="button" className="win-btn" title="最小化" aria-label="最小化" onClick={() => win?.winMin?.()}>−</button>
          <button type="button" className="win-btn" title="最大化或还原" aria-label="最大化或还原" onClick={() => win?.winMax?.()}>□</button>
          <button type="button" className="win-btn win-close" title="关闭" aria-label="关闭" onClick={() => win?.winClose?.()}>×</button>
        </div>
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true"><img src="./icon-circle.png" alt="" /></span>
            <span className="brand-copy"><span className="brand-name">{t("brand")}</span><span className="brand-caption">{t("caption")}</span></span>
            <label className="language-switcher" title={t("language")}>
              <span className="sr-only">{t("language")}</span>
              <select value={language} onChange={e => setLanguage(e.target.value as "zh-CN" | "en-US")} aria-label={t("language")}>
                <option value="zh-CN">中</option>
                <option value="en-US">EN</option>
              </select>
            </label>
          </div>

          <div className="nav-section-label">{t("workspace")}</div>
          <nav className="nav">
            {navItems.map(n => (
              <button key={n.key} className={`nav-item ${view === n.key ? "on" : ""}`} onClick={() => go(n.key)}>
                <span className="nav-icon">{n.icon}</span>
                <span className="nav-label">{n.label}</span>
              </button>
            ))}
          </nav>

          <section className="project-section">
            <div className="project-toolbar">
              <span>{t("projects")}</span>
              <div className="project-toolbar-actions">
                <button className={`project-tool-btn ${projectAddOpen ? "on" : ""}`} title="新建" aria-label="新建" onMouseDown={e => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (projectAddOpen) setProjectAddOpen(false);
                  else {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setAddPosition({ top: rect.bottom + 8, left: Math.max(8, Math.min(window.innerWidth - 204, rect.right - 196)) });
                    setProjectSettingsOpen(false);
                    setProjectSubmenu(null);
                    setProjectAddOpen(true);
                  }
                }}>＋</button>
                <button className={`project-tool-btn ${projectSettingsOpen ? "on" : ""}`} title="项目选项" aria-label="项目选项" onMouseDown={e => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (projectSettingsOpen) setProjectSettingsOpen(false);
                  else {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setSettingsPosition({ top: rect.bottom + 8, left: Math.max(8, Math.min(window.innerWidth - 260, rect.right - 252)) });
                    setProjectSettingsOpen(true);
                  }
                }}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14"/><circle cx="7" cy="5" r="1.7"/><circle cx="13" cy="10" r="1.7"/><circle cx="8" cy="15" r="1.7"/></svg>
                </button>
              </div>
            </div>
            {!projectsCollapsed && <div className="side-group project-list">
              {visibleProjects.map(p => {
                const isActive = activeProject?.id === p.id;
                if (renamingId === p.id) {
                  return (
                    <div key={p.id} className="proj-item renaming">
                      <span className="ico">{p.name.slice(0, 1)}</span>
                      <input
                        className="proj-rename-input"
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") commitRename(p);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        onBlur={() => commitRename(p)}
                        autoFocus
                      />
                    </div>
                  );
                }
                return (
                  <div
                    key={p.id}
                    className={`proj-item ${isActive ? "active" : ""} ${menuFor === p.id ? "menu-open" : ""}`}
                  >
                    <span className="ico">{p.name.slice(0, 1)}</span>
                    <span className="proj-name" onClick={() => selectProject(p)}>{p.name}</span>
                    <button
                      className="proj-trigger"
                      title="操作"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (menuFor === p.id) {
                          setMenuFor(null);
                        } else {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setMenuPosition({ top: rect.bottom + 4, left: Math.max(8, Math.min(window.innerWidth - 148, rect.right - 140)) });
                          setMenuFor(p.id);
                        }
                        setConfirmDel(null);
                      }}
                    >⋯</button>
                  </div>
                );
              })}
            </div>}
            {!projectsCollapsed && projects.length > 0 && visibleProjects.length === 0 && <div className="project-empty">{t("noActive")}</div>}
            {!projectsCollapsed && projects.length === 0 && <button className="project-empty project-empty-action" onClick={openCreateProject}>{t("firstProject")}</button>}
          </section>

          <div className="side-foot">
            <span aria-hidden="true">▤</span>
            <span><b>{t("localWork")}</b><small>{t("localWorkSub")}</small></span>
          </div>
        </aside>

        <main className="main">
          {view === "dashboard" && <Dashboard />}
          <div style={{ display: view === "chat" ? "contents" : "none" }}>
            <CommandCenter
              active={view === "chat"}
              project={activeProject}
              loadKey={loadKey}
              onAutoProject={onAutoProject}
            />
          </div>
          {view === "models" && <ModelsApi />}
          {view === "agents" && <AgentLibrary />}
          {view === "files" && (
            <FilesView projects={projects} active={activeProject} onOpen={(p: Project) => setShowFiles(p)} />
          )}
        </main>

        {showFiles && (
          <div className="modal-mask" onClick={() => setShowFiles(null)}>
            <div className="modal wide" onClick={(e) => e.stopPropagation()}>
              <ProjectFiles project={showFiles} onClose={() => setShowFiles(null)} />
            </div>
          </div>
        )}
        {editingProject && (
          <div className="modal-mask" onClick={() => !editSaving && setEditingProject(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <h3>{t("editProject")}</h3>
              <div className="field">
                <label>{t("projectName")}</label>
                <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus />
              </div>
              <div className="field">
                <label>{t("projectDescription")}</label>
                <textarea value={editDescription} onChange={e => setEditDescription(e.target.value)} rows={3} />
              </div>
              <div className="field">
                <label>{t("projectFolder")}</label>
                <input value={editFolder} onChange={e => setEditFolder(e.target.value)} placeholder={t("noFolder")} />
              </div>
              <div className="modal-actions">
                <button className="btn" onClick={() => setEditingProject(null)} disabled={editSaving}>{t("cancel")}</button>
                <button className="btn primary" onClick={saveEdit} disabled={editSaving || !editName.trim()}>{editSaving ? t("saving") : t("save")}</button>
              </div>
            </div>
          </div>
        )}
        {creatingProject && (
          <div className="modal-mask" onClick={() => !createSaving && setCreatingProject(false)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <h3>{t("createProject")}</h3>
              <div className="field"><label>{t("projectName")}</label><input value={newProjectName} onChange={e => { setNewProjectName(e.target.value); setCreateError(""); }} autoFocus /></div>
              <div className="field"><label>{t("projectDescription")}</label><textarea value={newProjectDescription} onChange={e => setNewProjectDescription(e.target.value)} rows={3} /></div>
              <div className="field"><label>{t("projectFolder")}</label><input value={newProjectFolder} onChange={e => setNewProjectFolder(e.target.value)} placeholder={t("noFolder")} /></div>
              {createError && <div className="project-create-error">{createError}</div>}
              <div className="modal-actions">
                <button className="btn" onClick={() => setCreatingProject(false)} disabled={createSaving}>{t("cancel")}</button>
                <button className="btn primary" onClick={createProject} disabled={createSaving || !newProjectName.trim()}>{createSaving ? t("creating") : t("createProject")}</button>
              </div>
            </div>
          </div>
        )}
        {showHistoryManager && (
          <div className="modal-mask" onClick={() => setShowHistoryManager(false)}>
            <div className="modal project-history-modal" onClick={e => e.stopPropagation()}>
              <h3>历史项目管理</h3>
              <p className="muted">所有项目和对应的对话记录</p>
              {projects.length === 0 ? <div className="project-history-empty">还没有历史项目</div> : <div className="project-history-list">
                {[...projects].sort((a, b) => new Date(b.updated_at || b.created_at || "").getTime() - new Date(a.updated_at || a.created_at || "").getTime()).map(p => (
                  <div className="project-history-row" key={p.id}>
                    <div className="project-history-copy"><b>{p.name}</b><small>{p.description || "项目对话"}</small></div>
                    <button className="btn sm" onClick={() => { selectProject(p); setShowHistoryManager(false); if (view !== "chat") go("chat"); }}>打开</button>
                    <button className="btn sm" onClick={() => { setShowHistoryManager(false); startEdit(p); }}>编辑</button>
                  </div>
                ))}
              </div>}
              <div className="modal-actions"><button className="btn" onClick={() => setShowHistoryManager(false)}>完成</button></div>
            </div>
          </div>
        )}
        {projectSettingsOpen && settingsPosition && createPortal(
          <div className="project-settings-menu" style={{ top: settingsPosition.top, left: settingsPosition.left }} onMouseDown={e => e.stopPropagation()}>
            <button className="project-settings-row" onClick={() => setProjectSubmenu(projectSubmenu === "group" ? null : "group")}><span><i>▤</i>分组</span><span className="project-settings-value">{projectSort === "updated" ? "最近更新" : "名称"}<b>›</b></span></button>
            {projectSubmenu === "group" && <div className="project-settings-options">
              <button className={projectSort === "updated" ? "selected" : ""} onClick={() => setProjectSort("updated")}>按最近更新</button>
              <button className={projectSort === "name" ? "selected" : ""} onClick={() => setProjectSort("name")}>按名称</button>
            </div>}
            <button className="project-settings-row" onClick={() => setProjectSubmenu(projectSubmenu === "filter" ? null : "filter")}><span><i>▽</i>对话筛选</span><span className="project-settings-value">{projectFilter === "active" ? "活跃" : "全部"}<b>›</b></span></button>
            {projectSubmenu === "filter" && <div className="project-settings-options">
              <button className={projectFilter === "all" ? "selected" : ""} onClick={() => setProjectFilter("all")}>全部项目</button>
              <button className={projectFilter === "active" ? "selected" : ""} onClick={() => setProjectFilter("active")}>活跃项目 · 14 天内</button>
            </div>}
            <div className="project-settings-divider" />
            <button className="project-settings-row simple" onClick={() => setProjectsCollapsed(v => !v)}><span><i>▱</i>{projectsCollapsed ? "展开全部项目" : "收起全部项目"}</span></button>
            <button className="project-settings-row simple" onClick={openCreateProject}><span><i>＋</i>创建新项目</span></button>
            <div className="project-settings-divider" />
            <button className="project-settings-row simple" onClick={() => { setProjectSettingsOpen(false); setProjectSubmenu(null); setShowHistoryManager(true); }}><span><i>⚙</i>历史对话管理</span></button>
          </div>, document.body,
        )}
        {projectAddOpen && addPosition && createPortal(
          <div className="project-add-menu" style={{ top: addPosition.top, left: addPosition.left }} onMouseDown={e => e.stopPropagation()}>
            <button onClick={startNewConversation}><i>＋</i><span><b>新对话</b><small>开始一段空白对话</small></span></button>
            <button onClick={openCreateProject}><i>▧</i><span><b>新建项目</b><small>创建并打开一个项目</small></span></button>
          </div>, document.body,
        )}
        {menuFor && menuPosition && (() => {
          const p = projects.find(item => item.id === menuFor);
          if (!p) return null;
          return createPortal(
            <div className="proj-menu" style={{ top: menuPosition.top, left: menuPosition.left }} onMouseDown={e => e.stopPropagation()}>
              {confirmDel === p.id ? (
                <>
                  <div className="proj-menu-title">确认删除「{p.name}」？</div>
                  <button className="proj-menu-item danger" onClick={() => doDelete(p)}>确认删除</button>
                  <button className="proj-menu-item" onClick={() => setConfirmDel(null)}>取消</button>
                </>
              ) : (
                <>
                  <button className="proj-menu-item" onClick={() => startEdit(p)}>编辑项目</button>
                  <button className="proj-menu-item" onClick={() => startRename(p)}>重命名</button>
                  <button className="proj-menu-item danger" onClick={() => setConfirmDel(p.id)}>删除</button>
                </>
              )}
            </div>,
            document.body,
          );
        })()}
      </div>
    </ToastProvider>
  );
}

function FilesView({ projects, active, onOpen }: {
  projects: Project[]; active: Project | null; onOpen: (p: Project) => void;
}) {
  if (!active) {
    return <div className="empty">请在左侧选择项目以查看产出文件。</div>;
  }
  return (
    <div className="card">
      <h3>{active.name} · 产出文件</h3>
      <p className="muted">文件夹：{active.folder_path || "（未设置）"}</p>
      <button className="btn primary" onClick={() => onOpen(active)}>打开文件列表</button>
    </div>
  );
}
