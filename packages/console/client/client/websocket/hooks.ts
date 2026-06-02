import { useCallback, useEffect, useMemo, useState } from "react";
import { getWebSocketManager } from "./instance";
import type { UseWebSocketOptions } from "./types";

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const { autoConnect = true } = options;
  const wsManager = getWebSocketManager();
  const [connected, setConnected] = useState(wsManager.isConnected());

  useEffect(() => {
    return wsManager.onConnectionChange(setConnected);
  }, [wsManager]);

  const connect = useCallback(() => wsManager.connect(), [wsManager]);
  const disconnect = useCallback(() => wsManager.disconnect(), [wsManager]);
  const send = useCallback((message: unknown) => wsManager.send(message), [wsManager]);
  const sendRequest = useCallback(
    <T = unknown>(message: unknown) => wsManager.sendRequest<T>(message),
    [wsManager],
  );

  useEffect(() => {
    if (autoConnect && !connected) connect();
  }, [autoConnect, connected, connect]);

  return { connected, connect, disconnect, send, sendRequest, manager: wsManager };
}

export function useConfig(pluginName: string, options?: { autoLoad?: boolean; autoLoadSchema?: boolean }) {
  const { autoLoad = true, autoLoadSchema = true } = options ?? {};
  const wsManager = getWebSocketManager();
  const [connected, setConnected] = useState(wsManager.isConnected());
  const [config, setConfigState] = useState<unknown>(null);
  const [schema, setSchemaState] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => wsManager.onConnectionChange(setConnected), [wsManager]);

  const getConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await wsManager.getConfig(pluginName);
      setConfigState(result);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      throw e;
    } finally {
      setLoading(false);
    }
  }, [pluginName, wsManager]);

  const setConfig = useCallback(
    async (newConfig: unknown) => {
      setLoading(true);
      setError(null);
      try {
        return await wsManager.setConfig(pluginName, newConfig);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [pluginName, wsManager],
  );

  const getSchema = useCallback(async () => {
    try {
      const result = await wsManager.getSchema(pluginName);
      if (result) setSchemaState(result);
      return result;
    } catch (e) {
      throw e;
    }
  }, [pluginName, wsManager]);

  useEffect(() => {
    if (connected && autoLoad && !config && !loading) getConfig().catch(() => {});
  }, [connected, autoLoad, config, loading, getConfig]);

  useEffect(() => {
    if (connected && autoLoadSchema && !schema) getSchema().catch(() => {});
  }, [connected, autoLoadSchema, schema, getSchema]);

  return useMemo(
    () => ({ config, schema, loading, error, connected, getConfig, setConfig, getSchema }),
    [config, schema, loading, error, connected, getConfig, setConfig, getSchema],
  );
}

export function useConfigYaml() {
  const wsManager = getWebSocketManager();
  const [connected, setConnected] = useState(wsManager.isConnected());
  const [yaml, setYaml] = useState("");
  const [pluginKeys, setPluginKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => wsManager.onConnectionChange(setConnected), [wsManager]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await wsManager.getConfigYaml();
      setYaml(result.yaml);
      setPluginKeys(result.pluginKeys);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      throw e;
    } finally {
      setLoading(false);
    }
  }, [wsManager]);

  const save = useCallback(
    async (content: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await wsManager.saveConfigYaml(content);
        setYaml(content);
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [wsManager],
  );

  useEffect(() => {
    if (connected && !yaml && !loading) load().catch(() => {});
  }, [connected, yaml, loading, load]);

  return useMemo(() => ({ yaml, pluginKeys, loading, error, load, save }), [yaml, pluginKeys, loading, error, load, save]);
}

export function useFiles() {
  const wsManager = getWebSocketManager();
  const [connected, setConnected] = useState(wsManager.isConnected());
  const [tree, setTree] = useState<import("./types").FileTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => wsManager.onConnectionChange(setConnected), [wsManager]);

  const loadTree = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await wsManager.getFileTree();
      setTree(result.tree);
      return result.tree;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      throw e;
    } finally {
      setLoading(false);
    }
  }, [wsManager]);

  const readFile = useCallback(async (filePath: string) => (await wsManager.readFile(filePath)).content, [wsManager]);
  const saveFile = useCallback(
    async (filePath: string, content: string) => wsManager.saveFile(filePath, content),
    [wsManager],
  );

  useEffect(() => {
    if (connected && tree.length === 0 && !loading) loadTree().catch(() => {});
  }, [connected, tree.length, loading, loadTree]);

  return useMemo(() => ({ tree, loading, error, loadTree, readFile, saveFile }), [tree, loading, error, loadTree, readFile, saveFile]);
}

