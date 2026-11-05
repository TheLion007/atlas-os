"use strict";

/**
 * Atlas OS, desktop shell. The main process does four things:
 *   1. makes sure only one copy runs;
 *   2. starts the built Atlas OS server (the same code as the web build) on this PC only
 *      (127.0.0.1, a free port, a secret known to the window alone), with its data in the
 *      user's AppData folder;
 *   3. opens a window on it, and keeps the window from reaching anything but that server;
 *   4. hands links to the system browser.
 * Nothing is ever sent over the internet by the app itself.
 */

const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  nativeTheme,
  session,
  shell,
} = require("electron");
const { fork } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { buildMenu } = require("./menu.cjs");
const { setupAutoUpdate, isUpdateRequest } = require("./updater.cjs");

const PRODUCT = "Atlas OS";
const REPO_URL = "https://github.com/TheLion007/atlas-os";
const TOKEN_HEADER = "x-atlas-token";

const packaged = app.isPackaged;
/** Development: `npm run electron:dev` starts `next dev` and tells us where it listens. */
const devUrl = !packaged ? process.env.ATLAS_DEV_URL || null : null;
const smokeArg = process.argv.find((a) => a.startsWith("--smoke-test="));
const smokeFile = smokeArg ? smokeArg.slice("--smoke-test=".length) : null;

// One folder per user for everything the app keeps: %APPDATA%\Atlas OS on Windows. It survives
// updates and reinstalls (the installer never touches it). ATLAS_USER_DATA_DIR is for tests.
app.setName(PRODUCT);
const userData = process.env.ATLAS_USER_DATA_DIR || path.join(app.getPath("appData"), PRODUCT);
app.setPath("userData", userData);
const dataDir = path.join(userData, "data", "atlas-pgdata");
const logDir = path.join(userData, "logs");

let win = null;
let server = null;
let origin = null;
let token = null;
let quitting = false;
let logStream = null;

function log(line) {
  const text = `[${new Date().toISOString()}] ${line}\n`;
  try {
    if (!logStream) {
      fs.mkdirSync(logDir, { recursive: true });
      logStream = fs.createWriteStream(path.join(logDir, "atlas-os.log"), { flags: "a" });
    }
    logStream.write(text);
  } catch {
    /* logging must never break the app */
  }
  if (!packaged) process.stdout.write(text);
}

const isLocalHost = (hostname) => ["127.0.0.1", "localhost", "[::1]", "::1"].includes(hostname);

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(`${url}/api/health`, { timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on("error", retry);
      req.on("timeout", () => req.destroy());
    };
    const retry = () => {
      if (!server && !devUrl)
        return reject(new Error("The Atlas OS server stopped while starting."));
      if (Date.now() > deadline)
        return reject(new Error("The Atlas OS server did not start in time."));
      setTimeout(attempt, 250);
    };
    attempt();
  });
}

/** Starts the built server as a child process (this same executable, running as plain Node). */
async function startServer() {
  const root = path.join(process.resourcesPath, "server");
  const entry = path.join(root, "server.js");
  if (!fs.existsSync(entry)) throw new Error(`The Atlas OS server is missing (${entry}).`);
  fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  const port = await freePort();
  token = crypto.randomBytes(24).toString("hex");
  origin = `http://127.0.0.1:${port}`;
  server = fork(entry, [], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      ATLAS_DB_DIR: dataDir,
      ATLAS_MIGRATIONS_DIR: path.join(process.resourcesPath, "db", "migrations"),
      ATLAS_DESKTOP_TOKEN: token,
      NEXT_PUBLIC_ATLAS_FIXTURES: "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  server.stdout.on("data", (d) => log(`server: ${String(d).trimEnd()}`));
  server.stderr.on("data", (d) => log(`server! ${String(d).trimEnd()}`));
  server.once("exit", (code, signal) => {
    log(`server exited (code ${code}, signal ${signal})`);
    server = null;
    if (!quitting) {
      dialog.showErrorBox(
        PRODUCT,
        "Le moteur local d’Atlas OS s’est arrêté de façon inattendue. L’application va se fermer ; tes données sont intactes. Relance-la.",
      );
      app.quit();
    }
  });
  await waitForServer(origin, 60_000);
  log(`server ready on ${origin}`);
}

/**
 * The window may only talk to this PC: no request from a page may leave for the internet. The one
 * exception is the update check, made by the app itself (never by a page) to GitHub's release
 * hosts over https: see `isUpdateRequest` in updater.cjs.
 */
function lockDownSession() {
  const ses = session.defaultSession;
  ses.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (details, cb) => {
      const allowed = isUpdateRequest(details, isLocalHost);
      if (!allowed) log(`blocked: ${details.url}`);
      cb({ cancel: !allowed });
    },
  );
  if (token && origin) {
    ses.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, cb) => {
      cb({ requestHeaders: { ...details.requestHeaders, [TOKEN_HEADER]: token } });
    });
  }
  ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
}

