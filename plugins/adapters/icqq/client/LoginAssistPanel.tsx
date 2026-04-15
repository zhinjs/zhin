import { useCallback, useEffect, useRef, useState } from "react";
import {
  LogIn,
  QrCode,
  MessageSquare,
  MousePointer,
  Smartphone,
  AlertCircle,
  Loader2,
  X,
} from "lucide-react";
import { apiFetch } from "./utils/api";

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

const POLL_BASE_MS = 2_000;
const POLL_MAX_MS = 15_000;

const TYPE_META: Record<string, { icon: React.ReactNode; label: string }> = {
  qrcode: { icon: <QrCode className="w-4 h-4" />, label: "扫码登录" },
  sms: { icon: <MessageSquare className="w-4 h-4" />, label: "短信验证码" },
  device: { icon: <Smartphone className="w-4 h-4" />, label: "设备验证" },
  slider: { icon: <MousePointer className="w-4 h-4" />, label: "滑块验证" },
};

export default function LoginAssistPanel() {
  const [pending, setPending] = useState<PendingLoginTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const [inputValues, setInputValues] = useState<Record<string, string>>({});

  /* ── Exponential-backoff polling ── */
  const consecutiveEmptyRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchPending = useCallback(async () => {
    try {
      const res = await apiFetch("/api/login-assist/pending");
      if (!res.ok) throw new Error("获取待办失败");
      const data = (await res.json()) as unknown;
      const list = Array.isArray(data) ? (data as PendingLoginTask[]) : [];
      const filtered = list.filter((t) => t.adapter === "icqq");
      setPending(filtered);
      setError(null);
      consecutiveEmptyRef.current = filtered.length > 0 ? 0 : consecutiveEmptyRef.current + 1;
    } catch (err) {
      setError((err as Error).message);
      consecutiveEmptyRef.current++;
    } finally {
      setLoading(false);
    }
  }, []);

  const scheduleNext = useCallback(() => {
    const delay = Math.min(
      POLL_BASE_MS * Math.pow(1.5, consecutiveEmptyRef.current),
      POLL_MAX_MS,
    );
    timerRef.current = setTimeout(async () => {
      await fetchPending();
      scheduleNext();
    }, delay);
  }, [fetchPending]);

  useEffect(() => {
    fetchPending().then(scheduleNext);
    return () => clearTimeout(timerRef.current);
  }, [fetchPending, scheduleNext]);

  /* ── Actions ── */
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
      consecutiveEmptyRef.current = 0;
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

  /* ── Loading skeleton ── */
  if (loading && pending.length === 0) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        扫码、短信或滑块等验证会出现在下方；刷新页面后仍可继续处理（仅 ICQQ 待办）。
      </p>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded border border-red-200 bg-red-50 text-red-600 text-sm dark:bg-red-900/20 dark:text-red-400 dark:border-red-800">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {pending.length === 0 ? (
        <div className="border rounded-lg bg-card p-12 text-center">
          <LogIn className="w-16 h-16 mx-auto mb-4 opacity-25" />
          <h3 className="text-lg font-semibold mb-1">暂无待办</h3>
          <p className="text-sm text-muted-foreground">机器人需要验证时，待办将显示在此处</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pending.map((task) => {
            const meta = TYPE_META[task.type] ?? {
              icon: <LogIn className="w-4 h-4" />,
              label: task.type,
            };
            return (
              <div key={task.id} className="border rounded-lg bg-card p-4 shadow-sm">
                {/* Header */}
                <div className="flex items-start justify-between flex-wrap gap-2 mb-2">
                  <div className="flex items-center gap-2 font-semibold">
                    {meta.icon} {meta.label}
                  </div>
                  <div className="flex gap-1 text-xs">
                    <span className="px-2 py-0.5 rounded border">{task.adapter}</span>
                    <span className="px-2 py-0.5 rounded bg-muted">{task.botId}</span>
                  </div>
                </div>

                {/* Message */}
                {task.payload?.message && (
                  <p className="text-sm text-muted-foreground mb-3">{task.payload.message}</p>
                )}

                {/* QR Code */}
                {task.type === "qrcode" && task.payload?.image && (
                  <div className="flex justify-center p-4 bg-muted/30 rounded-lg mb-3">
                    <img
                      src={String(task.payload.image)}
                      alt="登录二维码"
                      className="max-w-[200px] w-full h-auto"
                    />
                  </div>
                )}

                {/* Slider URL */}
                {task.type === "slider" && task.payload?.url && (
                  <p className="text-sm break-all mb-3">
                    <span className="text-muted-foreground">滑块链接：</span>{" "}
                    <a
                      href={String(task.payload.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {String(task.payload.url)}
                    </a>
                  </p>
                )}

                {/* Text input (sms / device / slider ticket) */}
                {(task.type === "sms" || task.type === "device" || task.type === "slider") && (
                  <div className="flex flex-wrap gap-2 items-center">
                    <input
                      className="h-9 px-3 rounded-md border border-input bg-background text-sm max-w-[18rem] flex-1"
                      placeholder={task.type === "slider" ? "输入 ticket" : "输入验证码"}
                      value={inputValues[task.id] ?? ""}
                      onChange={(e) =>
                        setInputValues((v) => ({ ...v, [task.id]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const val = inputValues[task.id]?.trim();
                          if (val)
                            void handleSubmit(
                              task.id,
                              task.type === "slider" ? { ticket: val } : val,
                            );
                        }
                      }}
                    />
                    <button
                      className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
                      disabled={submitting[task.id] || !inputValues[task.id]?.trim()}
                      onClick={() => {
                        const val = inputValues[task.id]?.trim();
                        if (val)
                          void handleSubmit(
                            task.id,
                            task.type === "slider" ? { ticket: val } : val,
                          );
                      }}
                    >
                      {submitting[task.id] ? "提交中…" : "提交"}
                    </button>
                  </div>
                )}

                {/* QR code actions */}
                {task.type === "qrcode" && (
                  <div className="flex gap-2 mt-3">
                    <button
                      className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
                      disabled={!!submitting[task.id]}
                      onClick={() => void handleSubmit(task.id, { done: true })}
                    >
                      {submitting[task.id] ? "提交中…" : "我已扫码"}
                    </button>
                    <button
                      className="h-9 px-4 rounded-md border text-sm hover:bg-accent transition-colors"
                      onClick={() => void handleCancel(task.id)}
                    >
                      取消
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
