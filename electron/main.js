// 轻舟 · Electron 主进程
// 职责：窗口立即显示（快启）→ 并行拉起 FastAPI 本地守护进程 → 就绪后刷新页面
// 容错：后端异常退出时自动重启（最多 3 次）并刷新窗口
const { app, BrowserWindow, shell, screen, dialog, ipcMain, clipboard, nativeImage } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const APP_DIR = path.join(PROJECT_ROOT, "app");
const DIST = path.join(APP_DIR, "dist", "index.html");
const PORT = 8000;
let backend = null;
let win = null;
let backendRestarts = 0;

function checkHealth(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const req = http.get({ host: "127.0.0.1", port: PORT, path: "/api/health", timeout: 1200 }, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(true);
        retry();
      });
      req.on("error", retry);
      req.on("timeout", () => { req.destroy(); retry(); });
    };
    const retry = () => (Date.now() < deadline ? setTimeout(tick, 700) : reject(new Error("后端服务启动超时")));
    tick();
  });
}

// ---------------- 前端加载：源码比 dist 新，就自动重新构建 ----------------
// Electron 加载的是 app/dist/index.html（构建产物），只改源码是不会变的。
// 所以每次启动比对一次时间戳：源码更新过就在后台跑一次 npm run build，构建完自动刷新窗口。
// 这样从桌面双击打开的，永远是当前这份源码。
// 想跳过构建（只想快点开）：设置环境变量 AIBO_SKIP_BUILD=1。

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".vite"]);
const SKIP_FILES = new Set(["tsconfig.tsbuildinfo"]);   // 构建自己产生的，不能算「源码更新」

function newestSourceMtime() {
  let max = 0;
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name) || SKIP_FILES.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      try {
        const m = fs.statSync(p).mtimeMs;
        if (m > max) max = m;
      } catch { /* 读不到就跳过 */ }
    }
  };
  walk(APP_DIR);
  return max;
}

function distIsStale() {
  try {
    return newestSourceMtime() > fs.statSync(DIST).mtimeMs;
  } catch {
    return true;   // dist 不存在，必须构建
  }
}

function resolveNodeExecutable() {
  if (process.env.LIGHTBOAT_NODE && fs.existsSync(process.env.LIGHTBOAT_NODE)) return process.env.LIGHTBOAT_NODE;
  return "node";
}

