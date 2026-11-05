"use strict";

/**
 * Automatic updates, with electron-updater and GitHub Releases.
 *
 * What it does, and what it never does:
 *  - it asks GitHub (only github.com and the hosts that serve release files) which version is the
 *    latest, by reading the small `latest.yml` of the newest release. It sends no data of the
 *    person's: the request is an ordinary HTTPS request that names nothing but the product and its
 *    version;
 *  - it never downloads on its own: the person clicks "Télécharger", then "Redémarrer et
 *    installer". The data folder (%APPDATA%\Atlas OS) is never touched by an update;
 *  - the person can switch the automatic check off (kept in `updater.json` in the data folder).
 *
 * The page talks to this module through the preload bridge (`atlasDesktop.updates`).
 */
const fs = require("node:fs");
const path = require("node:path");

/** How often the app looks for a newer version, once it is running. */
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
/** A short wait after launch, so the window is up and the server quiet before the first check. */
const FIRST_CHECK_DELAY_MS = 15 * 1000;

/** The only hosts a request that is not from the window may reach: GitHub's release files. */
const UPDATE_HOSTS = [
  "github.com",
  "api.github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
];

/**
 * May this request leave the PC? Only an https request made by the updater (not by a page of the
 * window) to a GitHub release host, or any request to this PC. Whatever the window itself asks for
 * that is not on this PC stays blocked.
 */
function isUpdateRequest(details, isLocalHost) {
  let url;
  try {
    url = new URL(details.url);
  } catch {
    return false;
  }
  if (isLocalHost(url.hostname)) return true;
  // A request made by a page of the window carries the id of that page; one made by the main
  // process (the updater) carries none.
  if (details.webContentsId) return false;
  return url.protocol === "https:" && UPDATE_HOSTS.includes(url.hostname);
}

/** What went wrong, as a few codes the page turns into a clear sentence in the person's language. */
function classifyError(error, phase) {
  const text = `${(error && error.code) || ""} ${(error && error.message) || error || ""}`;
  if (
    /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|CONNECTION_(REFUSED|RESET|CLOSED|TIMED_OUT)|net::ERR/i.test(
      text,
    )
  )
    return phase === "download" ? "interrupted" : "offline";
  if (/sha512|checksum|integrity/i.test(text)) return "corrupt";
  if (/404|Cannot find latest|latest\.yml|No published versions/i.test(text)) return "not_found";
  return phase === "download" ? "interrupted" : "failed";
}

function readSettings(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return { auto: raw.auto !== false };
  } catch {
    return { auto: true };
  }
}

/** electron-updater travels in `resources/updater/node_modules` (see scripts/stage-updater.mjs). */
function loadUpdater(packaged) {
  const bundled = path.join(process.resourcesPath || "", "updater", "node_modules");
  return packaged
    ? require(path.join(bundled, "electron-updater")).autoUpdater
    : require("electron-updater").autoUpdater;
}

