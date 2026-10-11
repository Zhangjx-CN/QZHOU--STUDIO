import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";
import type { AgentEntry } from "../api/types";
import { Modal, useToast } from "../api/ui";

// 火山方舟 · Session 事件流（真实文档片段，2026-09-19 由控制台贴入）
// 认证：Authorization: Bearer $ARK_API_KEY（Key 不写进代码，走环境变量）

// ① 调用示例：向会话推送用户消息
const ARK_CALL_EXAMPLE = `# 火山方舟 · Session 事件流 —— 调用示例
# POST /api/v3/sessions/{session_id}/events
curl https://ark.cn-beijing.volces.com/api/v3/sessions/<session_id>/events \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -d '{
    "events": [{
      "type": "user.message",
      "content": [
        { "type": "text", "text": "在此填写任务内容" }
      ]
    }]
  }'`;

// ② SSE 流监控：开长连接实时收事件（后台跑），收完关流
const ARK_STREAM_EXAMPLE = `# 火山方舟 · Session 事件流 —— SSE 流监控
# GET  /api/v3/sessions/{session_id}/events/stream
curl -N https://ark.cn-beijing.volces.com/api/v3/sessions/<session_id>/events/stream \\
  -H "Authorization: Bearer $ARK_API_KEY" \\
  -H "Accept: text/event-stream" &
STREAM_PID=$!

# 收完关掉流
kill $STREAM_PID`;

const DEFAULT_CALL = `// 调用示例代码（curl / python / node 均可）
// 不知道填什么？点下方「填充火山方舟示例」`;
const DEFAULT_STREAM = `// SSE 流监控代码（可选，没有就留空）`;

export default function AgentLibrary() {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showCsv, setShowCsv] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setAgents(await api.listAgents());
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const remove = async (a: AgentEntry) => {
    if (!window.confirm(`删除「${a.name}」？`)) return;
    try {
      await api.deleteAgent(a.id);
      toast("已删除");
      load();
    } catch (e) { toast((e as Error).message, "err"); }
  };

  return (
    <>
      <div className="content">
        <div className="agent-hero">
          <div className="agent-hero-copy">
            <div className="agent-hero-kicker">你的 AI 助手</div>
            <h2>将智能体接入轻舟</h2>
            <p>连接你在外部平台创建的助手，回到工作台即可使用。</p>
          </div>
          <div className="agent-hero-stats">
            <div><b>{agents.length}</b><span>已接入</span></div>
            <div><b>{agents.filter(a => !!a.endpoint && !!a.key_hint).length}</b><span>可调用</span></div>
            <button className="btn primary agent-add-btn" onClick={() => setShowAdd(true)}>＋ 连接助手</button>
            <button className="btn ghost agent-add-btn" onClick={() => setShowCsv(true)}>从 CSV 一键建会话</button>
          </div>
        </div>
        {agents.length === 0 ? (
          <div className="agent-empty">
            <div className="agent-empty-ico">❖</div>
            <div className="agent-empty-title">还没有智能体</div>
            <div className="agent-empty-sub">接入一个外部智能体，就能在「对话」里直接使用它的能力</div>
            <button className="btn primary" onClick={() => setShowAdd(true)}>＋ 连接助手</button>
          </div>
        ) : (
          <div className="agent-grid">
            {agents.map((a) => (
              <AgentCard key={a.id} agent={a} onChanged={load} onDelete={() => remove(a)} />
            ))}
          </div>
        )}

      </div>

      {showAdd && (
        <AgentFormModal
          onClose={() => setShowAdd(false)}
          onDone={async () => { setShowAdd(false); await load(); }}
        />
      )}
      {showCsv && (
        <ArkCsvSessionModal
          onClose={() => setShowCsv(false)}
          onDone={async () => { setShowCsv(false); await load(); }}
        />
      )}
    </>
  );
}

/** 元信息行：定宽 mono 标签 + 值 + 右侧操作 */
function MetaRow({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="agent-meta">
      <span className="agent-meta-k">{k}</span>
      <div className="agent-meta-v">{children}</div>
    </div>
  );
}

