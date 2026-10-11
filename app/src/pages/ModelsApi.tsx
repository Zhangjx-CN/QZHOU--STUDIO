import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { N8nInstance, Provider } from "../api/types";
import { Empty, Modal, useToast } from "../api/ui";

// 快捷预设：点一下自动填 BASE URL 和模型名（豆包模型名留空，让用户填 ep- 接入点）
const PRESETS = [
  { key: "deepseek", label: "DeepSeek", base: "https://api.deepseek.com/v1", models: "deepseek-chat" },
  { key: "zhipu", label: "智谱 GLM", base: "https://open.bigmodel.cn/api/paas/v4", models: "glm-4-flash" },
  { key: "openai", label: "OpenAI", base: "https://api.openai.com/v1", models: "gpt-4o-mini" },
  { key: "moonshot", label: "Kimi", base: "https://api.moonshot.cn/v1", models: "kimi-latest" },
  { key: "qwen", label: "通义千问", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", models: "qwen-plus" },
  { key: "doubao", label: "豆包", base: "https://ark.cn-beijing.volces.com/api/v3", models: "" },
];

export default function ModelsApi() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [n8ns, setN8ns] = useState<N8nInstance[]>([]);
  const [showAddModel, setShowAddModel] = useState(false);
  const [showAddLocal, setShowAddLocal] = useState(false);
  const [showAddN8n, setShowAddN8n] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    const [ps, ns] = await Promise.all([api.listProviders(), api.listN8n()]);
    setProviders(ps);
    setN8ns(ns);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const removeProvider = async (p: Provider) => {
    if (!window.confirm(`删除「${p.name}」？\n其下所有模型都会移除。`)) return;
    try {
      await api.deleteProvider(p.id);
      toast("已删除");
      load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  return (
    <div>
      {/* 大模型 */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3>模型连接</h3>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn" onClick={() => setShowAddLocal(true)}>＋ 添加本地模型</button>
            <button className="btn primary" onClick={() => setShowAddModel(true)}>＋ 接入云端模型</button>
          </div>
        </div>
        {providers.length === 0 ? (
          <Empty text="还没有接入模型。选择一个服务商并填入连接信息即可开始使用。" />
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>模型</th><th>服务地址</th><th>连接配置</th><th></th></tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div>{p.name}</div>
                    <div className="muted mono" style={{ fontSize: 11 }}>
                      {p.models.map((m) => m.display_name).join(" / ") || "—"}
                    </div>
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>{p.base_url ?? "—"}</td>
                  <td>
                    {p.provider_key.startsWith("local_")
                      ? <span className="badge on">● 本地服务</span>
                      : p.api_connection_id
                      ? <span className="badge on">● 已配置密钥</span>
                      : <span className="badge off">○ 待配置密钥</span>}
                  </td>
                  <td>
                    <button className="btn sm danger" onClick={() => removeProvider(p)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="hint" style={{ marginTop: 8 }}>
          连接后，回到「工作台」选择 AI 并发送消息。云端服务需要填写该平台提供的 API 密钥。
        </div>
      </div>

      {/* 工作流引擎 */}
      <div className="card" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3>工作流引擎</h3>
          <button className="btn primary" onClick={() => setShowAddN8n(true)}>＋ 添加工作流</button>
        </div>
        {n8ns.length === 0 ? (
          <div className="muted" style={{ fontSize: 12 }}>还没有接入工作流。添加 n8n Webhook 后，可在工作台选择并触发，结果会返回到对话中。</div>
        ) : (
          <table className="tbl">
            <thead><tr><th>名称</th><th>ENDPOINT</th><th>TOKEN</th><th></th></tr></thead>
            <tbody>
              {n8ns.map((n) => (
                <tr key={n.id}>
                  <td>{n.name}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{n.endpoint}</td>
                  <td className="mono">{n.token_hint ?? "—"}</td>
                  <td>
                    <button className="btn sm danger" onClick={async () => { await api.deleteN8n(n.id); toast("已删除工作流引擎"); load(); }}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAddModel && (
        <AddModelModal
          onClose={() => setShowAddModel(false)}
          onDone={async () => { setShowAddModel(false); await load(); }}
        />
      )}
      {showAddLocal && (
        <AddLocalModelModal
          onClose={() => setShowAddLocal(false)}
          onDone={async () => { setShowAddLocal(false); await load(); }}
        />
      )}
      {showAddN8n && (
        <AddN8nModal
          onClose={() => setShowAddN8n(false)}
          onDone={async () => { setShowAddN8n(false); await load(); }}
        />
      )}
    </div>
  );
}

function AddLocalModelModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("本地模型");
  const [base, setBase] = useState("http://127.0.0.1:11434/v1");
  const [models, setModels] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!base.trim() || !models.trim()) { toast("Base URL 和模型名必填", "err"); return; }
    setBusy(true);
    try {
      const r = await api.addLocalModel({ name: name.trim() || "本地模型", base_url: base.trim(), models: models.trim() });
      toast(`已添加本地服务：${r.models_added} 个模型`);
      onDone();
    } catch (e) { toast((e as Error).message, "err"); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="添加本地模型服务" onClose={onClose} width={560}>
      <div className="hint" style={{ marginBottom: 12 }}>
        支持 Ollama、LM Studio、vLLM 等 OpenAI 兼容服务。Ollama 未运行时，轻舟会自动尝试启动；其他运行器仍需先启动服务。
      </div>
      <div className="field"><label>名称</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：本地 Ollama" /></div>
      <div className="field"><label>BASE URL</label><input value={base} onChange={(e) => setBase(e.target.value)} placeholder="http://127.0.0.1:11434/v1" /></div>
      <div className="field"><label>模型名（逗号分隔）</label><input value={models} onChange={(e) => setModels(e.target.value)} placeholder="qwen2.5:7b" /></div>
      <div className="m-actions"><button className="btn" onClick={onClose}>取消</button><button className="btn primary" disabled={busy} onClick={submit}>{busy ? "添加中…" : "添加 ▸"}</button></div>
    </Modal>
  );
}

/* ================= 接入大模型 ================= */

function AddModelModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [svc, setSvc] = useState("");
  const [base, setBase] = useState("");
  const [key, setKey] = useState("");
  const [models, setModels] = useState("");
  const [busy, setBusy] = useState(false);

  const pick = (p: { key: string; base: string; models: string }) => {
    setSvc(p.key);
    setBase(p.base);
    setModels(p.models);
  };

  const submit = async () => {
    if (!key.trim()) {
      toast("请填写 API Key", "err");
      return;
    }
    if (!svc && !base.trim()) {
      toast("请选择服务或填写 Base URL", "err");
      return;
    }
    if (svc === "doubao" && !models.trim()) {
      toast("豆包需填写推理接入点 ID（ep- 开头）", "err");
      return;
    }
    setBusy(true);
    try {
      const r = await api.addOnlineService({
        service_key: svc || "custom",
        api_key: key.trim(),
        base_url: base.trim(),
        models: models.trim(),
      });
      toast(`已接入 ${r.name}：${r.models_added} 个模型`);
      onDone();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="接入大模型" onClose={onClose} width={560}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {PRESETS.map((p) => (
          <button key={p.key} className={`btn sm ${svc === p.key ? "primary" : "ghost"}`} onClick={() => pick(p)}>{p.label}</button>
        ))}
        <button
          className={`btn sm ${!svc && !base ? "primary" : "ghost"}`}
          onClick={() => { setSvc(""); setBase(""); setModels(""); }}
        >
          自定义
        </button>
      </div>
      <div className="field">
        <label>BASE URL</label>
        <input value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://…/v1（选预设自动填）" />
      </div>
      <div className="field">
        <label>API KEY</label>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…（本地加密保存）" />
      </div>
      <div className="field">
        <label>{svc === "doubao" ? "推理接入点 ID（ep- 开头）" : "模型名（逗号分隔）"}</label>
        <input
          value={models}
          onChange={(e) => setModels(e.target.value)}
          placeholder={svc === "doubao" ? "ep-2024xxxx-xxxxx" : "model-a, model-b"}
        />
      </div>
      <div className="m-actions">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={busy} onClick={submit}>{busy ? "接入中…" : "接入 ▸"}</button>
      </div>
    </Modal>
  );
}

/* ================= 添加 n8n ================= */

function AddN8nModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || !endpoint.trim()) {
      toast("名称与 Endpoint 必填", "err");
      return;
    }
    setBusy(true);
    try {
      await api.createN8n({ name: name.trim(), endpoint: endpoint.trim(), token: token.trim(), description: desc });
      toast("已添加工作流引擎");
      onDone();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="添加工作流引擎" onClose={onClose} width={520}>
      <div className="field">
        <label>名称</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 网页抓取流程" />
      </div>
      <div className="field">
        <label>WEBHOOK ENDPOINT</label>
        <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://your-n8n.example.com/webhook/xxx" />
      </div>
      <div className="field">
        <label>TOKEN（可选）</label>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bearer Token（本地加密）" />
      </div>
      <div className="field">
        <label>描述</label>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="这个流程做什么" />
      </div>
      <div className="m-actions">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={busy} onClick={submit}>添加</button>
      </div>
    </Modal>
  );
}
