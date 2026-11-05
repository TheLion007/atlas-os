"use strict";
/**
 * `ATLAS_SMOKE_README_SEED=<json>`: fills the throw-away data folder of the smoke test with the
 * public example workspace (invented, see src/seed/neutral-fr.ts) and takes the pictures the
 * README shows, from the real packaged window. Only used by hand to refresh docs/screenshots;
 * never part of normal use.
 *
 * Steps: "views" (home, graph, map, history), "assistant" (the proposal of the local model),
 * "tutorial" (the Ollama tutorial, shown when Ollama is not there).
 */
const fs = require("node:fs");
const path = require("node:path");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function smokeShots(window, origin, out, shotsDir) {
  const wc = window.webContents;
  const js = (code) => wc.executeJavaScript(code);
  fs.mkdirSync(shotsDir, { recursive: true });
  const shot = async (name) => {
    fs.writeFileSync(path.join(shotsDir, `${name}.png`), (await wc.capturePage()).toPNG());
  };
  const step = process.env.ATLAS_SMOKE_README_STEP || "views";
  const model = process.env.ATLAS_SMOKE_ASSISTANT || "";
  const seed = JSON.parse(fs.readFileSync(process.env.ATLAS_SMOKE_README_SEED, "utf8"));
  const r = (out.shots = { step });

  await js(`document.cookie = 'atlas.locale=fr; path=/'`);
  await js(
    `localStorage.setItem('atlas-ollama', JSON.stringify({ state: { model: ${JSON.stringify(model || null)}, dismissed: false }, version: 1 }))`,
  );

  // Fill the throw-away database with the example workspace (documents need files: skipped).
  const post = (url, body) =>
    js(
      `fetch(${JSON.stringify(url)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }))`,
    );
  const ids = new Map();
  for (const o of seed.objects) {
    if (o.input.type === "document") continue;
    const res = await post("/api/objects", { ...o.input, relations: [] });
    if (res.body && res.body.id) ids.set(o.key, res.body.id);
  }
  let edgesOk = 0;
  for (const e of seed.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    const res = await post("/api/edges", { ...e, from: ids.get(e.from), to: ids.get(e.to) });
    if (res.status === 201) edgesOk++;
  }
  r.objects = ids.size;
  r.edges = edgesOk;

  const go = async (route, wait = 4000) => {
    await wc.loadURL(`${origin}${route}`);
    await sleep(wait);
  };

  if (step === "views") {
    await go("/");
    await shot("accueil");
    await go("/graph", 7000);
    await shot("graphe");
    await go("/map", 7000);
    await shot("carte");
    await go("/history", 4000);
    await shot("historique");
    return;
  }

  await go("/");
  wc.sendInputEvent({ type: "keyDown", keyCode: "J", modifiers: ["control"] });
  wc.sendInputEvent({ type: "keyUp", keyCode: "J", modifiers: ["control"] });
  await sleep(3000);
  if (step === "tutorial") {
    await shot("tutoriel-ollama");
    r.text = await js(`document.body.innerText.slice(0, 500)`);
    return;
  }
  // step === "assistant": a loose sentence, the local model's proposal on screen.
  const text =
    "Pour le studio : créer un plan Lancement automne avec le site Atelier Lumen et l'application Mobile, et dans le site ajouter les sous-projets accessibilité, SEO et traduction";
  await js(`(() => {
    const ta = document.querySelector('textarea');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(300);
  await js(
    `[...document.querySelectorAll('button')].find(b => /Organiser|Sort/.test(b.textContent))?.click()`,
  );
  let state = "timeout";
  for (let i = 0; i < 120; i++) {
    state = await js(
      `/voilà ce que|here is what/i.test(document.body.innerText) ? 'proposal' : document.querySelector('[role=alert]') ? 'error' : 'wait'`,
    );
    if (state !== "wait") break;
    await sleep(1000);
  }
  r.state = state;
  await sleep(800);
  await shot("assistant");
  r.text = await js(
    `(document.querySelector('section[aria-label]') || document.body).innerText.slice(0, 900)`,
  );
};
