import { useCallback, useEffect, useState } from "react";
import { Activity, Bot, Endpoint, LogIn, Users, RefreshCw, Wifi, WifiOff, Loader2 } from "lucide-react";
import LoginAssistPanel from "./LoginAssistPanel";
import { apiFetch } from "./utils/api";

interface EndpointRow {
  name: string;
  connected: boolean;
  groupCount: number;
  friendCount: number;
  loginMode: string;
  status: string;
}

type Tab = "overview" | "login";

export default function ICQQManagement() {
  const [tab, setTab] = useState<Tab>("overview");
  const [endpoints, setEndpoints] = useState<EndpointRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const loadBots = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/icqq/endpoints");
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="w-6 h-6" /> ICQQ 管理
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            机器人概览与登录辅助（扫码 / 验证码 / 滑块）
          </p>
        </div>
        {tab === "overview" && (
          <button
            onClick={loadBots}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> 刷新
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        <button
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

      {/* Overview Tab */}
      {tab === "overview" && (
        <>
          {err && (
            <div className="p-3 bg-red-50 text-red-600 rounded border border-red-200 text-sm dark:bg-red-900/20 dark:text-red-400 dark:border-red-800">
              {err}
            </div>
          )}
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : endpoints.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              暂无 ICQQ Endpoint 实例
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {endpoints.map((endpoint) => (
                <div key={endpoint.name} className="border rounded-lg p-4 bg-card shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-medium text-lg">{endpoint.name}</span>
                    {endpoint.connected ? (
                      <span className="flex items-center gap-1 text-green-600 text-sm">
                        <Wifi className="w-4 h-4" /> 在线
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-gray-400 text-sm">
                        <WifiOff className="w-4 h-4" /> 离线
                      </span>
                    )}
                  </div>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5" />
                      群 {endpoint.groupCount} · 好友 {endpoint.friendCount}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5" />
                      登录方式 {endpoint.loginMode} · {endpoint.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Login Tab */}
      {tab === "login" && <LoginAssistPanel />}
    </div>
  );
}
