/**
 * IPC/RPC 客户端 — 与 icqq 守护进程通信 (ported from @icqqjs/cli v1.4.4)
 *
 * IPC 模式（本地 Unix Socket）：
 *   const client = await IpcClient.connect(uin);
 *
 * RPC 模式（远程 TCP）：
 *   const client = await IpcClient.connectRpc({ host, port, token });
 *
 * 通信协议：JSON + 换行符。
 * IPC 连接使用 Token 直传认证；RPC 使用 HMAC-SHA256 挑战-响应认证。
 */
import net from "node:net";
import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type {
  IpcRequest,
  IpcResponse,
  IpcEvent,
  IpcMessage,
} from "./protocol.js";

function getIcqqHome(): string {
  return path.join(os.homedir(), ".icqq");
}

function getSocketPath(uin: number): string {
  return path.join(getIcqqHome(), String(uin), "daemon.sock");
}

function getTokenPath(uin: number): string {
  return path.join(getIcqqHome(), String(uin), "daemon.token");
}

function getRpcPortPath(uin: number): string {
  return path.join(getIcqqHome(), String(uin), "daemon.rpc");
}

export class IpcClient {
  private socket: net.Socket;
  private buffer = "";
  private pending = new Map<
    string,
    { resolve: (v: IpcResponse) => void; reject: (e: Error) => void }
  >();
  private eventHandlers = new Map<string, (event: IpcEvent) => void>();
  private _closed = false;

  private constructor(socket: net.Socket, skipDataHandler = false) {
    this.socket = socket;
    if (!skipDataHandler) {
      this.attachDataHandler();
    }
    this.socket.on("error", (err) => {
      for (const { reject } of this.pending.values()) {
        reject(err);
      }
      this.pending.clear();
    });
    this.socket.on("close", () => {
      this._closed = true;
      for (const { reject } of this.pending.values()) {
        reject(new Error("连接已关闭"));
      }
      this.pending.clear();
    });
  }

  get closed(): boolean {
    return this._closed;
  }

  /** 注册数据处理 handler（RPC 模式延迟到 challenge 完成后调用） */
  private attachDataHandler() {
    this.socket.on("data", (chunk) => this.onData(chunk.toString()));
  }

  /**
   * 通过 IPC（Unix Socket）连接守护进程并完成认证。
   * @param uin - 目标账号的 QQ 号
   * @returns 已认证的 IpcClient 实例
   * @throws 守护进程未运行或认证失败时抛出错误
   */
  static async connect(uin: number): Promise<IpcClient> {
    let token: string;
    try {
      token = (await readFile(getTokenPath(uin), "utf-8")).trim();
    } catch {
      throw new Error(
        `无法读取认证 token，icqq 守护进程可能未运行。请先执行: icqq login`,
      );
    }

    const client = await new Promise<IpcClient>((resolve, reject) => {
      const sock = net.connect(getSocketPath(uin));
      sock.on("connect", () => resolve(new IpcClient(sock)));
      sock.on("error", (err) =>
        reject(
          new Error(
            `无法连接 icqq 守护进程 (${getSocketPath(uin)}): ${err.message}。请先执行: icqq login`,
          ),
        ),
      );
    });

    const authResp = await client.request("auth", { token });
    if (!authResp.ok) {
      client.close();
      throw new Error("IPC 认证失败");
    }
    return client;
  }