function buildFrontend() {
  return new Promise((resolve) => {
    let p;
    try {
      p = spawn(resolveNodeExecutable(), [path.join(APP_DIR, "node_modules", "vite", "bin", "vite.js"), "build"], {
        cwd: APP_DIR, stdio: "ignore", windowsHide: true,
      });
    } catch {
      return resolve(false);
    }
    const timer = setTimeout(() => {
      try {
        spawn("taskkill", ["/pid", String(p.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
      } catch { /* ignore */ }
      resolve(false);
    }, 180000);
    p.on("exit", (code) => { clearTimeout(timer); resolve(code === 0); });
    p.on("error", () => { clearTimeout(timer); resolve(false); });
  });
}
async function bootFrontend() {
  if (!win || win.isDestroyed()) return;
  if (process.env.AIBO_SKIP_BUILD === "1" || !distIsStale()) {
    win.loadFile(DIST);
    return;
  }
  console.log("[轻舟] 检测到源码更新，正在后台重新构建前端…");
  if (fs.existsSync(DIST)) win.loadFile(DIST);   // 先显示上一版，别对着黑屏干等
  const ok = await buildFrontend();
  if (!ok) {
    console.warn("[轻舟] 前端构建失败，继续使用上一次的产物（手动跑 npm run build:app 可看报错）");
    return;
  }
  if (win && !win.isDestroyed()) win.webContents.reload();
}

function showBackendError() {
  if (!win || win.isDestroyed()) return;
  const html = [
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">',
    "<style>",
    'body{margin:0;font-family:"Microsoft YaHei",sans-serif;background:#f7f7fb;color:#333;}',
    ".wrap{display:flex;align-items:center;justify-content:center;height:100vh}",
    ".box{text-align:center;padding:40px;max-width:560px}",
    ".mark{font-size:44px;color:#c0392b;margin-bottom:16px}",
    "h1{font-size:22px;margin:0 0 14px}",
    "p{color:#666;line-height:1.9;font-size:14px;margin:0}",
    "</style></head><body><div class='wrap'><div class='box'>",
    "<div class='mark'>⚠</div>",
    "<h1>轻舟后端服务已停止</h1>",
    "<p>服务连续重启失败，可能是程序文件损坏、端口 8000 被占用，或 Python 运行环境异常。<br>",
    "请先按 README 完成 Python 虚拟环境与依赖安装；从终端启动轻舟可查看错误信息。</p>",
    "</div></div></body></html>",
  ].join("");
  win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
}

function startBackend() {
  const venvPython = path.join(PROJECT_ROOT, ".venv", "Scripts", "python.exe");
  const pythonExe = process.env.LIGHTBOAT_PYTHON ||
    (fs.existsSync(venvPython) ? venvPython : "python");
  backend = spawn(pythonExe, ["-m", "server.app.main"], {
    cwd: PROJECT_ROOT,
    env: { ...process.env },
    stdio: "inherit",
    windowsHide: true,
  });
  backend.on("error", (err) => {
    console.error("[轻舟] Python 启动失败:", err.message);
    showBackendError();
  });
  backend.on("exit", (code) => {
    if (code && code !== 0) {
      // 后端异常退出：自动重启（最多 3 次，退避），就绪后刷新窗口
      if (backendRestarts < 3) {
        backendRestarts++;
        console.warn(`[轻舟] 后端进程退出 code=${code}，${backendRestarts}/3 次重启...`);
        setTimeout(() => {
          (async () => {
            try {
              await checkHealth(600);
            } catch {
              startBackend();
              try {
                await checkHealth(12000);
                if (win && !win.isDestroyed()) win.webContents.reload();
                backendRestarts = 0;
              } catch (e) {
                console.error("[轻舟] 后端重启失败:", e.message);
              }
            }
          })();
        }, 1200 * backendRestarts);
      } else {
        console.error("[轻舟] 后端连续重启失败，显示错误页");
        showBackendError();
      }
    }
  });
}

function createWindow() {
  // 窗口位置：主屏居中（避免多显示器残留位置导致窗口落在屏幕外）
  const { workArea } = screen.getPrimaryDisplay();
  const W = 1320, H = 860;
  const x = workArea.x + Math.round((workArea.width - W) / 2);
  const y = workArea.y + Math.round((workArea.height - H) / 2);
  win = new BrowserWindow({
    width: W,
    height: H,
    x: Math.max(x, workArea.x),
    y: Math.max(y, workArea.y),
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: "#f7f7fb",
    frame: false,
    title: "",
    icon: path.join(__dirname, "..", "app", "public", "icon-circle.ico"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  bootFrontend();
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

// 并行确保后端就绪：窗口已先显示，后端就绪后刷新页面（前端轮询也会自动感知）
async function ensureBackend() {
  try {
    await checkHealth(800);
    return; // 已有后端在运行
  } catch {
    startBackend();
  }
  try {
    await checkHealth(15000);
    if (win && !win.isDestroyed()) {
      win.webContents.reload();
    }
  } catch (e) {
    console.error("[轻舟] 后端未就绪:", e.message);
  }
}

app.whenReady().then(() => {
  ipcMain.handle("aibo:save-text-as", async (_evt, opts = {}) => {
    if (typeof opts.content !== "string" || !opts.content.trim()) throw new Error("内容为空，无法保存");
    const r = await dialog.showSaveDialog(win, {
      title: "另存为生成材料", defaultPath: path.basename(String(opts.filename || "材料.md")),
      filters: [{ name: "Markdown / 文本", extensions: ["md", "txt"] }],
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    await fs.promises.writeFile(r.filePath, opts.content, "utf-8");
    return { canceled: false, path: r.filePath };
  });
  // 另存为对话框：主控台「另存为」用系统原生保存框选任意路径
  ipcMain.handle("aibo:save-dialog", async (_evt, opts = {}) => {
    const r = await dialog.showSaveDialog(win, {
      title: opts.title || "另存为生成材料",
      defaultPath: opts.defaultPath || path.join(PROJECT_ROOT, "data", "workspace", "material.md"),
      filters: [{ name: "Markdown / 文本", extensions: ["md", "mdx", "txt"] }],
    });
    return r.canceled ? { canceled: true } : { canceled: false, filePath: r.filePath };
  });
  // 复制对话内容到剪贴板
  ipcMain.handle("aibo:clipboard", (_evt, text) => {
    clipboard.writeText(String(text ?? ""));
    return true;
  });
  // 打开项目文件夹（过往项目「打开文件夹」）
  ipcMain.handle("aibo:open-folder", async (_evt, folderPath) => {
    const p = String(folderPath ?? "");
    if (!p) return { ok: false, error: "文件夹路径为空" };
    const err = await shell.openPath(p);
    return err ? { ok: false, error: err } : { ok: true };
  });
  // 打开任意路径（文件/文件夹，项目文件面板用）
  ipcMain.handle("aibo:open-path", async (_evt, p) => {
    const err = await shell.openPath(String(p ?? ""));
    return err ? { ok: false, error: err } : { ok: true };
  });
  // 文件另存为：把项目文件复制到用户选择的路径（右键另存为）
  ipcMain.handle("aibo:save-file-copy", async (_evt, payload = {}) => {
    try {
      const { src, dest } = payload;
      if (!src || !dest) return { ok: false, error: "路径缺失" };
      fs.copyFileSync(String(src), String(dest));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String((e && e.message) ? e.message : e) };
    }
  });
  // 本地访问令牌：后端生成后经此通道注入前端（每次请求附加 X-Aibo-Token）
  ipcMain.handle("aibo:get-token", () => {
    try {
      return fs.readFileSync(path.join(PROJECT_ROOT, "data", ".aibo_token"), "utf-8").trim();
    } catch {
      return "";
    }
  });
  ipcMain.on("aibo:win-min", () => win && win.minimize());
  ipcMain.on("aibo:win-max", () => { if (!win) return; win.isMaximized() ? win.unmaximize() : win.maximize(); });
  ipcMain.on("aibo:win-close", () => win && win.close());

  createWindow();   // 窗口立即出现，不等后端
  ensureBackend();  // 后端并行启动
});

app.on("window-all-closed", () => {
  const finish = () => { if (backend) backend.kill(); app.quit(); };
  try {
    const token = fs.readFileSync(path.join(PROJECT_ROOT, "data", ".aibo_token"), "utf-8").trim();
    const req = http.request({ host: "127.0.0.1", port: PORT, path: "/api/shutdown", method: "POST", headers: { "x-aibo-token": token } }, res => { res.resume(); finish(); });
    req.on("error", finish);
    req.setTimeout(1200, () => { req.destroy(); finish(); });
    req.end();
  } catch { finish(); }
});
