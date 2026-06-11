/**
 * Demo Console bootstrap: pre-fill API base + demo token, load Sandbox entry from Host.
 * Build: set VITE_API_BASE / VITE_API_TOKEN (see .env.example).
 */

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8086";
const API_TOKEN = import.meta.env.VITE_API_TOKEN ?? "demo-public-token-change-me";

localStorage.setItem("zhin_api_base", API_BASE.replace(/\/$/, ""));
localStorage.setItem("zhin_api_token", API_TOKEN);

const status = document.getElementById("status");
const main = document.getElementById("main");

async function loadSandbox() {
  try {
    const entriesRes = await fetch(`${API_BASE.replace(/\/$/, "")}/entries`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    if (!entriesRes.ok) throw new Error(`entries ${entriesRes.status}`);
    const { entries } = await entriesRes.json();
    const sandbox = entries?.find((e) => e.path?.includes("sandbox") || e.id === "sandbox");
    if (!sandbox?.url) {
      status.textContent = "已连接 Host。请使用完整 Console 打开沙盒，或访问文档本地首跑。";
      status.innerHTML += ` <a href="https://console.zhin.dev/?apiBaseUrl=${encodeURIComponent(API_BASE)}">打开 Remote Console</a>`;
      return;
    }
    status.textContent = "Sandbox 已加载";
    const iframe = document.createElement("iframe");
    iframe.src = sandbox.url.startsWith("http") ? sandbox.url : `${API_BASE.replace(/\/$/, "")}${sandbox.url}`;
    iframe.title = "Zhin Sandbox";
    main.appendChild(iframe);
  } catch (err) {
    status.textContent = `连接失败: ${err instanceof Error ? err.message : String(err)}`;
  }
}

loadSandbox();