function openExternal(url) {
  try {
    const u = new URL(url);
    // Only ordinary web pages (the Ollama download page, the project's issues): never a program.
    if (u.protocol === "https:" || u.protocol === "http:") void shell.openExternal(u.toString());
  } catch {
    /* not a URL */
  }
}

function createWindow(url) {
  nativeTheme.themeSource = "system";
  win = new BrowserWindow({
    title: PRODUCT,
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#121419" : "#f4f6fa",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The developer tools exist only when developing.
      devTools: !packaged,
      spellcheck: false,
    },
  });
  win.once("ready-to-show", () => win && win.show());
  // The page sets its own title per screen; the window keeps the product name.
  win.on("page-title-updated", (e) => e.preventDefault());

  const here = new URL(url).origin;
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, target) => {
    if (new URL(target).origin !== here) {
      e.preventDefault();
      openExternal(target);
    }
  });
  win.on("closed", () => {
    win = null;
  });
  void win.loadURL(url);
  return win;
}

/** `--smoke-test=<file>`: open the app, check the essentials from inside the window, write the result, quit. */
async function runSmokeTest(window) {
  const out = { ok: false, packaged, dataDir, origin };
  try {
    await new Promise((resolve) => window.webContents.once("did-finish-load", resolve));
    await new Promise((r) => setTimeout(r, 2500));
    out.title = window.getTitle();
    out.bounds = window.getBounds();
    out.page = await window.webContents.executeJavaScript(`(async () => {
      const j = async (u, i) => { try { const r = await fetch(u, i); return { status: r.status, body: await r.json().catch(() => null) }; } catch (e) { return { error: String(e) }; } };
      const desktop = window.atlasDesktop ? await window.atlasDesktop.getInfo() : null;
      const graph = await j('/api/graph');
      const ollama = await j('/api/ollama/status');
      let external = null;
      try { await fetch('https://example.com/', { mode: 'no-cors' }); external = 'reached'; } catch (e) { external = 'blocked'; }
      return { href: location.href, heading: (document.querySelector('h1')||{}).textContent || null, desktop, graph: graph.body ? { nodes: graph.body.nodes.length } : graph, ollama: ollama.body ? { reachable: ollama.body.reachable, models: (ollama.body.models||[]).length } : ollama, external };
    })()`);
    if (process.env.ATLAS_SMOKE_CREATE) {
      out.create = await window.webContents.executeJavaScript(`(async () => {
        const r = await fetch('/api/objects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'project', title: ${JSON.stringify(process.env.ATLAS_SMOKE_CREATE)}, status: 'active', tags: [], confidence: null, details: { description: '' }, relations: [] }) });
        return { status: r.status };
      })()`);
    }
    if (process.env.ATLAS_SMOKE_DELETE) {
      await require("./smoke-delete.cjs")(window, origin, out, process.env.ATLAS_SMOKE_SHOTS);
    } else if (process.env.ATLAS_SMOKE_UPDATE) {
      await require("./smoke-update.cjs")(window, out, process.env.ATLAS_SMOKE_SHOTS, () =>
        fs.writeFileSync(smokeFile, JSON.stringify(out, null, 2)),
      );
    } else if (process.env.ATLAS_SMOKE_README_SEED) {
      await require("./smoke-shots.cjs")(window, origin, out, process.env.ATLAS_SMOKE_SHOTS);
    } else if (process.env.ATLAS_SMOKE_ASSISTANT) {
      await require("./smoke-assistant.cjs")(window, origin, out, process.env.ATLAS_SMOKE_SHOTS);
    } else if (process.env.ATLAS_SMOKE_SHOTS) {
      // Pictures of what the window really shows, to look at the packaged app without a person.
      const dir = process.env.ATLAS_SMOKE_SHOTS;
      fs.mkdirSync(dir, { recursive: true });
      const shot = async (name) => {
        const image = await window.webContents.capturePage();
        fs.writeFileSync(path.join(dir, `${name}.png`), image.toPNG());
      };
      await shot("home");
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: "J", modifiers: ["control"] });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: "J", modifiers: ["control"] });
      await new Promise((r) => setTimeout(r, 3500));
      await shot("assistant");
      out.assistantText = await window.webContents.executeJavaScript(
        "document.body.innerText.slice(0, 600)",
      );
      await window.webContents.loadURL(`${origin}/settings`);
      await new Promise((r) => setTimeout(r, 3500));
      await window.webContents.executeJavaScript(
        "document.getElementById('st-ai')?.scrollIntoView()",
      );
      await new Promise((r) => setTimeout(r, 800));
      await shot("settings-ai");
      await window.webContents.executeJavaScript(
        "document.getElementById('st-backup')?.scrollIntoView()",
      );
      await new Promise((r) => setTimeout(r, 800));
      await shot("settings-backup");
    }
    out.ok = true;
  } catch (e) {
    out.error = String(e && e.stack ? e.stack : e);
  }
  fs.writeFileSync(smokeFile, JSON.stringify(out, null, 2));
  quitting = true;
  app.quit();
}