/** 单块代码：标题 + 查看/复制（为空则不渲染） */
function CodeBlock({ label, code }: { label: string; code: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  if (!code) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast(`${label} 已复制`);
    } catch { toast("复制失败，请手动选择", "err"); }
  };

  return (
    <div className="agent-codeblock">
      <div className="agent-codelabel">
        <span>{label}</span>
        <span className="agent-codeact">
          <button className="btn sm ghost" onClick={() => setOpen(v => !v)}>{open ? "收起" : "查看"}</button>
          <button className="btn sm ghost" onClick={copy}>复制</button>
        </span>
      </div>
      <div className={`agent-code ${open ? "open" : ""}`}>
        <pre><code>{code}</code></pre>
      </div>
    </div>
  );
}

function AgentCard({ agent, onChanged, onDelete }: { agent: AgentEntry; onChanged: () => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [probe, setProbe] = useState<any>(null);
  const [probing, setProbing] = useState(false);
  const toast = useToast();

  const callable = !!agent.key_hint && !!agent.endpoint;
  const endpointHost = (() => { try { return new URL(agent.endpoint).host; } catch { return agent.endpoint || "未配置 endpoint"; } })();

  // 通道探测：只开事件流、不推消息 → 不触发模型推理，零 token
  const doProbe = async () => {
    setProbing(true);
    try {
      setProbe(await api.probeAgent(agent.id));
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setProbing(false);
    }
  };

  return (
    <div className="agent-card">
      <div className="agent-head">
        <div className="agent-idblock">
          <div className="agent-name">{agent.name}</div>
          {agent.description && <div className="agent-desc">{agent.description}</div>}
        </div>
        <span className={`badge ${callable ? "on" : "off"}`} title={callable ? "endpoint 与 Key 齐备，可被对话调用" : "缺 endpoint 或 Key，无法调用"}>
          <span className="dot" />{callable ? "可调用" : (agent.key_hint ? "缺 ENDPOINT" : "缺 KEY")}
        </span>
      </div>

      <div className="agent-connection">
        <span className="agent-connection-dot" />
        <span className="agent-connection-host">{endpointHost}</span>
        <span className="agent-connection-key">{agent.key_hint ? `Key ${agent.key_hint}` : "未配置 Key"}</span>
      </div>

      <div className="agent-foot">
        <button className="btn ghost agent-probe-btn" onClick={doProbe} disabled={probing || !callable}
                title="只开事件流、不推消息，不触发模型推理，零 token 消耗">
          {probing ? "探测中…" : "探测通道"}
        </button>
        <button className="btn primary" onClick={() => setEditing(true)}>编辑</button>
        <button className="btn danger" onClick={onDelete}>删除</button>
      </div>

      {probe && (
        <div className={`agent-probe ${probe.ok ? "ok" : "bad"}`}>
          <div className="agent-probe-line">
            {probe.ok ? "✓ 通道通" : "✕ 通道不通"} · HTTP {probe.http_status ?? "-"} ·
            事件 {probe.n_events} 个 · {probe.elapsed}s · {probe.cost}
          </div>
          {probe.error && <div className="agent-probe-err">上游原文：{probe.error}</div>}
          {probe.n_events > 0 && (
            <div className="agent-probe-line dim">事件类型：{probe.events.join(", ")}</div>
          )}
          <button className="btn sm ghost" onClick={() => setProbe(null)}>收起</button>
        </div>
      )}

      {editing && (
        <AgentFormModal
          initial={agent}
          onClose={() => setEditing(false)}
          onDone={() => { setEditing(false); onChanged(); }}
        />
      )}
    </div>
  );
}

function ArkCsvSessionModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [baseUrl, setBaseUrl] = useState("https://ark.cn-beijing.volces.com/api/v3");
  const [apiKey, setApiKey] = useState("");
  const [agentId, setAgentId] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [csvPath, setCsvPath] = useState("");
  const [name, setName] = useState("火山方舟 CSV 会话");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!apiKey.trim() || !agentId.trim() || !environmentId.trim() || !csvPath.trim()) {
      toast("API Key、Agent ID、Environment ID 和 CSV 路径均必填", "err"); return;
    }
    setBusy(true);
    try {
      await api.createAgentFromCsv({ base_url: baseUrl.trim(), api_key: apiKey.trim(), agent_id: agentId.trim(),
        environment_id: environmentId.trim(), local_csv_path: csvPath.trim(), name: name.trim() || "火山方舟 CSV 会话" });
      toast("已上传 CSV 并创建 Session，可直接探测通道");
      onDone();
    } catch (e) { toast((e as Error).message, "err"); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="从 CSV 一键建会话" onClose={onClose} width={680} className="modal-lg">
      <p className="muted">这会真实调用方舟 Files API 和 Sessions API，并自动写入一条可调用 agent。Agent 与 Environment 请先在方舟控制台创建。</p>
      <div className="field"><label>方舟 API 基地址</label><input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} /></div>
      <div className="field"><label>API KEY</label><input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="本地明文保存" /></div>
      <div className="field"><label>Agent ID</label><input value={agentId} onChange={e => setAgentId(e.target.value)} placeholder="agt-…" /></div>
      <div className="field"><label>Environment ID</label><input value={environmentId} onChange={e => setEnvironmentId(e.target.value)} placeholder="env-…" /></div>
      <div className="field"><label>本地 CSV 路径</label><input value={csvPath} onChange={e => setCsvPath(e.target.value)} placeholder="D:\\数据\\sample.csv" /></div>
      <div className="field"><label>新 agent 名称</label><input value={name} onChange={e => setName(e.target.value)} /></div>
      <div className="m-actions">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={busy} onClick={submit}>{busy ? "上传并创建中…" : "上传并创建 ▸"}</button>
      </div>
    </Modal>
  );
}

