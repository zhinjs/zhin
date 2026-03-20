import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  LogIn,
  QrCode,
  MessageSquare,
  MousePointer,
  Smartphone,
  AlertCircle,
} from "lucide-react";
import { apiFetch } from "./utils/api";

const card: CSSProperties = {
  background: "hsl(var(--card))",
  color: "hsl(var(--card-foreground))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "var(--radius)",
};
const muted: CSSProperties = { color: "hsl(var(--muted-foreground))", fontSize: "0.875rem" };
const btn: CSSProperties = {
  padding: "0.375rem 0.75rem",
  borderRadius: "calc(var(--radius) - 2px)",
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--primary))",
  color: "hsl(var(--primary-foreground))",
  cursor: "pointer",
  fontSize: "0.875rem",
};
const btnOutline: CSSProperties = { ...btn, background: "transparent", color: "hsl(var(--foreground))" };
const inputStyle: CSSProperties = {
  padding: "0.5rem 0.75rem",
  borderRadius: "calc(var(--radius) - 2px)",
  border: "1px solid hsl(var(--input))",
  background: "hsl(var(--background))",
  color: "hsl(var(--foreground))",
  maxWidth: "18rem",
};

interface PendingLoginTask {
  id: string;
  adapter: string;
  botId: string;
  type: string;
  payload?: {
    message?: string;
    image?: string;
    url?: string;
    [key: string]: unknown;
  };
  createdAt: number;
}

const POLL_MS = 2000;

export default function LoginAssistPanel() {
  const [pending, setPending] = useState<PendingLoginTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const [inputValues, setInputValues] = useState<Record<string, string>>({});

  const fetchPending = useCallback(async () => {
    try {
      const res = await apiFetch("/api/login-assist/pending");
      if (!res.ok) throw new Error("获取待办失败");
      const data = (await res.json()) as unknown;
      const list = Array.isArray(data) ? (data as PendingLoginTask[]) : [];
      setPending(list.filter((t) => t.adapter === "icqq"));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPending();
    const id = setInterval(fetchPending, POLL_MS);
    return () => clearInterval(id);
  }, [fetchPending]);

  const handleSubmit = async (id: string, value: string | Record<string, unknown>) => {
    setSubmitting((s) => ({ ...s, [id]: true }));
    try {
      const res = await apiFetch("/api/login-assist/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, value }),
      });
      if (!res.ok) throw new Error("提交失败");
      setInputValues((v) => {
        const next = { ...v };
        delete next[id];
        return next;
      });
      await fetchPending();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting((s) => ({ ...s, [id]: false }));
    }
  };

  const handleCancel = async (id: string) => {
    try {
      const res = await apiFetch("/api/login-assist/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) await fetchPending();
    } catch {
      /* ignore */
    }
  };

  const typeIcon: Record<string, ReactNode> = {
    qrcode: <QrCode style={{ width: 16, height: 16 }} />,
    sms: <MessageSquare style={{ width: 16, height: 16 }} />,
    device: <Smartphone style={{ width: 16, height: 16 }} />,
    slider: <MousePointer style={{ width: 16, height: 16 }} />,
  };
  const typeLabel: Record<string, string> = {
    qrcode: "扫码登录",
    sms: "短信验证码",
    device: "设备验证",
    slider: "滑块验证",
    other: "其他",
  };

  if (loading && pending.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div style={{ ...card, height: "2rem", width: "12rem", opacity: 0.5 }} />
        <div style={{ ...card, height: "8rem", opacity: 0.5 }} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <p style={muted}>
        扫码、短信或滑块等验证会出现在下方；刷新页面后仍可继续处理（仅 ICQQ 待办）。
      </p>

      {error && (
        <div
          style={{
            ...card,
            borderColor: "hsl(var(--destructive))",
            color: "hsl(var(--destructive))",
            padding: "0.75rem",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <AlertCircle style={{ width: 16, height: 16, flexShrink: 0 }} />
          <span style={{ fontSize: "0.875rem" }}>{error}</span>
        </div>
      )}

      {pending.length === 0 ? (
        <div style={{ ...card, padding: "3rem", textAlign: "center" }}>
          <LogIn style={{ width: 64, height: 64, margin: "0 auto 1rem", opacity: 0.25 }} />
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "1.125rem" }}>暂无待办</h3>
          <p style={{ ...muted, margin: 0 }}>机器人需要验证时，待办将显示在此处</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {pending.map((task) => (
            <div key={task.id} style={{ ...card, padding: "1rem" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: "0.5rem",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 600 }}>
                  {typeIcon[task.type] ?? <LogIn style={{ width: 16, height: 16 }} />}
                  {typeLabel[task.type] ?? task.type}
                </div>
                <div style={{ display: "flex", gap: "0.5rem", fontSize: "0.75rem" }}>
                  <span
                    style={{
                      padding: "0.125rem 0.5rem",
                      borderRadius: 4,
                      border: "1px solid hsl(var(--border))",
                    }}
                  >
                    {task.adapter}
                  </span>
                  <span
                    style={{
                      padding: "0.125rem 0.5rem",
                      borderRadius: 4,
                      background: "hsl(var(--muted))",
                    }}
                  >
                    {task.botId}
                  </span>
                </div>
              </div>
              {task.payload?.message && <p style={{ ...muted, margin: "0 0 1rem" }}>{task.payload.message}</p>}

              {task.type === "qrcode" && task.payload?.image && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    padding: "1rem",
                    background: "hsl(var(--muted) / 0.3)",
                    borderRadius: "var(--radius)",
                    marginBottom: "1rem",
                  }}
                >
                  <img
                    src={String(task.payload.image)}
                    alt="登录二维码"
                    style={{ maxWidth: 200, width: "100%", height: "auto" }}
                  />
                </div>
              )}

              {task.type === "slider" && task.payload?.url && (
                <p style={{ fontSize: "0.875rem", wordBreak: "break-all", marginBottom: "1rem" }}>
                  <span style={muted}>滑块链接：</span>{" "}
                  <a
                    href={String(task.payload.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "hsl(var(--primary))" }}
                  >
                    {String(task.payload.url)}
                  </a>
                </p>
              )}

              {(task.type === "sms" || task.type === "device" || task.type === "slider") && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                  <input
                    style={inputStyle}
                    placeholder={task.type === "slider" ? "输入 ticket" : "输入验证码"}
                    value={inputValues[task.id] ?? ""}
                    onChange={(e) => setInputValues((v) => ({ ...v, [task.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const val = inputValues[task.id]?.trim();
                        if (val)
                          void handleSubmit(task.id, task.type === "slider" ? { ticket: val } : val);
                      }
                    }}
                  />
                  <button
                    type="button"
                    style={btn}
                    disabled={submitting[task.id] || !inputValues[task.id]?.trim()}
                    onClick={() => {
                      const val = inputValues[task.id]?.trim();
                      if (val) void handleSubmit(task.id, task.type === "slider" ? { ticket: val } : val);
                    }}
                  >
                    {submitting[task.id] ? "提交中…" : "提交"}
                  </button>
                </div>
              )}

              {task.type === "qrcode" && (
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                  <button
                    type="button"
                    style={btn}
                    disabled={!!submitting[task.id]}
                    onClick={() => void handleSubmit(task.id, { done: true })}
                  >
                    {submitting[task.id] ? "提交中…" : "我已扫码"}
                  </button>
                  <button type="button" style={btnOutline} onClick={() => void handleCancel(task.id)}>
                    取消
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
