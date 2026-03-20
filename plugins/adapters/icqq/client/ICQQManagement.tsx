import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Activity, Bot, LogIn, Users } from "lucide-react";
import LoginAssistPanel from "./LoginAssistPanel";
import { apiFetch } from "./utils/api";

const shell: CSSProperties = { display: "flex", flexDirection: "column", gap: "1.25rem" };
const title: CSSProperties = { fontSize: "1.5rem", fontWeight: 700, margin: 0 };
const sub: CSSProperties = { color: "hsl(var(--muted-foreground))", fontSize: "0.875rem", margin: "0.25rem 0 0" };
const tabsRow: CSSProperties = { display: "flex", gap: "0.25rem", borderBottom: "1px solid hsl(var(--border))", paddingBottom: 2 };
const tabBtn = (active: boolean): CSSProperties => ({
  padding: "0.5rem 1rem",
  fontSize: "0.875rem",
  fontWeight: 500,
  border: "none",
  borderRadius: "calc(var(--radius) - 2px) calc(var(--radius) - 2px) 0 0",
  cursor: "pointer",
  background: active ? "hsl(var(--muted))" : "transparent",
  color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
});
const card: CSSProperties = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "var(--radius)",
  padding: "1rem",
};

interface BotRow {
  name: string;
  connected: boolean;
  groupCount: number;
  friendCount: number;
  loginMode: string;
  status: string;
}

export default function ICQQManagement() {
  const [tab, setTab] = useState<"overview" | "login">("overview");
  const [bots, setBots] = useState<BotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const loadBots = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/icqq/bots");
      const json = (await res.json()) as { success?: boolean; data?: BotRow[]; message?: string };
      if (!res.ok || !json.success) throw new Error(json.message || "加载失败");
      setBots(Array.isArray(json.data) ? json.data : []);
    } catch (e) {
      setErr((e as Error).message);
      setBots([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "overview") void loadBots();
  }, [tab, loadBots]);

  return (
    <div style={shell}>
      <div>
        <h1 style={title}>ICQQ 管理</h1>
        <p style={sub}>机器人概览与登录辅助（扫码 / 验证码 / 滑块）</p>
      </div>

      <div style={tabsRow}>
        <button type="button" style={tabBtn(tab === "overview")} onClick={() => setTab("overview")}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Bot style={{ width: 16, height: 16 }} />
            概览
          </span>
        </button>
        <button type="button" style={tabBtn(tab === "login")} onClick={() => setTab("login")}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <LogIn style={{ width: 16, height: 16 }} />
            登录辅助
          </span>
        </button>
      </div>

      {tab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {err && (
            <div style={{ ...card, color: "hsl(var(--destructive))", fontSize: "0.875rem" }}>{err}</div>
          )}
          {loading ? (
            <div style={{ ...card, opacity: 0.6 }}>加载中…</div>
          ) : bots.length === 0 ? (
            <div style={{ ...card, textAlign: "center", color: "hsl(var(--muted-foreground))" }}>
              暂无 ICQQ 机器人实例
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: "1rem",
              }}
            >
              {bots.map((b) => (
                <div key={b.name} style={card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <strong style={{ fontSize: "1rem" }}>{b.name}</strong>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        padding: "0.125rem 0.5rem",
                        borderRadius: 999,
                        background: b.connected ? "hsl(142 76% 36% / 0.15)" : "hsl(var(--muted))",
                        color: b.connected ? "hsl(142 76% 30%)" : "hsl(var(--muted-foreground))",
                      }}
                    >
                      {b.connected ? "在线" : "离线"}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "0.8125rem", color: "hsl(var(--muted-foreground))" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Users style={{ width: 14, height: 14 }} />
                      群 {b.groupCount} · 好友 {b.friendCount}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Activity style={{ width: 14, height: 14 }} />
                      登录方式 {b.loginMode} · {b.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "login" && <LoginAssistPanel />}
    </div>
  );
}
