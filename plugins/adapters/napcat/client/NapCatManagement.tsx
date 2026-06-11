import { useCallback, useEffect, useState } from "react";
import { Bot, Users, RefreshCw, Wifi, WifiOff, Loader2, Activity } from "lucide-react";
import { apiFetch } from "./utils/api";

interface EndpointRow {
  name: string;
  connected: boolean;
  connection: string;
  groupCount: number;
  friendCount: number;
  status: string;
}

export default function NapCatManagement() {
  const [endpoints, setEndpoints] = useState<EndpointRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const loadBots = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch("/api/napcat/endpoints");
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
    void loadBots();
  }, [loadBots]);

  const connectionLabel = (c: string) => {
    switch (c) {
      case 'ws': return '正向 WS';
      case 'wss': return '反向 WS';
      case 'http': return 'HTTP';
      default: return c;
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="w-6 h-6" /> NapCat 管理
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            NapCatQQ 机器人概览（OneBot11 + go-cqhttp + NapCat 扩展）
          </p>
        </div>
        <button
          onClick={loadBots}
          disabled={loading}
          className="flex items-center gap-1 px-3 py-1.5 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> 刷新
        </button>
      </div>

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
          暂无 NapCat Endpoint 实例
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
                  连接方式 {connectionLabel(endpoint.connection)} · {endpoint.status}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