export function useEnvFiles() {
  const wsManager = getWebSocketManager();
  const [connected, setConnected] = useState(wsManager.isConnected());
  const [files, setFiles] = useState<Array<{ name: string; exists: boolean }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => wsManager.onConnectionChange(setConnected), [wsManager]);

  const listFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await wsManager.getEnvList();
      setFiles(result.files);
      return result.files;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      throw e;
    } finally {
      setLoading(false);
    }
  }, [wsManager]);

  const getFile = useCallback(
    async (filename: string) => {
      const result = await wsManager.getEnvFile(filename);
      return result.content;
    },
    [wsManager],
  );

  const saveFile = useCallback(
    async (filename: string, content: string) => wsManager.saveEnvFile(filename, content),
    [wsManager],
  );

  useEffect(() => {
    if (connected && files.length === 0 && !loading) listFiles().catch(() => {});
  }, [connected, files.length, loading, listFiles]);

  return useMemo(
    () => ({ files, loading, error, listFiles, getFile, saveFile }),
    [files, loading, error, listFiles, getFile, saveFile],
  );
}

export function useDatabase() {
  const wsManager = getWebSocketManager();
  const [connected, setConnected] = useState(wsManager.isConnected());
  const [info, setInfo] = useState<import("./types").DatabaseInfo | null>(null);
  const [tables, setTables] = useState<import("./types").TableInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => wsManager.onConnectionChange(setConnected), [wsManager]);

  const loadInfo = useCallback(async () => {
    setLoading(true);
    try {
      const result = await wsManager.getDbInfo();
      setInfo(result);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      throw e;
    } finally {
      setLoading(false);
    }
  }, [wsManager]);

  const loadTables = useCallback(async () => {
    setLoading(true);
    try {
      const result = await wsManager.getDbTables();
      setTables(result.tables);
      return result.tables;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      throw e;
    } finally {
      setLoading(false);
    }
  }, [wsManager]);

  const select = useCallback(async (table: string, page?: number, pageSize?: number, where?: unknown) => wsManager.dbSelect(table, page, pageSize, where), [wsManager]);
  const insert = useCallback(async (table: string, row: unknown) => wsManager.dbInsert(table, row), [wsManager]);
  const update = useCallback(async (table: string, row: unknown, where: unknown) => wsManager.dbUpdate(table, row, where), [wsManager]);
  const remove = useCallback(async (table: string, where: unknown) => wsManager.dbDelete(table, where), [wsManager]);
  const dropTable = useCallback(async (table: string) => { const r = await wsManager.dbDropTable(table); await loadTables(); return r; }, [wsManager, loadTables]);
  const kvGet = useCallback(async (table: string, key: string) => wsManager.kvGet(table, key), [wsManager]);
  const kvSet = useCallback(async (table: string, key: string, value: unknown, ttl?: number) => wsManager.kvSet(table, key, value, ttl), [wsManager]);
  const kvDelete = useCallback(async (table: string, key: string) => wsManager.kvDelete(table, key), [wsManager]);
  const kvEntries = useCallback(async (table: string) => wsManager.kvGetEntries(table), [wsManager]);

  useEffect(() => {
    if (connected && !info && !loading) {
      loadInfo().catch(() => {});
      loadTables().catch(() => {});
    }
  }, [connected, info, loading, loadInfo, loadTables]);

  return useMemo(
    () => ({ info, tables, loading, error, loadInfo, loadTables, dropTable, select, insert, update, remove, kvGet, kvSet, kvDelete, kvEntries }),
    [info, tables, loading, error, loadInfo, loadTables, dropTable, select, insert, update, remove, kvGet, kvSet, kvDelete, kvEntries],
  );
}
