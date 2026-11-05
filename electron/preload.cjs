"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/**
 * What the page can know about the desktop app, and nothing more: its version, where the data
 * lives, and a way to open that folder. The page has no access to Node or to the file system.
 */
contextBridge.exposeInMainWorld("atlasDesktop", {
  getInfo: () => ipcRenderer.invoke("atlas:info"),
  openDataFolder: () => ipcRenderer.invoke("atlas:open-data-folder"),
  /** Updates: the state, the actions the person can take, and a subscription to changes. */
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
