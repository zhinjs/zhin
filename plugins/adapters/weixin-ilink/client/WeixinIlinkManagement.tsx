import { useCallback, useEffect, useState } from "react";
import { Bot, LogIn, RefreshCw, Wifi, WifiOff, Loader2 } from "lucide-react";
import LoginAssistPanel from "./LoginAssistPanel";
import { apiFetch } from "./utils/api";

interface EndpointRow {
  name: string;
  connected: boolean;
  status: string;
  hasCredentials?: boolean;
}

type Tab = "overview" | "login";

export default function WeixinIlinkManagement() {
  const [tab, setTab] = useState<Tab>("overview");
  const [endpoints, setEndpoints] = useState<EndpointRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const loadBots = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/weixin-ilink/endpoints");
      const json = (await res.json()) as { success?: boolean; data?: EndpointRow[]; message?: string };
      if (!res.ok || !json.success) throw new Error(json.message || "加载失败");
      setEndpoints(Array.isArray(json.data) ? json.data : []);
    } catch (e) {
      setErr((e as Error).message);
      setEndpoints([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "overview") void loadBots();
  }, [tab, loadBots]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="w-6 h-6" /> 微信 iLink（ClawBot）
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            个人微信长轮询适配器：概览与扫码登录辅助
          </p>
        </div>
        {tab === "overview" && (
          <button
            type="button"
            onClick={() => void loadBots()}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> 刷新
          </button>
        )}
      </div>

      <div className="flex gap-1 border-b">
        <button
          type="button"
          onClick={() => setTab("overview")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "overview"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          <span className="flex items-center gap-1.5">
            <Bot className="w-4 h-4" /> 概览
          </span>
        </button>
        <button
          type="button"
          onClick={() => setTab("login")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "login"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          <span className="flex items-center gap-1.5">
            <LogIn className="w-4 h-4" /> 登录辅助
          </span>
        </button>
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          {err && (
            <p className="text-sm text-red-600">{err}</p>
          )}
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : endpoints.length === 0 ? (
            <div className="border rounded-lg p-8 text-center text-muted-foreground">
              暂无 weixin-ilink Endpoint 实例
            </div>
          ) : (
            <div className="grid gap-3">
              {endpoints.map((endpoint) => (
                <div key={endpoint.name} className="border rounded-lg p-4 flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{endpoint.name}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      凭证：{endpoint.hasCredentials ? "已保存" : "未登录"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    {endpoint.connected ? (
                      <>
                        <Wifi className="w-4 h-4 text-green-500" />
                        <span className="text-green-600">在线</span>
                      </>
                    ) : (
                      <>
                        <WifiOff className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-500">离线</span>
                      </>
                    )}
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
