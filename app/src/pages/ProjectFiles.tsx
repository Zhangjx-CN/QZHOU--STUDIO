import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Project } from "../api/types";
import { Empty, Modal, useToast } from "../api/ui";

/* 项目产出文件：扫描项目文件夹，右键可另存为 / 打开（模型生成文件的统一入口） */

export interface ProjectFile {
  name: string;
  path: string;
  size: number;
  modified: string;
}

export default function ProjectFiles({ project, onClose }: { project: Project; onClose: () => void }) {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<{ x: number; y: number; file: ProjectFile } | null>(null);
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.projectFiles(project.id);
      setFiles(r.files ?? []);
    } catch (e) {
      toast("读取项目文件失败：" + (e as Error).message, "err");
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const fmt = (n: number) =>
    n < 1024 ? n + " B" : n < 1024 * 1024 ? (n / 1024).toFixed(1) + " KB" : (n / 1024 / 1024).toFixed(2) + " MB";

  const aibo = (window as unknown as { aibo?: { openPath?: (p: string) => Promise<{ ok: boolean; error?: string }>; saveDialog?: (o: Record<string, unknown>) => Promise<{ canceled: boolean; filePath?: string }>; saveFileCopy?: (src: string, dest: string) => Promise<{ ok: boolean; error?: string }> } }).aibo;

  const openFile = async (f: ProjectFile) => {
    setCtx(null);
    try {
      const r = await aibo?.openPath?.(f.path);
      if (r && !r.ok) toast("打开失败：" + (r.error ?? ""), "err");
    } catch (e) {
      toast("打开失败：" + (e as Error).message, "err");
    }
  };

  const saveAsFile = async (f: ProjectFile) => {
    setCtx(null);
    if (!aibo?.saveDialog || !aibo?.saveFileCopy) {
      toast("当前环境不支持系统另存为", "err");
      return;
    }
    try {
      const r = await aibo.saveDialog({ title: "另存为", defaultPath: f.name });
      if (r.canceled || !r.filePath) return;
      const s = await aibo.saveFileCopy(f.path, r.filePath);
      if (s.ok) toast("已另存为 → " + r.filePath);
      else toast("另存为失败：" + (s.error ?? ""), "err");
    } catch (e) {
      toast("另存为失败：" + (e as Error).message, "err");
    }
  };

  return (
    <Modal title={`项目文件 · ${project.name}`} onClose={onClose} width={640}>
      <div className="hint" style={{ marginBottom: 8 }}>
        📁 {project.folder_path || "未绑定文件夹"} — 模型生成的文件会保存到这里；<b>右键文件</b>可另存为/打开
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 380, overflowY: "auto" }}>
        {loading && <Empty text="正在读取项目文件…" />}
        {!loading && files.length === 0 && <Empty text="项目文件夹暂无文件。让 AI 跑一条指令并「保存文件」后，这里就会出现。" />}
        {files.map((f) => (
          <div
            key={f.path}
            className="pf-item"
            onContextMenu={(e) => {
              e.preventDefault();
              setCtx({ x: e.clientX, y: e.clientY, file: f });
            }}
            onDoubleClick={() => openFile(f)}
            title="右键：另存为 / 打开；双击：打开"
          >
            <span className="pf-ico">{/\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name) ? "🖼" : /\.(docx?|md|txt|pdf)$/i.test(f.name) ? "📄" : /\.(xlsx?|csv)$/i.test(f.name) ? "📊" : "📦"}</span>
            <span className="pf-name">{f.name}</span>
            <span className="pf-meta mono">{f.modified} · {fmt(f.size)}</span>
          </div>
        ))}
      </div>

      {ctx && (
        <>
          <div className="ctx-mask" onClick={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null); }} />
          <div className="ctx-menu" style={{ left: ctx.x, top: ctx.y }}>
            <button onClick={() => saveAsFile(ctx.file)}>💾 另存为…</button>
            <button onClick={() => openFile(ctx.file)}>📂 打开</button>
            <button onClick={() => {
              setCtx(null);
              const a = aibo?.openPath?.(project.folder_path ?? "");
              a?.catch(() => undefined);
            }}>🗀 打开所在文件夹</button>
          </div>
        </>
      )}
    </Modal>
  );
}