  /**
   * 通过 RPC（TCP）连接守护进程并完成 HMAC 挑战-响应认证。
   *
   * 流程：
   *   1. 服务端连接后发送 { challenge: "<hex>" }
   *   2. 客户端用 HMAC-SHA256(token, challenge) 生成 digest
   *   3. 客户端发送 { action: "auth", params: { digest: "<hex>" } }
   *   4. 服务端验证 digest，通过则认证成功
   *
   * token 不会明文传输，防止中间人嗅探。
   *
   * @param options.host - 远程主机地址
   * @param options.port - 远程端口
   * @param options.token - 认证 token（用于 HMAC 计算，不会明文传输）
   */
  static async connectRpc(options: {
    host: string;
    port: number;
    token: string;
  }): Promise<IpcClient> {
    const { host, port, token } = options;

    const client = await new Promise<IpcClient>((resolve, reject) => {
      const sock = net.connect(port, host);
      // skipDataHandler=true: 延迟注册 onData，避免与 challenge 读取冲突
      sock.on("connect", () => resolve(new IpcClient(sock, true)));
      sock.on("error", (err) =>
        reject(
          new Error(`无法连接 icqq RPC 服务 (${host}:${port}): ${err.message}`),
        ),
      );
    });

    // Wait for challenge from server, with proper buffering for TCP fragmentation
    const challenge = await new Promise<string>((resolve, reject) => {
      let challengeBuffer = "";
      const timeout = setTimeout(() => {
        client.socket.removeListener("data", onData);
        client.close();
        reject(new Error("RPC 挑战超时"));
      }, 10000);

      const onData = (chunk: Buffer) => {
        challengeBuffer += chunk.toString();
        const nlIdx = challengeBuffer.indexOf("\n");
        if (nlIdx === -1) return; // 等待更多数据

        clearTimeout(timeout);
        client.socket.removeListener("data", onData);

        try {
          const msg = JSON.parse(challengeBuffer.slice(0, nlIdx)) as {
            challenge?: string;
          };
          if (!msg.challenge) {
            reject(new Error("RPC 服务端未发送挑战"));
            return;
          }
          resolve(msg.challenge);
        } catch {
          reject(new Error("RPC 挑战解析失败"));
        }
      };
      client.socket.on("data", onData);
    });

    // Challenge 阶段结束，注册正式的数据处理 handler
    client.attachDataHandler();

    // Compute HMAC digest and authenticate
    const digest = createHmac("sha256", token)
      .update(challenge)
      .digest("hex");
    const authResp = await client.request("auth", { digest });
    if (!authResp.ok) {
      client.close();
      throw new Error(authResp.error ?? "RPC 认证失败");
    }
    return client;
  }

  /**
   * 通过 RPC 连接守护进程（自动从 daemon.rpc 文件读取地址）。
   * @param uin - 目标账号的 QQ 号
   */
  static async connectRpcByUin(uin: number): Promise<IpcClient> {
    let token: string;
    try {
      token = (await readFile(getTokenPath(uin), "utf-8")).trim();
    } catch {
      throw new Error("无法读取认证 token，守护进程可能未运行");
    }

    let rpcInfo: { host: string; port: number };
    try {
      const raw = await readFile(getRpcPortPath(uin), "utf-8");
      rpcInfo = JSON.parse(raw);
    } catch {
      throw new Error("RPC 未启用或守护进程未运行");
    }

    return IpcClient.connectRpc({
      host: rpcInfo.host,
      port: rpcInfo.port,
      token,
    });
  }

  private onData(data: string) {
    this.buffer += data;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop()!;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as IpcMessage;
        if ("event" in msg) {
          const handler = this.eventHandlers.get(msg.id);
          handler?.(msg as IpcEvent);
        } else {
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            p.resolve(msg as IpcResponse);
          }
        }
      } catch {
        // ignore malformed JSON
      }
    }
  }

  /**
   * 发送 IPC 请求并等待响应。
   */
  async request(
    action: string,
    params: Record<string, unknown> = {},
    timeoutMs = 30000,
  ): Promise<IpcResponse> {
    if (this._closed) throw new Error("IPC 连接已关闭");
    const id = randomUUID();
    const req: IpcRequest = { id, action, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`IPC 请求超时 (${timeoutMs}ms): ${action}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.socket.write(JSON.stringify(req) + "\n", (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  /**
   * 订阅消息推送。
   * @returns 订阅句柄，包含 unsubscribe() 方法
   */
  subscribe(
    action: string,
    params: Record<string, unknown>,
    onEvent: (event: IpcEvent) => void,
  ): { id: string; unsubscribe: () => Promise<void> } {
    const id = randomUUID();
    this.eventHandlers.set(id, onEvent);
    const req: IpcRequest = { id, action, params };
    this.socket.write(JSON.stringify(req) + "\n");

    return {
      id,
      unsubscribe: async () => {
        this.eventHandlers.delete(id);
        if (!this._closed) {
          const unsub: IpcRequest = {
            id: randomUUID(),
            action: "unsubscribe",
            params,
          };
          this.socket.write(JSON.stringify(unsub) + "\n");
        }
      },
    };
  }

  /** 关闭连接 */
  close() {
    this._closed = true;
    this.eventHandlers.clear();
    for (const { reject } of this.pending.values()) {
      reject(new Error("连接已关闭"));
    }
    this.pending.clear();
    this.socket.destroy();
  }
}
