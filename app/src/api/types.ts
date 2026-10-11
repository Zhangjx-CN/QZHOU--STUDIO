// 前后端共享契约（2026-09-18 模块库清档）：不再有 Recipe / Pipeline / Tool。

export interface Model {
  id: string;
  model_key: string;
  display_name: string;
  context_window: number | null;
  enabled: number;
}

export interface Provider {
  id: string;
  provider_key: string;
  name: string;
  base_url: string | null;
  api_connection_id: string | null;
  capabilities: Record<string, unknown>;
  enabled: number;
  models: Model[];
}

export interface N8nInstance {
  id: string;
  name: string;
  endpoint: string;
  description: string;
  status: string;
  token_hint: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  folder_path: string | null;
  created_at: string;
  updated_at: string;
  materials?: { file: string; path: string; time: string }[];
  cover?: string;
}

export interface AgentEntry {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  code: string;          // ① 调用示例代码
  stream_code: string;   // ② SSE 流监控代码
  key_hint: string;
  created_at: string;
  updated_at: string;
}

/** 对话流事件（与后端 stream_chat 一致） */
export interface ChatEventMeta {
  type: "meta";
  channel: string;
  target: { type: "model" | "n8n"; name: string; model_key?: string; provider_name?: string };
}
export interface ChatEventDelta { type: "delta"; text: string }
export interface ChatEventDone {
  type: "done";
  ok: boolean;
  text: string;
  target_type: "model" | "n8n";
}
export interface ChatEventUnmatched {
  type: "unmatched";
  reason: string;
  channel?: string;
}
export type ChatEvent = ChatEventMeta | ChatEventDelta | ChatEventDone | ChatEventUnmatched;

export interface Dashboard {
  providers: number;
  models: number;
  n8n_instances: number;
  projects: number;
  sessions: number;
  cost: {
    total: number;
    calls: number;
    today: number;
    per_model: { model_key: string; calls: number; cost: number }[];
  };
  recent_logs: {
    target_type: string;
    target_name: string;
    model_provider: string;
    model_name: string;
    status: string;
    cost_estimate: number;
    duration_ms: number;
    execution_time: string;
  }[];
  timestamp: string;
}
