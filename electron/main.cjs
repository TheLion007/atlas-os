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
const os = require("node:os");
const location = require("./data-location.cjs");
const { createDeviceLock, HEARTBEAT_MS } = require("./device-lock.cjs");
const { applyPendingImport } = require("./pending-import.cjs");
const autoBackup = require("./auto-backup.cjs");
const prefsSync = require("./prefs-sync.cjs");

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
const logDir = path.join(userData, "logs");

// Where the data lives is the person's choice (location.json, kept on this device): the default
// is the user's AppData folder, but it can be any folder, a cloud-synced one included.
let roots = location.resolveRoots(userData, location.readConfig(userData));
let dataRoot = roots.dataRoot;
let dataDir = roots.dbDir;
/** The database the server actually opens: dataDir, or a private copy in read-only mode. */
let serverDbDir = dataDir;
let readOnly = false;
let deviceLock = null;
let heartbeat = null;
let importNotice = null;
const deviceName = process.env.ATLAS_DEVICE_NAME || os.hostname();
const lockToken = crypto.randomBytes(12).toString("hex");

/**
 * Questions put to the person in native dialogs (before or beside the window). Tests answer them
 * with ATLAS_TEST_ANSWERS="id=answer;id=answer", and give the file pickers' results the same way.
 */
const testAnswers = Object.fromEntries(
  (process.env.ATLAS_TEST_ANSWERS || "")
    .split(";")
    .filter(Boolean)
    .map((kv) => kv.split("=")),
);
async function choose(id, { type = "question", message, detail, options }) {
  if (testAnswers[id]) return testAnswers[id];
  const { response } = await dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, {
    type,
    title: PRODUCT,
    message,
    detail,
    buttons: options.map((o) => o.label),
    defaultId: 0,
    cancelId: options.length - 1,
    noLink: true,
  });
  return options[response].id;
}

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
  fs.mkdirSync(path.dirname(serverDbDir), { recursive: true });
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
      ATLAS_DB_DIR: serverDbDir,
      ATLAS_DATA_ROOT: dataRoot,
      // the process lock stays on this PC: a process id means nothing on another machine
      ATLAS_DB_LOCK: path.join(userData, "atlas-pgdata.lock"),
      ATLAS_DEVICE_NAME: deviceName,
      ATLAS_APP_VERSION: app.getVersion(),
      ATLAS_READONLY: readOnly ? "1" : "",
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
  return `${PRODUCT} ${app.getVersion()}\n\nTes données sont enregistrées ici, uniquement sur ce PC (ou dans le dossier que tu as choisi) :\n${dataRoot}`;
}

/** The data folder must be reachable and writable before anything is opened. */
async function ensureDataRoot() {
  for (;;) {
    const ok = location.checkWritable(dataRoot);
    if (ok.ok) return;
    log(`data folder not usable: ${dataRoot} (${ok.reason})`);
    const answer = await choose("unreachable", {
      type: "warning",
      message: "Le dossier de données est inaccessible.",
      detail: `Atlas OS ne peut pas écrire dans :\n${dataRoot}\n\nVérifie que le disque ou le service de synchronisation est bien disponible, puis réessaie. Tes données ne sont pas touchées.`,
      options: [
        { id: "retry", label: "Réessayer" },
        { id: "choose", label: "Choisir un autre dossier…" },
        { id: "quit", label: "Quitter" },
      ],
    });
    if (answer === "quit") throw Object.assign(new Error("quit"), { silent: true });
    if (answer === "choose") {
      const picked = await pickFolder("Choisir le dossier des données");
      if (picked) {
        const r = location.applyLocation(userData, { target: picked, mode: "use" });
        if (r.ok) {
          roots = location.resolveRoots(userData, location.readConfig(userData));
          dataRoot = roots.dataRoot;
          dataDir = roots.dbDir;
          serverDbDir = dataDir;
        }
      }
    }
  }
}