function AgentFormModal({ initial, onClose, onDone }: { initial?: AgentEntry; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [endpoint, setEndpoint] = useState(initial?.endpoint ?? "");
  const [code, setCode] = useState(initial?.code || DEFAULT_CALL);
  const [streamCode, setStreamCode] = useState(initial?.stream_code || "");
  const [apiKey, setApiKey] = useState("");  // 编辑时留空 = 不改 Key
  const [busy, setBusy] = useState(false);

  const fillArk = () => {
    setEndpoint("https://ark.cn-beijing.volces.com/api/v3/sessions/<session_id>/events");
    setCode(ARK_CALL_EXAMPLE);
    setStreamCode(ARK_STREAM_EXAMPLE);
  };

  const submit = async () => {
    if (!name.trim()) { toast("名称必填", "err"); return; }
    const keyArg = apiKey.trim() ? apiKey.trim() : (isEdit ? null : "");
    setBusy(true);
    try {
      if (isEdit && initial) {
        await api.updateAgent(initial.id, {
          name: name.trim(),
          description: description.trim(),
          endpoint: endpoint.trim(),
          code,
          stream_code: streamCode,
          api_key: keyArg,
        });
        toast("已保存修改");
      } else {
        await api.createAgent({
          name: name.trim(),
          description: description.trim(),
          endpoint: endpoint.trim(),
          code,
          stream_code: streamCode,
          api_key: keyArg as string,
        });
        toast("已新建条目");
      }
      onDone();
    } catch (e) { toast((e as Error).message, "err"); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={isEdit ? "编辑 agent 条目" : "新建 agent 条目"} onClose={onClose} width={880} className="modal-lg">

      <div className="agent-form-body">
        <div className="agent-form-col">
          <div className="agent-form-sec">基础</div>
          <div className="field"><label>名称</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：火山方舟 竞品简报 Agent" /></div>
          <div className="field"><label>描述</label><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="这个 agent 做什么" /></div>

          <div className="agent-form-sec">连接</div>
          <div className="field"><label>ENDPOINT</label><input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://…" /></div>
          <div className="field">
            <label>API KEY {isEdit && <span className="muted" style={{ fontWeight: 400 }}>（留空=不改）</span>}</label>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-… / 方舟 AK（本地明文保存）" />
          </div>
        </div>

        <div className="agent-form-col">
          <div className="agent-form-sec">
            示例代码
            <button className="btn sm ghost" style={{ marginLeft: 8 }} onClick={fillArk}>填充火山方舟示例</button>
          </div>
          <div className="field">
            <label>① 调用示例代码</label>
            <textarea value={code} onChange={(e) => setCode(e.target.value)} rows={11} className="mono" style={{ fontSize: 12 }} placeholder="curl / python / node 示例" />
          </div>
          <div className="field">
            <label>② SSE 流监控 <span className="muted" style={{ fontWeight: 400 }}>（可选）</span></label>
            <textarea value={streamCode} onChange={(e) => setStreamCode(e.target.value)} rows={8} className="mono" style={{ fontSize: 12 }} placeholder="开长连接收事件的代码，没有就留空" />
          </div>
        </div>
      </div>

      <div className="m-actions">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={busy} onClick={submit}>{busy ? "保存中…" : "保存 ▸"}</button>
      </div>
    </Modal>
  );
}
