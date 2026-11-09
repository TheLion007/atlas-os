"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/**
 * What the page can know about the desktop app, and nothing more: its version, where the data
 * lives, and a way to open that folder. The page has no access to Node or to the file system.
 */
// The preferences follow the data folder: the file mirrored there is applied before the page runs
// when it is newer than what this window last applied. (The local server's port changes at each
// launch, and with it the window's own storage, so this is also what keeps them from one launch
// to the next.)
try {
  const snap = ipcRenderer.sendSync("atlas:prefs-boot");
  if (snap && snap.savedAt) {
    const applied = window.localStorage.getItem("atlas.sync.applied");
    if (!applied || snap.savedAt > applied) {
      for (const [k, v] of Object.entries(snap.keys)) window.localStorage.setItem(k, v);
      window.localStorage.setItem("atlas.sync.applied", snap.savedAt);
    }
  }
} catch {
  /* storage blocked: the app starts with its defaults */
}

contextBridge.exposeInMainWorld("atlasDesktop", {
  getInfo: () => ipcRenderer.invoke("atlas:info"),
  openDataFolder: () => ipcRenderer.invoke("atlas:open-data-folder"),
  /** Updates: the state, the actions the person can take, and a subscription to changes. */
  /** "Mes données": the data folder, backups, read-only mode, the daily backup. */
  data: {
    info: () => ipcRenderer.invoke("atlas:data-info"),
    importNotice: () => ipcRenderer.invoke("atlas:data-import-notice"),
    chooseSavePath: () => ipcRenderer.invoke("atlas:data-choose-save"),
    chooseOpenPath: () => ipcRenderer.invoke("atlas:data-choose-open"),
    chooseFolder: (title) => ipcRenderer.invoke("atlas:data-choose-folder", title),
    previewLocation: (target) => ipcRenderer.invoke("atlas:data-preview-location", target),
    applyLocation: (target, mode) =>
      ipcRenderer.invoke("atlas:data-apply-location", { target, mode }),
    restart: () => ipcRenderer.invoke("atlas:data-restart"),
    savePrefs: (keys) => ipcRenderer.invoke("atlas:data-save-prefs", keys),
    setAutoBackup: (enabled, folder) =>
      ipcRenderer.invoke("atlas:data-set-auto-backup", { enabled, folder }),
    runAutoBackup: () => ipcRenderer.invoke("atlas:data-run-auto-backup"),
  },
  updates: {
    state: () => ipcRenderer.invoke("atlas:updates-state"),
    check: () => ipcRenderer.invoke("atlas:updates-check"),
    download: () => ipcRenderer.invoke("atlas:updates-download"),
    install: () => ipcRenderer.invoke("atlas:updates-install"),
    setAuto: (on) => ipcRenderer.invoke("atlas:updates-set-auto", !!on),
    onState: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("atlas:update-state", listener);
      return () => ipcRenderer.removeListener("atlas:update-state", listener);
    },
  },
});
