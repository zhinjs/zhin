/**
 * demo.zhin.dev bootstrap: pre-fill demo-api + scoped token, load Sandbox, first-visit onboarding.
 * Build: VITE_API_BASE / VITE_API_TOKEN (see .env.example).
 */

const ONBOARDING_KEY = "zhin_demo_onboarding_done";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8086";
const API_TOKEN = import.meta.env.VITE_API_TOKEN ?? "demo-public-token-change-me";

localStorage.setItem("zhin_api_base", API_BASE.replace(/\/$/, ""));
localStorage.setItem("zhin_api_token", API_TOKEN);

const status = document.getElementById("status");
const main = document.getElementById("main");
const overlay = document.getElementById("demo-onboarding");
const stepLabel = document.getElementById("onboard-step-label");
const onboardTitle = document.getElementById("onboard-title");
const onboardBody = document.getElementById("onboard-body");
const onboardNav = document.getElementById("onboard-nav");
const helpBtn = document.getElementById("help-btn");

const STEPS = [
  {
    title: "零安装体验 Zhin",
    html: `<p>你已连接到官方托管 Sandbox（<code>demo-api.zhin.dev</code>），无需 API Base / Token，直接在下方的聊天窗口试 Bot。</p>
<p><strong>QQ 群助手 + 可选 @AI</strong> — 先在 Demo 里玩通，再部署到本机或接 QQ。</p>`,
  },
  {
    title: "试试 hello 与 card",
    html: `<p>在下方 Sandbox 输入框依次发送：</p>
<ul>
<li><code>hello</code> — 命令 Bot 回复（含 card / ai 引导）</li>
<li><code>card</code> — JSX 状态卡片示例</li>
<li><code>ai: 你好</code> — 体验 Agent 对话（Demo 已启用 Ollama）</li>
</ul>`,
  },
  {
    title: "下一步（任选）",
    html: `<p>Demo 只是调试台。接群、写插件、长期运行请选一条路径：</p>
<div class="onboard-ctas">
<a class="primary" href="https://zhin.js.org/getting-started/first-run" target="_blank" rel="noopener">部署到本机 · npm create zhin-app</a>
<a class="secondary" href="https://zhin.js.org/adapters/icqq" target="_blank" rel="noopener">接 QQ Bot · ICQQ 适配器</a>
</div>`,
  },
];

let step = 0;

function isOnboardingDone() {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === "1";
  } catch {
    return false;
  }
}

function setOnboardingDone() {
  try {
    localStorage.setItem(ONBOARDING_KEY, "1");
  } catch {
    /* ignore */
  }
}

function renderOnboarding() {
  const current = STEPS[step];
  stepLabel.textContent = `${step + 1} / ${STEPS.length}`;
  onboardTitle.textContent = current.title;
  onboardBody.innerHTML = current.html;
  onboardNav.innerHTML = "";

  if (step < STEPS.length - 1) {
    const next = document.createElement("button");
    next.type = "button";
    next.className = "primary";
    next.textContent = step === 0 ? "下一步" : "知道了，继续";
    next.addEventListener("click", () => {
      step += 1;
      renderOnboarding();
    });
    onboardNav.appendChild(next);
  } else {
    const done = document.createElement("button");
    done.type = "button";
    done.className = "primary";
    done.textContent = "开始体验";
    done.addEventListener("click", closeOnboarding);
    onboardNav.appendChild(done);
  }

  if (step > 0) {
    const back = document.createElement("button");
    back.type = "button";
    back.className = "ghost";
    back.textContent = "上一步";
    back.addEventListener("click", () => {
      step -= 1;
      renderOnboarding();
    });
    onboardNav.prepend(back);
  }

  if (step < STEPS.length - 1) {
    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "ghost";
    skip.textContent = "跳过";
    skip.addEventListener("click", closeOnboarding);
    onboardNav.appendChild(skip);
  }
}

function openOnboarding(fromHelp = false) {
  step = fromHelp ? 1 : 0;
  renderOnboarding();
  overlay.classList.add("open");
}

function closeOnboarding() {
  setOnboardingDone();
  overlay.classList.remove("open");
  helpBtn.hidden = false;
}

helpBtn.addEventListener("click", () => openOnboarding(true));

if (!isOnboardingDone()) {
  openOnboarding(false);
} else {
  helpBtn.hidden = false;
}

async function loadSandbox() {
  try {
    const base = API_BASE.replace(/\/$/, "");
    const entriesRes = await fetch(`${base}/entries`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    if (!entriesRes.ok) throw new Error(`entries ${entriesRes.status}`);
    const { entries } = await entriesRes.json();
    const sandbox = entries?.find(
      (e) => e.path?.includes("sandbox") || e.id === "sandbox",
    );
    if (!sandbox?.url) {
      status.textContent =
        "已连接 Host，但未找到 Sandbox Entry。请检查 demo-bot 是否启用 @zhin.js/adapter-sandbox。";
      return;
    }
    status.textContent = "Sandbox 已连接 — 发送 hello、card 或 ai: 你好";
    const iframe = document.createElement("iframe");
    iframe.src = sandbox.url.startsWith("http")
      ? sandbox.url
      : `${base}${sandbox.url}`;
    iframe.title = "Zhin Sandbox";
    main.appendChild(iframe);
  } catch (err) {
    status.textContent = `连接失败: ${err instanceof Error ? err.message : String(err)}`;
  }
}

loadSandbox();