function setupAutoUpdate({ app, getWindow, ipcMain, userData, log }) {
  const settingsFile = path.join(userData, "updater.json");
  const packaged = app.isPackaged;
  let state = {
    current: app.getVersion(),
    supported: packaged,
    auto: readSettings(settingsFile).auto,
    status: "idle", // idle | checking | uptodate | available | downloading | ready | error
    latest: null,
    percent: 0,
    error: null, // offline | not_found | interrupted | corrupt | failed
    errorWhile: null, // check | download
    checkedAt: null,
  };
  let timer = null;
  let phase = "check";
  let autoUpdater = null;

  const publish = () => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send("atlas:update-state", state);
  };
  const set = (patch) => {
    state = { ...state, ...patch };
    publish();
  };

  ipcMain.handle("atlas:updates-state", () => state);

  // Development (not packaged): there is nothing to update; the page hides the controls.
  if (!packaged) {
    ipcMain.handle("atlas:updates-set-auto", () => state);
    ipcMain.handle("atlas:updates-check", () => state);
    ipcMain.handle("atlas:updates-download", () => state);
    ipcMain.handle("atlas:updates-install", () => state);
    return;
  }

  autoUpdater = loadUpdater(true);
  autoUpdater.autoDownload = false; // the person decides
  autoUpdater.autoInstallOnAppQuit = false; // installing is a clear click, never a surprise
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = {
    info: (m) => log(`updater: ${m}`),
    warn: (m) => log(`updater: warn ${m}`),
    error: (m) => log(`updater: error ${m}`),
    debug: () => {},
  };
  // Tests only: serve the update files from this PC (a local address; the network rule refuses
  // every other host for the window and allows only GitHub for the updater).
  if (process.env.ATLAS_UPDATE_URL) {
    autoUpdater.setFeedURL({ provider: "generic", url: process.env.ATLAS_UPDATE_URL });
  }

  autoUpdater.on("update-available", (info) => {
    log(`updater: ${info.version} is available`);
    set({ status: "available", latest: info.version, error: null, errorWhile: null });
  });
  autoUpdater.on("update-not-available", () => {
    set({ status: "uptodate", latest: null, error: null, errorWhile: null });
  });
  autoUpdater.on("download-progress", (p) => {
    set({ status: "downloading", percent: Math.round(p.percent || 0) });
  });
  autoUpdater.on("update-downloaded", (info) => {
    log(`updater: ${info.version} downloaded`);
    set({ status: "ready", percent: 100, latest: info.version, error: null, errorWhile: null });
  });
  autoUpdater.on("error", (e) => {
    const code = classifyError(e, phase);
    log(`updater: ${phase} failed (${code}): ${e && e.message ? e.message : e}`);
    // A failed download leaves the update on offer, so "Télécharger" can be tried again.
    set({
      status: phase === "download" && state.latest ? "available" : "error",
      error: code,
      errorWhile: phase,
    });
  });

  async function check() {
    if (["checking", "downloading", "ready"].includes(state.status)) return state;
    phase = "check";
    set({ status: "checking", error: null, errorWhile: null });
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      // The "error" event already ran for most failures; make sure the state is never stuck.
      if (state.status === "checking")
        set({ status: "error", error: classifyError(e, "check"), errorWhile: "check" });
    }
    set({ checkedAt: new Date().toISOString() });
    return state;
  }

  function schedule() {
    if (timer) clearInterval(timer);
    timer = null;
    if (!state.auto) return;
    timer = setInterval(() => void check(), CHECK_EVERY_MS);
    timer.unref();
  }

  ipcMain.handle("atlas:updates-set-auto", (_e, value) => {
    const auto = value !== false;
    set({ auto });
    try {
      fs.writeFileSync(settingsFile, JSON.stringify({ auto }), "utf8");
    } catch (e) {
      log(`updater: could not save the setting: ${e && e.message}`);
    }
    schedule();
    return state;
  });
  ipcMain.handle("atlas:updates-check", () => check());
  ipcMain.handle("atlas:updates-download", async () => {
    if (state.status !== "available") return state;
    phase = "download";
    set({ status: "downloading", percent: 0, error: null, errorWhile: null });
    try {
      await autoUpdater.downloadUpdate();
    } catch (e) {
      if (state.status === "downloading")
        set({ status: "available", error: classifyError(e, "download"), errorWhile: "download" });
    }
    return state;
  });
  ipcMain.handle("atlas:updates-install", () => {
    if (state.status !== "ready") return state;
    log("updater: restarting to install");
    // Silent (no wizard to click through); the app reopens by itself when the install is done.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return state;
  });

  schedule();
  setTimeout(() => {
    if (state.auto) void check();
  }, FIRST_CHECK_DELAY_MS).unref();
}

module.exports = {
  setupAutoUpdate,
  isUpdateRequest,
  classifyError,
  UPDATE_HOSTS,
  CHECK_EVERY_MS,
  FIRST_CHECK_DELAY_MS,
};
