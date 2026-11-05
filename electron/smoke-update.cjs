"use strict";
/**
 * `ATLAS_SMOKE_UPDATE=<mode>`: a scripted pass through the update flow inside the real window, on
 * the throw-away data folder of the smoke test. Only used by hand to check updates; never part of
 * normal use.
 *
 *   check     asks for the latest version, writes what it found (and a picture)
 *   download  checks, downloads, and writes where it ended (a picture of each moment)
 *   install   checks, downloads, then restarts to install (writes the result BEFORE it quits)
 */
const fs = require("node:fs");
const path = require("node:path");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function smokeUpdate(window, out, shotsDir, flush) {
  const wc = window.webContents;
  const js = (code) => wc.executeJavaScript(code);
  const shot = async (name) => {
    if (!shotsDir) return;
    fs.mkdirSync(shotsDir, { recursive: true });
    fs.writeFileSync(path.join(shotsDir, `${name}.png`), (await wc.capturePage()).toPNG());
  };
  const mode = process.env.ATLAS_SMOKE_UPDATE;
  const r = (out.update = { mode, steps: [] });
  const state = () => js(`window.atlasDesktop.updates.state()`);
  const until = async (test, ms) => {
    const end = Date.now() + ms;
    let s = await state();
    while (!test(s) && Date.now() < end) {
      await sleep(400);
      s = await state();
    }
    return s;
  };

  await js(`document.cookie = 'atlas.locale=fr; path=/'`);
  await wc.loadURL(`${out.origin}/settings`);
  await sleep(3500);
  r.first = await state();

  await js(`window.atlasDesktop.updates.check()`);
  r.afterCheck = await until((s) => !["idle", "checking"].includes(s.status), 60_000);
  await sleep(700);
  await shot("1-after-check");
  r.settingsText = await js(
    `(document.querySelector('[aria-labelledby="st-advanced-t"]') || document.body).innerText`,
  );
  if (mode === "check" || r.afterCheck.status !== "available") return;

  await js(`window.atlasDesktop.updates.download()`);
  await sleep(1500);
  await shot("2-downloading");
  r.afterDownload = await until((s) => ["ready", "available", "error"].includes(s.status), 240_000);
  await sleep(700);
  await shot("3-after-download");
  r.noticeText = await js(`(document.querySelector('aside[role=status]') || {}).innerText || null`);
  if (mode === "download" || r.afterDownload.status !== "ready") return;

  out.ok = true;
  flush();
  await js(`window.atlasDesktop.updates.install()`);
  await sleep(30_000); // the app quits to install; if it is still here, something is wrong
};
