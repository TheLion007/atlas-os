// Draws the application icon (build/icon.png, 512x512) from src/app/icon.svg, using Electron itself
// to render it. electron-builder turns the PNG into the .ico for Windows.
// Run with: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const SIZE = 512;
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs
    .readFileSync(path.join(__dirname, "..", "src", "app", "icon.svg"), "utf8")
    .replace(/<svg /, `<svg style="width:${SIZE}px;height:${SIZE}px;display:block" `);
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  await win.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)}`,
  );
  await new Promise((r) => setTimeout(r, 400));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  fs.writeFileSync(path.join(__dirname, "..", "build", "icon.png"), image.toPNG());
  console.log("build/icon.png written", image.getSize());
  app.quit();
});
