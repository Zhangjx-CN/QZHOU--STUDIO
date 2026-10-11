import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, resolveImg, streamChat } from "../api/client";
import { useToast } from "../api/ui";

interface Msg {
  id?: string;
  role: "system" | "user" | "ai";
  text: string;
  thinking?: string;
  input?: string;
  complete?: boolean;
  failed?: boolean;
  meta?: { target_name?: string; target_type?: "model" | "n8n" | "agent"; note?: string; files?: { name: string; path: string }[] };
}

export default function CommandCenter({ project, loadKey = 0, active = true, onAutoProject }: {
  project: { id: string; name: string; folder_path?: string | null } | null;
  loadKey?: number;
  active?: boolean;
  onAutoProject?: (p: any) => void;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [artifactView, setArtifactView] = useState<Msg | null>(null);
  const [thinkingOpen, setThinkingOpen] = useState<Record<number, boolean>>({});
  const [saveDir, setSaveDir] = useState<string>(() => localStorage.getItem("aibo_save_dir") ?? "");
  const [assistantVersion, setAssistantVersion] = useState(0);
  const [assistantUploading, setAssistantUploading] = useState(false);
  const [assistantImgOk, setAssistantImgOk] = useState(true);
  const [image, setImage] = useState<string | null>(null);
  const assistantFileRef = useRef<HTMLInputElement>(null);
  const imageFileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);
  const followEndRef = useRef(true);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [connectionError, setConnectionError] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [taskPhase, setTaskPhase] = useState("等待服务回应");

  // 目标下拉：「model:xxx」/「n8n:xxx」/「agent:xxx」
  const [target, setTarget] = useState<string>("");
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  const [n8ns, setN8ns] = useState<{ id: string; name: string }[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const toast = useToast();

  const load = async () => {
    setLoadingConnections(true);
    setConnectionError("");
    try {
      const [ps, ns, ag] = await Promise.all([api.listProviders(), api.listN8n(), api.listAgents()]);
      setModels(ps.filter((p: any) => p.enabled).flatMap((p: any) =>
        p.models.filter((m: any) => m.enabled).map((m: any) => ({ id: m.id, label: `${p.name} / ${m.display_name}` }))));
      setN8ns(ns.filter((n: any) => n.status === "enabled").map((n: any) => ({ id: n.id, name: n.name })));
      setAgents((ag || []).map((a: any) => ({ id: a.id, name: a.name })));
      const choices = [
        ...ps.filter((p: any) => p.enabled).flatMap((p: any) => p.models.filter((m: any) => m.enabled).map((m: any) => `model:${m.id}`)),
        ...ns.filter((n: any) => n.status === "enabled").map((n: any) => `n8n:${n.id}`),
        ...(ag || []).map((a: any) => `agent:${a.id}`),
      ];
      setTarget(current => choices.includes(current) ? current : "");
    } catch (e) {
      setConnectionError((e as Error).message);
    } finally { setLoadingConnections(false); }
  };
  useEffect(() => { if (active) load(); }, [active]);
  const hasConnections = models.length + agents.length + n8ns.length > 0;
  useEffect(() => {
    if (!busy || startedAt === null) return;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy, startedAt]);
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  useEffect(() => {
    if (project?.folder_path) setSaveDir(project.folder_path);
  }, [project?.id, project?.folder_path]);

  useEffect(() => {
    setInput("");
    setImage(null);
    setArtifactView(null);
    const pid = project?.id;
    let alive = true;
    if (!pid) {
      setMsgs([]);
      return;
    }
    setMsgs([{ role: "system", text: "正在加载对话…" }]);
    (async () => {
      try {
        const h = await api.projectHistory(pid);
        if (!alive) return;
        const rows = (h.messages ?? []).filter((m: any) => m.role === "user" || m.role === "assistant");
        if (rows.length === 0) {
          setMsgs([{ role: "system", text: `已打开项目「${project?.name}」—— 直接输入内容开始。` }]);
          return;
        }
        setMsgs(rows.map((m: any) => ({
          role: m.role === "assistant" ? "ai" : "user",
          text: m.content, meta: m.meta, complete: m.role === "assistant" && m.meta?.status !== "failed",
          failed: m.meta?.status === "failed",
        })));
      } catch (e) {
        if (alive) setMsgs([{ role: "system", text: "读取对话失败：" + (e as Error).message }]);
      }
    })();
    return () => { alive = false; };
  }, [loadKey]);

  useEffect(() => {
    localStorage.setItem("aibo_save_dir", saveDir);
  }, [saveDir]);

  useEffect(() => {
    if (followEndRef.current) listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "auto" });
  }, [msgs, busy, active]);
  useEffect(() => {
    if (!artifactView) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setArtifactView(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [artifactView]);

  const onPickAssistant = () => assistantFileRef.current?.click();
  const onAssistantFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setAssistantUploading(true);
    try {
      await api.setAssistantAvatar(f);
      setAssistantVersion(v => v + 1);
      setAssistantImgOk(true);
    } catch (err) { toast((err as Error).message, "err"); }
    finally { setAssistantUploading(false); }
  };

  const onPickImage = () => imageFileRef.current?.click();
  const onImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const r = await api.uploadFile(f);
      setImage(r.url);
      toast("图片已附加");
    } catch (err) { toast((err as Error).message, "err"); }
  };

  const send = async (text?: string) => {
    const raw = (text ?? input).trim();
    if (!raw || sendingRef.current || !target) return;
    sendingRef.current = true;
    followEndRef.current = true;
    setElapsed(0);
    setStartedAt(Date.now());
    setTaskPhase("等待服务回应");
    setBusy(true);
    const messageId = crypto.randomUUID();
    let pid: string | null = project?.id ?? null;
    if (!project) {
      try {
        const now = new Date();
        const ts = `${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
        const name = (raw.replace(/\s+/g, "").slice(0, 14) || "AI 对话") + " · " + ts;
        const p = await api.createProject({ name, description: "对话自动生成的项目", folder_path: "" });
        onAutoProject?.(p);
        setSaveDir(p.folder_path || "");
        pid = p.id;
        toast(`已自动创建项目：${p.name}`);
      } catch (e) {
        toast("自动创建项目失败：" + (e as Error).message, "err");
        sendingRef.current = false;
        setBusy(false);
        return;
      }
    }
    setInput("");
    setImage(null);
    setMsgs(m => [...m, { role: "user", text: raw }, { id: messageId, role: "ai", text: "", input: raw }]);
    setBusy(true);
    try {
      const modelId = target.startsWith("model:") ? target.slice("model:".length) : null;
      const n8nId   = target.startsWith("n8n:")   ? target.slice("n8n:".length)   : null;
      const agentId = target.startsWith("agent:") ? target.slice("agent:".length) : null;
      const savedFiles: { name: string; path: string }[] = [];
      await streamChat(raw,
        { projectId: pid, modelId, n8nId, agentId, image },
        (evt: any) => {
          if (evt.type === "delta") setTaskPhase("正在接收回复");
          if (evt.type === "thinking") setTaskPhase("服务正在思考");
          if (evt.type === "file") setTaskPhase("已收到文件，继续接收结果");
          setMsgs(m => {
            const index = m.findIndex(x => x.id === messageId);
            const last = m[index];
            if (!last || last.role !== "ai") return m;
            const next: Msg = { ...last };
            if (evt.type === "meta") {
              next.meta = { ...(next.meta || {}),
                target_name: evt.target?.name, target_type: evt.target?.type };
            } else if (evt.type === "delta") {
              next.text = (next.text || "") + (evt.text || "");
            } else if (evt.type === "thinking") {
              next.thinking = (next.thinking || "") + (evt.text || "");
            } else if (evt.type === "done") {
              if (Array.isArray(evt.files)) for (const f of evt.files) {
                if (f?.name && f?.path && !savedFiles.some(x => x.path === f.path)) savedFiles.push({ name: f.name, path: f.path });
              }
              next.complete = !next.failed && evt.ok !== false;
              next.meta = { ...(next.meta || {}),
                files: savedFiles.length ? savedFiles : next.meta?.files,
                note: savedFiles.length ? `完成 · 已存文件：${savedFiles.map(f => f.name).join("、")}` : "完成" };
            } else if (evt.type === "file") {
              if (evt.name && evt.path && !savedFiles.some(f => f.path === evt.path)) savedFiles.push({ name: evt.name, path: evt.path });
              next.meta = { ...(next.meta || {}), note: `已保存文件：${evt.name}`,
                files: [...(next.meta?.files || []).filter(f => f.path !== evt.path), { name: evt.name, path: evt.path }] };
            } else if (evt.type === "progress") {
              next.meta = { ...(next.meta || {}), note: `智能体运行中… 已等待 ${evt.waited}s` };
            } else if (evt.type === "unmatched") {
              next.failed = true;
              next.complete = false;
              next.meta = { ...(next.meta || {}), note: evt.reason };
            }
            return m.map((item, i) => i === index ? next : item);
          });
        });
    } catch (e) {
      setMsgs(m => {
        return m.map(item => item.id === messageId ? { ...item, failed: true, complete: false,
          meta: { ...item.meta, note: "接收失败：" + (e as Error).message } } : item);
      });
    } finally { sendingRef.current = false; setBusy(false); }
  };

  const saveMaterial = async (m: Msg) => {
    try {
      const r = await api.saveFile({
        content: m.text,
        save_dir: saveDir,
        filename_hint: (m.meta?.target_name || "材料").slice(0, 40),
        meta: { source: "对话", target_name: m.meta?.target_name, message: m.input ?? "" },
      });
      toast("已保存 → " + r.path);
    } catch (e) { toast((e as Error).message, "err"); }
  };

  const saveAs = async (m: Msg) => {
    const aibo = (window as unknown as { aibo?: { saveTextAs?: (o: Record<string, unknown>) => Promise<{ canceled: boolean; path?: string }> } }).aibo;
    if (!aibo?.saveTextAs) { toast("请重启轻舟以启用系统另存为", "err"); return; }
    try {
      const r = await aibo.saveTextAs({ filename: (m.meta?.target_name || "材料") + ".md", content: m.text });
      if (!r.canceled) toast("已另存为 → " + r.path);
    } catch (e) { toast((e as Error).message, "err"); }
  };

  const openArtifact = async (path: string) => {
    const openPath = (window as unknown as { aibo?: { openPath?: (p: string) => Promise<{ ok: boolean; error?: string }> } }).aibo?.openPath;
    if (!openPath) { toast("当前环境不支持打开本地文件", "err"); return; }
    try {
      const result = await openPath(path);
      if (!result.ok) toast(result.error || "文件打开失败", "err");
    } catch (e) { toast((e as Error).message, "err"); }
  };

  return (
    <div className="cmd-page">
      <div className="chat-body" ref={listRef} onScroll={() => {
        const el = listRef.current;
        if (el) followEndRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
      }}>
        {msgs.length === 0 && !busy && (
          <div className="assistant-welcome">


            <div className="assistant-title">今天，想先处理什么？</div>
            <div className="assistant-subtitle">把想做的事说清楚，回复和文件都留在这里。</div>
            {!loadingConnections && !hasConnections && !connectionError && (
              <a className="welcome-connect" href="#/models">连接你的第一个 AI <span aria-hidden="true">→</span></a>
            )}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`msg-row ${m.role === "user" ? "user" : m.role === "ai" ? "ai" : "system"}`}>
            {m.role === "system" ? (
              <div className="msg-center"><div className="msg-center-inner">{m.text}</div></div>
            ) : (
              <div className={`bubble ${m.role === "user" ? "user" : "ai"}`}>
                {m.role === "ai" && m.meta?.target_name && (
                  <div className="bubble-head">
                    <span className="badge prov">{m.meta.target_name}</span>
                  </div>
                )}
                {m.role === "ai" && m.thinking ? (
                  <div className="thinking-block">
                    <button className="thinking-toggle" onClick={() => setThinkingOpen(o => ({ ...o, [i]: !o[i] }))}>
                      <span className="thinking-dot" />
                      {thinkingOpen[i] ? "收起思考过程" : "查看思考过程"}
                    </button>
                    {thinkingOpen[i] && (
                      <div className="thinking-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.thinking}</ReactMarkdown></div>
                    )}
                  </div>
                ) : null}
                <div className="bubble-text">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                </div>
                {m.role === "ai" && m.failed && <div className="task-error" role="alert"><b>这次任务未能完整接收</b><span>{m.meta?.note || "任务未完成"}</span></div>}
                {m.role === "ai" && !!m.meta?.files?.length && (
                  <div className="result-files">
                    {m.meta.files.map(f => <button key={f.path} className="result-file" onClick={() => openArtifact(f.path)} title={`打开 ${f.name}`}>
                      <span className="result-file-type">{f.name.split(".").pop()?.slice(0, 5).toUpperCase() || "文件"}</span>
                      <span className="result-file-copy"><b>{f.name}</b><small>已保存到本机 · 点击打开</small></span>
                      <span className="result-file-open" aria-hidden="true">↗</span>
                    </button>)}
                  </div>
                )}
                {m.role === "ai" && (m.complete || m.failed) && (m.text || m.meta?.files?.length) && (
                  <div className="bubble-actions">
                    <button className="btn sm primary" onClick={() => setArtifactView(m)}>{m.failed ? "查看已收内容" : "查看产物"}{m.meta?.files?.length ? ` (${m.meta.files.length})` : ""}</button>
                    {!!m.text.trim() && <button className="btn sm ghost" onClick={() => saveMaterial(m)}>保存到项目</button>}
                    {!!m.text.trim() && <button className="btn sm ghost" onClick={() => saveAs(m)}>另存为…</button>}
                    {m.complete && <span className="result-complete">已完成</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="msg-row ai">
            <div className="task-progress" role="status">
              <span className="task-progress-dot" aria-hidden="true" />
              <div><b>{taskPhase}</b><small>{elapsed >= 30 ? "长任务可能需要几分钟，可先查看其他页面。" : "可以继续编辑下一条消息。"}</small></div>
              <time>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</time>
            </div>
          </div>
        )}
      </div>

      <div className="chat-footer">
        {connectionError && <div className="connection-notice" role="alert"><span>暂时无法读取 AI 连接：{connectionError}</span><button className="btn sm ghost" onClick={load}>重试</button></div>}
        {!loadingConnections && !connectionError && !hasConnections && <div className="connection-notice"><span>先连接一个 AI 服务，就可以开始。</span><a href="#/models">去连接 →</a></div>}
        {image && (
          <div className="img-chip">
            <img src={resolveImg(image)} alt="" />
            <button className="btn sm ghost img-remove" onClick={() => setImage(null)} title="移除图片">×</button>
          </div>
        )}
        <input ref={imageFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onImageFile} />
        <div className="cmd-composer">
          <div className="cmd-input-wrap">
          <textarea
            ref={composerRef}
            aria-label="描述任务或发送消息"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
            placeholder={busy ? "继续写下一条，当前任务结束后再发送…" : "描述你想完成的事…"}
            rows={1}
          />
            <div className="cmd-compose-toolbar">
              <button className="btn img-toggle" onClick={onPickImage} title="添加图片（所选 AI 需支持图片）" aria-label="添加图片">＋</button>
              <select className="module-picker" value={target} onChange={e => setTarget(e.target.value)} disabled={busy || loadingConnections} aria-label="选择本次使用的 AI" title="选择本次使用的 AI">
                <option value="">{loadingConnections ? "读取连接中…" : "选择 AI"}</option>
                {agents.length > 0 && <optgroup label="已连接的助手">{agents.map(a => <option key={a.id} value={`agent:${a.id}`}>{a.name}</option>)}</optgroup>}
                {models.length > 0 && <optgroup label="通用模型">{models.map(m => <option key={m.id} value={`model:${m.id}`}>◉ {m.label}</option>)}</optgroup>}
                {n8ns.length > 0 && <optgroup label="工作流">{n8ns.map(n => <option key={n.id} value={`n8n:${n.id}`}>⚡ {n.name}</option>)}</optgroup>}
              </select>
              <span className="cmd-target-status">{busy ? "任务进行中" : target ? "Enter 发送 · Shift+Enter 换行" : "发送前选择一个 AI"}</span>
              <button className="btn primary send" onClick={() => send()} disabled={busy || loadingConnections || !target || !input.trim()} aria-label="发送" title={busy ? "当前任务结束后可继续发送" : !target ? "请先选择 AI" : "发送"}>↑</button>
            </div>
          </div>
        </div>
      </div>
      {artifactView && (
        <div className="modal-mask" onClick={() => setArtifactView(null)}>
          <section className="modal modal-lg artifact-modal" role="dialog" aria-modal="true" aria-label="查看产物" onClick={e => e.stopPropagation()}>
            <div className="artifact-heading">
              <div><h3>{artifactView.failed ? "已接收的部分产物" : "本次任务产物"}</h3><span>{artifactView.meta?.target_name || "AI 对话"}</span></div>
              <button className="btn sm ghost" onClick={() => setArtifactView(null)} aria-label="关闭">✕</button>
            </div>
            {artifactView.meta?.files?.length ? (
              <div className="artifact-files">
                {artifactView.meta.files.map(f => (
                  <div className="artifact-file" key={f.path}>
                    <span className="artifact-file-icon">▤</span>
                    <div className="artifact-file-name">{f.name}</div>
                    <button className="btn sm" onClick={() => openArtifact(f.path)}>打开文件</button>
                  </div>
                ))}
              </div>
            ) : null}
            {artifactView.text.trim() ? (
              <div className="artifact-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{artifactView.text}</ReactMarkdown></div>
            ) : !artifactView.meta?.files?.length ? <div className="artifact-empty">本次任务没有返回可查看的内容。</div> : null}
            <div className="m-actions">
              {!!artifactView.text.trim() && <button className="btn sm" onClick={() => saveMaterial(artifactView)}>保存正文到项目</button>}
              {!!artifactView.text.trim() && <button className="btn sm" onClick={() => saveAs(artifactView)}>正文另存为…</button>}
              <button className="btn sm primary" onClick={() => setArtifactView(null)}>关闭</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