function aboutText() {
  return `${PRODUCT} ${app.getVersion()}\n\nTes données sont enregistrées ici, uniquement sur ce PC :\n${userData}`;
}

async function boot() {
  Menu.setApplicationMenu(
    buildMenu({
      app,
      packaged,
      repoUrl: REPO_URL,
      openExternal,
      showAbout: () =>
        dialog.showMessageBox({
          type: "info",
          title: PRODUCT,
          message: `${PRODUCT} ${app.getVersion()}`,
          detail: aboutText(),
        }),
      openDataFolder: () => shell.openPath(userData),
    }),
  );

  let url;
  if (devUrl) {
    url = devUrl;
    origin = new URL(devUrl).origin;
    token = null;
  } else {
    await startServer();
    url = origin;
  }
  lockDownSession();
  const window = createWindow(url);
  setupAutoUpdate({ app, getWindow: () => win, ipcMain, userData, log });
  if (smokeFile) void runSmokeTest(window);
}

// ----- what the page may ask of the app ---------------------------------------------------------
ipcMain.handle("atlas:info", () => ({
  version: app.getVersion(),
  platform: process.platform,
  dataDir: userData,
  databaseDir: dataDir,
  packaged,
}));
ipcMain.handle("atlas:open-data-folder", () => shell.openPath(userData));

// ----- life cycle -------------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app
    .whenReady()
    .then(boot)
    .catch((e) => {
      log(`startup failed: ${e && e.stack ? e.stack : e}`);
      dialog.showErrorBox(
        PRODUCT,
        `Atlas OS n’a pas pu démarrer.\n\n${e && e.message ? e.message : e}\n\nLe détail est dans ${path.join(logDir, "atlas-os.log")}.`,
      );
      quitting = true;
      app.quit();
    });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    quitting = true;
    if (server) {
      try {
        server.kill();
      } catch {
        /* already gone */
      }
    }
  });
}
