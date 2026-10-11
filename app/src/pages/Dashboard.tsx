import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

interface ModelCost { model_key: string; calls: number; tokens: number; cost: number }
interface ModelInventory { provider_name: string; model_key: string; display_name: string; enabled: number; calls: number; last_used: string }
interface AgentInventory { name: string; description: string; available: boolean; calls: number; last_used: string }
interface LogRow {
  model_provider: string | null;
  model_name: string | null;
  status: string;
  cost_estimate: number;
  duration_ms: number;
  execution_time: string;
  token_usage_json?: string;
  target_type?: string;
}
interface Dash {
  providers: number;
  models: number;
  n8n_instances: number;
  projects: number;
  sessions: number;
  cost: { total: number; calls: number; today: number; priced_calls: number; tokens: number; per_model: ModelCost[] };
  calls_today: number;
  calls_total: number;
  calls_success: number;
  success_rate: number;
  avg_duration_ms: number;
  recent_logs: LogRow[];
  model_inventory: ModelInventory[];
  agent_inventory: AgentInventory[];
  timestamp: string;
}

const usd = (n: number) => "$" + (n ?? 0).toFixed(4);
const ms = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + "s" : Math.round(n) + "ms");
const shortTime = (s: string) => (s || "").slice(5, 16);

export default function Dashboard() {
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setD(await api.dashboard());
      setErr(null);
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);

  if (err) return <div className="empty">仪表盘加载失败：{err}</div>;
  if (!d) return <div className="empty">加载中…</div>;

  const perModel = d.cost?.per_model || [];
  const maxCost = Math.max(...perModel.map(x => x.cost), 0.001);
  const logs = d.recent_logs || [];
  const totalCalls = d.calls_total ?? d.cost?.calls ?? 0;

  return (
    <>
      <div className="page-header">
        <div className="page-title">
          仪表盘<span className="crumb">调用量 · 成本 · 成功率 · 耗时</span>
        </div>
        <div className="page-actions">
          <span className="badge"><span className="dot" />每 8 秒自动刷新</span>
          <button className="btn sm" onClick={load}>立即刷新</button>
        </div>
      </div>

      <div className="content">
        <div className="dashboard-section-title"><span>OVERVIEW</span><b>运行概览</b><em>只统计真实调用</em></div>
        <div className="stat-grid">
          <div className="stat">
            <div className="s-label">CALLS · 调用总数</div>
            <div className="s-value">{totalCalls}</div>
            <div className="s-sub">今日 {d.calls_today ?? 0} 次</div>
          </div>
          <div className="stat">
            <div className="s-label">SUCCESS · 成功率</div>
            <div className="s-value">{d.success_rate == null ? "—" : <>{d.success_rate}<small>%</small></>}</div>
            <div className="s-sub">{totalCalls ? `${d.calls_success ?? 0} / ${totalCalls} 次成功` : "尚无真实调用"}</div>
          </div>
          <div className="stat">
            <div className="s-label">COST · 已计价成本</div>
            <div className="s-value">{d.cost?.priced_calls ? usd(d.cost.total) : "—"}</div>
            <div className="s-sub">{d.cost?.priced_calls ? `今日 ${usd(d.cost.today)}` : `已记录 ${(d.cost?.tokens ?? 0).toLocaleString()} tokens · 未配置价格`}</div>
          </div>
          <div className="stat">
            <div className="s-label">LATENCY · 平均耗时</div>
            <div className="s-value">{d.avg_duration_ms ? ms(d.avg_duration_ms) : "—"}</div>
            <div className="s-sub">{totalCalls ? "所有真实调用平均耗时" : "尚无真实调用"}</div>
          </div>
          <div className="stat">
            <div className="s-label">MODELS · 接入模型</div>
            <div className="s-value">{d.models ?? 0}</div>
            <div className="s-sub">{d.providers ?? 0} 个 provider</div>
          </div>
          <div className="stat">
            <div className="s-label">SESSIONS · 会话</div>
            <div className="s-value">{d.sessions ?? 0}</div>
            <div className="s-sub">{d.projects ?? 0} 个项目 · {d.n8n_instances ?? 0} 条工作流</div>
          </div>
        </div>

        <div className="dashboard-section-title compact"><span>CONNECTED</span><b>已接入能力</b><em>配置状态与实际使用情况</em></div>
        <div className="card" style={{ marginTop: 0 }}>
          <h3>已接入 Agent · CONNECTED AGENTS</h3>
          {(d.agent_inventory || []).length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>还没有接入智能体，请到“智能体”页面添加。</div>
          ) : (
            <table className="tbl">
              <thead><tr><th>Agent</th><th>状态</th><th style={{ width: 100, textAlign: "right" }}>调用次数</th><th style={{ width: 150 }}>最近调用</th></tr></thead>
              <tbody>{d.agent_inventory.map(a => <tr key={a.name}>
                <td><div>{a.name}</div><div className="muted" style={{ fontSize: 11 }}>{a.description}</div></td>
                <td><span className={`badge ${a.available ? "on" : "dead"}`}><span className="dot" />{a.available ? "可调用" : "未配置"}</span></td>
                <td className="mono" style={{ textAlign: "right" }}>{a.calls}</td>
                <td className="mono">{a.last_used ? shortTime(a.last_used) : "尚未调用"}</td>
              </tr>)}</tbody>
            </table>
          )}
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <h3>已接入模型 · CONNECTED MODELS</h3>
          {(d.model_inventory || []).length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>还没有启用的模型，请到“连接管理”页面接入。</div>
          ) : (
            <table className="tbl">
              <thead><tr><th>提供方</th><th>模型</th><th style={{ width: 100 }}>状态</th><th style={{ width: 100, textAlign: "right" }}>调用次数</th><th style={{ width: 150 }}>最近调用</th></tr></thead>
              <tbody>{d.model_inventory.map(m => <tr key={`${m.provider_name}:${m.model_key}`}>
                <td>{m.provider_name}</td><td>{m.display_name || m.model_key}</td>
                <td><span className={`badge ${m.enabled ? "on" : "dead"}`}><span className="dot" />{m.enabled ? "已启用" : "已停用"}</span></td>
                <td className="mono" style={{ textAlign: "right" }}>{m.calls}</td>
                <td className="mono">{m.last_used ? shortTime(m.last_used) : "尚未调用"}</td>
              </tr>)}</tbody>
            </table>
          )}
        </div>

        <div className="dashboard-section-title compact"><span>ACTIVITY</span><b>调用活动</b><em>最近 8 条真实记录</em></div>
        <div className="card" style={{ marginTop: 0 }}>
          <h3>各模型调用 · USAGE BY MODEL</h3>
          {perModel.length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>暂无执行记录</div>
          ) : (
            perModel.map(x => {
              const pct = ((x.cost / maxCost) * 100);
              const share = totalCalls ? ((x.calls / totalCalls) * 100).toFixed(1) : "0.0";
              return (
                <div className="bar-row" key={x.model_key}>
                  <span className="b-label">{x.model_key}</span>
                  <span className="b-track">
                    <span className="b-fill" style={{ width: `${Math.max(pct, 3)}%` }} />
                  </span>
                  <span className="b-val">{x.tokens || 0} tok · {x.calls} 次 · {share}%</span>
                </div>
              );
            })
          )}
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <h3>最近调用 · RECENT CALLS</h3>
          {logs.length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>暂无执行记录</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 100 }}>时间</th>
                  <th>模型</th>
                  <th style={{ width: 90 }}>来源</th>
                  <th style={{ width: 80 }}>状态</th>
                  <th style={{ width: 80, textAlign: "right" }}>耗时</th>
                  <th style={{ width: 80, textAlign: "right" }}>Tokens</th>
                  <th style={{ width: 90, textAlign: "right" }}>成本</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l, i) => {
                  let tok = 0;
                  try { tok = JSON.parse(l.token_usage_json || "{}").tokens || 0; } catch { /* ignore */ }
                  return (
                  <tr key={i}>
                    <td className="mono">{shortTime(l.execution_time)}</td>
                    <td>{l.model_name || "—"}</td>
                    <td>{l.target_type === "agent" ? "agent" : (l.model_provider || "—")}</td>
                    <td>
                      <span className={`badge ${l.status === "completed" ? "on" : "dead"}`}>
                        <span className="dot" />{l.status === "completed" ? "成功" : (l.status || "失败")}
                      </span>
                    </td>
                    <td className="mono" style={{ textAlign: "right" }}>{l.duration_ms ? ms(l.duration_ms) : "—"}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{tok ? tok.toLocaleString() : "—"}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{l.cost_estimate > 0 ? usd(l.cost_estimate) : "未计价"}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <h3>SYSTEM · 系统</h3>
          <div className="mono" style={{ fontSize: 11, color: "var(--color-text-faint)" }}>
            本地服务: 127.0.0.1:8000 · SQLite WAL · 数据目录: /data/app.db
            <br />核心定位: 本地统一 AI 调度壳 —— 调模型 / n8n / 工作流，不造轮子
            <br />快照时间: {d.timestamp}
          </div>
        </div>
      </div>
    </>
  );
}