/** Finishes a pending import, takes (or yields) the device lock, and settles read-only mode. */
async function prepareData() {
  await ensureDataRoot();
  deviceLock = createDeviceLock({ root: dataRoot, device: deviceName, token: lockToken });
  const found = deviceLock.inspect();
  if (found.state === "held") {
    const answer = await choose("lock", {
      type: "warning",
      message: `Atlas OS est déjà ouvert sur ${found.holder.device}.`,
      detail:
        "Ouvrir les mêmes données depuis deux PC en même temps peut les abîmer.\n\n• Lecture seule : tu peux regarder tes données, sans rien modifier.\n• Forcer l’ouverture : à faire seulement si Atlas OS n’est en fait plus ouvert là-bas.",
      options: [
        { id: "readonly", label: "Ouvrir en lecture seule" },
        { id: "force", label: "Forcer l’ouverture" },
        { id: "quit", label: "Quitter" },
      ],
    });
    if (answer === "quit") throw Object.assign(new Error("quit"), { silent: true });
    readOnly = answer === "readonly";
  }
  if (!readOnly) {
    deviceLock.acquire();
    log(`device lock taken on ${dataRoot} (${deviceName})`);
  } else {
    // a private copy to read from: the shared folder is not opened by two PCs at once
    const copy = path.join(userData, "readonly-db", "atlas-pgdata");
    fs.rmSync(path.dirname(copy), { recursive: true, force: true });
    if (fs.existsSync(dataDir)) fs.cpSync(dataDir, copy, { recursive: true });
    serverDbDir = copy;
    log(`read-only: working on a copy of ${dataDir}`);
  }
}

/** Starts the server; when a replacement import was waiting, swaps it in and keeps the old data until it runs. */
async function startServerWithImport() {
  const swap = readOnly
    ? null
    : applyPendingImport(dataRoot, dataDir, (prefs) => prefsSync.writeImported(dataRoot, prefs));
  if (swap && !swap.ok) {
    importNotice = { ok: false, reason: swap.reason };
    log(`pending import not applied: ${swap.reason}`);
  }
  try {
    await startServer();
    if (swap && swap.ok) {
      swap.commit();
      importNotice = { ok: true, safetyBackup: swap.safetyBackup };
      log("import applied");
    }
  } catch (e) {
    if (!(swap && swap.ok)) throw e;
    log(`the imported data did not start (${e && e.message}); putting the previous data back`);
    try {
      if (server) server.kill();
    } catch {
      /* gone */
    }
    server = null;
    swap.rollback();
    importNotice = { ok: false, reason: "did_not_start", safetyBackup: swap.safetyBackup };
    await startServer();
  }
}

async function pickFolder(title) {
  if (testAnswers.folder) return testAnswers.folder;
  const r = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, {
    title,
    properties: ["openDirectory", "createDirectory"],
  });
  return r.canceled ? null : r.filePaths[0];
}

async function api(pathname, init = {}) {
  const res = await fetch(`${origin}${pathname}`, {
    ...init,
    headers: { "content-type": "application/json", [TOKEN_HEADER]: token, ...(init.headers || {}) },
  });
  return res.json();
}

const COLLECT_PREFS =
  "JSON.stringify(Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('atlas') && !k.startsWith('atlas.sync')).map((k) => [k, localStorage.getItem(k)])))";

async function currentPrefs() {
  try {
    if (win && !win.isDestroyed())
      return JSON.parse(await win.webContents.executeJavaScript(COLLECT_PREFS));
  } catch {
    /* no window yet */
  }
  return prefsSync.readSnapshot(dataRoot)?.keys ?? {};
}

