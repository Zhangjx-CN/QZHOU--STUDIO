// API 客户端（2026-09-18 模块库清档）：删 Recipe / Pipeline / Tool / market / recipes / recent-recipes / tasks。

const BASE = window.location.protocol.startsWith("http")
  ? "/api"
  : "http://127.0.0.1:8000/api";

const STATIC_BASE = window.location.protocol.startsWith("http")
  ? ""
  : "http://127.0.0.1:8000";

export function resolveImg(url: string | null | undefined): string {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) return url;
  if (url.startsWith("/static/")) {
    const isHttp = window.location.protocol.startsWith("http");
    // dev 模式走 vite proxy 不需要 token；Electron file:// 模式需拼后端地址 + ?token= 签名
    const base = isHttp ? "" : STATIC_BASE;
    const tokenQs = !isHttp && _token
      ? `${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(_token)}`
      : "";
    return base + url + tokenQs;
  }
  return url;
}

// App 启动时先调一次，确保 resolveImg 拼图片地址时 token 已缓存
export const ensureToken = resolveToken;

let _token: string | null = null;

async function resolveToken(): Promise<string> {
  if (_token !== null) return _token;
  const aibo = (window as unknown as { aibo?: { getToken?: () => Promise<string> } }).aibo;
  if (aibo?.getToken) {
    try { _token = (await aibo.getToken()) || ""; } catch { _token = ""; }
  } else {
    _token = "";
  }
  return _token;
}

async function doFetch(method: string, path: string, body: unknown, token: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["X-Aibo-Token"] = token;
  return fetch(BASE + path, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await resolveToken();
  let res = await doFetch(method, path, body, token);
  if (res.status === 401 && token) {
    _token = null;
    const token2 = await resolveToken();
    if (token2 && token2 !== token) res = await doFetch(method, path, body, token2);
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { const e = await res.json(); msg = typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail); } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export async function streamChat(
  message: string,
  params: { projectId?: string | null; modelId?: string | null; n8nId?: string | null;
            agentId?: string | null; image?: string | null },
  onEvent: (evt: any) => void,
): Promise<void> {
  const token = await resolveToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["X-Aibo-Token"] = token;
  const res = await fetch(BASE + "/command/stream", {
    method: "POST",
    headers,
    body: JSON.stringify({
      message,
      project_id: params.projectId ?? null,
      model_id: params.modelId ?? null,
      n8n_id: params.n8nId ?? null,
      agent_id: params.agentId ?? null,
      image: params.image ?? null,
    }),
  });
  if (!res.ok || !res.body) {
    let msg = res.statusText;
    try { const e = await res.json(); msg = typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail); } catch { /* ignore */ }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let settled = false;
  const dispatch = (chunk: string) => {
    const payload = chunk.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!payload) return;
    const event = JSON.parse(payload);
    if (event.type === "done" || event.type === "unmatched") settled = true;
    onEvent(event);
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      if (buffer.trim()) dispatch(buffer);
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n");
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      dispatch(chunk);
    }
  }
  if (!settled) throw new Error("连接已结束，但未收到任务完成信号；已接收内容保留，上游任务可能仍在运行");
}

export const api = {
  // 模型 / 连接 / n8n
  listProviders: () => req<any[]>("GET", "/models/providers"),
  createProvider: (data: Record<string, unknown>) => req<any>("POST", "/models/providers", data),
  deleteProvider: (id: string) => req<any>("DELETE", `/models/providers/${id}`),
  addOnlineService: (data: Record<string, unknown>) => req<any>("POST", "/models/online-services", data),
  addLocalModel: (data: Record<string, unknown>) => req<any>("POST", "/models/local", data),
  listConnections: () => req<any[]>("GET", "/api-connections"),
  createConnection: (data: Record<string, unknown>) => req<any>("POST", "/api-connections", data),
  deleteConnection: (id: string) => req<any>("DELETE", `/api-connections/${id}`),
  listN8n: () => req<any[]>("GET", "/n8n-instances"),
  createN8n: (data: Record<string, unknown>) => req<any>("POST", "/n8n-instances", data),
  deleteN8n: (id: string) => req<any>("DELETE", `/n8n-instances/${id}`),

  // agent库（外部 agent 连接与真实调用）
  listAgents: () => req<any[]>("GET", "/agents"),
  createAgent: (data: Record<string, unknown>) => req<any>("POST", "/agents", data),
  updateAgent: (id: string, data: Record<string, unknown>) => req<any>("PUT", `/agents/${id}`, data),
  deleteAgent: (id: string) => req<any>("DELETE", `/agents/${id}`),
  revealAgentKey: (id: string) => req<{ api_key: string }>("GET", `/agents/${id}/key`),

  probeAgent: (id: string) => req<any>("GET", `/agents/${id}/probe`),
  createAgentFromCsv: (data: Record<string, unknown>) => req<any>("POST", "/agents/from-csv", data),

  // 材料 / 项目
  saveFile: (data: Record<string, unknown>) => req<any>("POST", "/files/save", data),
  saveAsFile: (data: Record<string, unknown>) => req<any>("POST", "/files/save-as", data),
  listProjects: () => req<any[]>("GET", "/projects"),
  createProject: (data: Record<string, unknown>) => req<any>("POST", "/projects", data),
  deleteProject: (id: string) => req<any>("DELETE", `/projects/${id}`),
  updateProject: (id: string, data: Record<string, unknown>) => req<any>("PUT", `/projects/${id}`, data),
  projectHistory: (id: string) => req<any>("GET", `/projects/${id}/history`),
  projectFiles: (id: string) => req<any>("GET", `/projects/${id}/files`),

  // Dashboard / 配置
  dashboard: () => req<any>("GET", "/dashboard"),
  health: () => req<any>("GET", "/health"),
  appConfig: () => req<any>("GET", "/app-config"),

  // 文件上传
  uploadFile: async (file: File): Promise<{ url: string; filename: string; size: number }> => {
    const token = await resolveToken();
    const fd = new FormData();
    fd.append("file", file);
    const headers: Record<string, string> = {};
    if (token) headers["X-Aibo-Token"] = token;
    const res = await fetch(BASE + "/upload", { method: "POST", headers, body: fd });
    if (!res.ok) {
      let msg = res.statusText;
      try { const e = await res.json(); msg = typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail); } catch { /* ignore */ }
      throw new Error(msg);
    }
    return res.json();
  },

  setAssistantAvatar: async (file: File): Promise<{ url: string; size: number }> => {
    const token = await resolveToken();
    const fd = new FormData();
    fd.append("file", file);
    const headers: Record<string, string> = {};
    if (token) headers["X-Aibo-Token"] = token;
    const res = await fetch(BASE + "/assistant/avatar", { method: "POST", headers, body: fd });
    if (!res.ok) {
      let msg = res.statusText;
      try { const e = await res.json(); msg = typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail); } catch { /* ignore */ }
      throw new Error(msg);
    }
    return res.json();
  },
};