/** Closes the database cleanly (so nothing is half-written), then stops the server. */
async function stopServerGracefully() {
  if (!server || !origin || !token) return;
  try {
    await Promise.race([
      api("/api/backup/shutdown", { method: "POST", body: "{}" }),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
  } catch {
    /* it will be stopped anyway */
  }
  try {
    quitting = true;
    server.kill();
  } catch {
    /* gone */
  }
}

async function relaunch() {
  await stopServerGracefully();
  if (deviceLock) deviceLock.release();
  app.relaunch();
  quitting = true;
  app.exit(0);
}

let autoBusy = false;
/** The daily automatic backup: when it is due and the folder is reachable. */
async function runAutoBackup({ force = false } = {}) {
  const cfg = location.readConfig(userData);
  const ab = cfg.autoBackup;
  if (autoBusy || readOnly || !ab.enabled || !ab.folder || !origin)
    return { ok: false, code: "off" };
  const now = new Date();
  if (!force && !autoBackup.isDue(ab.folder, now)) return { ok: true, skipped: true };
  const writable = location.checkWritable(ab.folder);
  if (!writable.ok) {
    location.writeConfig(userData, {
      ...cfg,
      autoBackup: { ...ab, lastError: "folder_unreachable" },
    });
    return { ok: false, code: "folder_unreachable" };
  }
  autoBusy = true;
  try {
    const out = autoBackup.autoBackupPath(ab.folder, now);
    const started = await api("/api/backup/export", {
      method: "POST",
      body: JSON.stringify({ path: out, prefs: await currentPrefs(), kind: "auto" }),
    });
    if (started.error) throw new Error(started.error.message);
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const { job } = await api("/api/backup/status");
      if (job && job.status === "done") break;
      if (job && job.status === "error") throw new Error(job.error?.message || "export failed");
    }
    const removed = autoBackup.rotate(ab.folder, autoBackup.KEEP);
    log(`automatic backup written: ${out} (removed ${removed.length} old)`);
    const fresh = location.readConfig(userData);
    location.writeConfig(userData, {
      ...fresh,
      autoBackup: {
        ...fresh.autoBackup,
        lastDay: autoBackup.dayOf(now),
        lastPath: out,
        lastError: null,
      },
    });
    return { ok: true, path: out };
  } catch (e) {
    log(`automatic backup failed: ${e && e.message}`);
    const fresh = location.readConfig(userData);
    location.writeConfig(userData, {
      ...fresh,
      autoBackup: { ...fresh.autoBackup, lastError: "failed" },
    });
    return { ok: false, code: "failed" };
  } finally {
    autoBusy = false;
  }
}

/** The things that run while the app is open: the lock's heartbeat, and the daily backup. */
function startDataWatchers() {
  if (!readOnly && deviceLock) {
    let asked = false;
    heartbeat = setInterval(
      async () => {
        const r = deviceLock.refresh();
        if (r.state === "taken" && !asked) {
          asked = true;
          const answer = await choose("external", {
            type: "warning",
            message: `Les données ont été ouvertes depuis ${r.holder.device}.`,
            detail:
              "Un autre appareil a pris la main sur ce dossier pendant qu’Atlas OS était ouvert ici : les fichiers ont pu changer. Recharger affiche les données à jour.",
            options: [
              { id: "reload", label: "Recharger" },
              { id: "ignore", label: "Ignorer" },
            ],
          });
          if (answer === "reload") await relaunch();
          else {
            deviceLock.acquire();
            asked = false;
          }
        }
      },
      process.env.ATLAS_HEARTBEAT_MS ? Number(process.env.ATLAS_HEARTBEAT_MS) : HEARTBEAT_MS,
    );
  }
  setTimeout(() => void runAutoBackup(), 20_000).unref();
  setInterval(() => void runAutoBackup(), 30 * 60 * 1000).unref();
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
    await prepareData();
    await startServerWithImport();
    url = origin;
  }
  lockDownSession();
  const window = createWindow(url);
  setupAutoUpdate({ app, getWindow: () => win, ipcMain, userData, log });
  startDataWatchers();
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
ipcMain.handle("atlas:open-data-folder", () => shell.openPath(dataRoot));

// ----- "Mes données": where the data lives, backups, the lock ----------------------------------
const dataInfo = () => {
  const cfg = location.readConfig(userData);
  return {
    dataRoot,
    dbDir: dataDir,
    defaultRoot: userData,
    isCustom: roots.isCustom,
    readOnly,
    device: deviceName,
    autoBackup: cfg.autoBackup,
    importNotice,
  };
};
ipcMain.handle("atlas:data-info", () => dataInfo());
ipcMain.handle("atlas:data-import-notice", () => {
  const n = importNotice;
  importNotice = null;
  return n;
});

const stampName = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `AtlasOS-sauvegarde-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.atlasbackup`;
};
ipcMain.handle("atlas:data-choose-save", async () => {
  if (testAnswers.save) return testAnswers.save;
  const r = await dialog.showSaveDialog(win && !win.isDestroyed() ? win : undefined, {
    title: "Exporter mes données",
    defaultPath: path.join(app.getPath("documents"), stampName()),
    filters: [{ name: "Sauvegarde Atlas OS", extensions: ["atlasbackup"] }],
  });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle("atlas:data-choose-open", async () => {
  if (testAnswers.open) return testAnswers.open;
  const r = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, {
    title: "Importer des données",
    properties: ["openFile"],
    filters: [{ name: "Sauvegarde Atlas OS", extensions: ["atlasbackup"] }],
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("atlas:data-choose-folder", (_e, title) =>
  pickFolder(String(title || "Choisir un dossier")),
);

/** What a folder would mean as the data folder, before anything is changed. */
ipcMain.handle("atlas:data-preview-location", (_e, target) => {
  const valid = location.validateTarget(String(target || ""), dataRoot);
  if (!valid.ok) return { ok: false, code: valid.reason };
  const writable = location.checkWritable(target);
  if (!writable.ok) return { ok: false, code: "not_writable" };
  const t = location.inspectTarget(target);
  return { ok: true, hasData: t.hasData, empty: t.empty };
});
ipcMain.handle("atlas:data-apply-location", async (_e, { target, mode }) => {
  if (readOnly) return { ok: false, code: "read_only" };
  await stopServerGracefully(); // the database must be closed before it is copied
  const r = location.applyLocation(userData, { target: String(target), mode });
  if (!r.ok) {
    // nothing changed: bring the app back up on the same data
    await relaunch();
    return r;
  }
  setTimeout(() => void relaunch(), 400);
  return r;
});
ipcMain.handle("atlas:data-restart", () => {
  setTimeout(() => void relaunch(), 300);
  return true;
});
ipcMain.handle("atlas:data-save-prefs", (_e, keys) => {
  if (readOnly || !keys || typeof keys !== "object") return null;
  const clean = {};
  for (const [k, v] of Object.entries(keys))
    if (typeof v === "string" && k.startsWith("atlas")) clean[k] = v;
  return prefsSync.saveSnapshot(dataRoot, clean);
});
ipcMain.on("atlas:prefs-boot", (e) => {
  // read by the preload before the page runs: what to apply to localStorage
  e.returnValue = readOnly ? null : prefsSync.readSnapshot(dataRoot);
});
ipcMain.handle("atlas:data-set-auto-backup", async (_e, { enabled, folder }) => {
  const cfg = location.readConfig(userData);
  const next = { ...cfg.autoBackup, enabled: !!enabled, folder: folder || cfg.autoBackup.folder };
  if (next.enabled && !next.folder) return { ok: false, code: "no_folder" };
  if (next.folder) {
    const w = location.checkWritable(next.folder);
    if (!w.ok) return { ok: false, code: "not_writable" };
  }
  location.writeConfig(userData, { ...cfg, autoBackup: { ...next, lastError: null } });
  if (next.enabled) void runAutoBackup();
  return { ok: true, info: dataInfo() };
});
ipcMain.handle("atlas:data-run-auto-backup", () => runAutoBackup({ force: true }));

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
      if (e && e.silent) {
        // the person chose to quit from a start-up question
        quitting = true;
        app.quit();
        return;
      }
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
    if (heartbeat) clearInterval(heartbeat);
    if (deviceLock) deviceLock.release();
    if (server) {
      try {
        server.kill();
      } catch {
        /* already gone */
      }
    }
  });
}
