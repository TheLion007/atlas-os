"use strict";
/**
 * `ATLAS_SMOKE_DELETE=<seed.json>`: a scripted pass through deleting, in the real window, on the
 * throw-away data folder of the smoke test (it fills it with the public example workspace). It
 * deletes a project with what it holds, undoes it, deletes a lone task, a document (its file must
 * be freed once the undo delay has passed) and opens the object menu, taking pictures of each
 * moment. Only used by hand to check deleting; never part of normal use.
 */
const fs = require("node:fs");
const path = require("node:path");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function smokeDelete(window, origin, out, shotsDir) {
  const wc = window.webContents;
  const js = (code) => wc.executeJavaScript(code);
  fs.mkdirSync(shotsDir, { recursive: true });
  const shot = async (name) =>
    fs.writeFileSync(path.join(shotsDir, `${name}.png`), (await wc.capturePage()).toPNG());
  const r = (out.del = { steps: [] });
  const seed = JSON.parse(fs.readFileSync(process.env.ATLAS_SMOKE_DELETE, "utf8"));

  await js(`document.cookie = 'atlas.locale=fr; path=/'`);
  const post = (url, body) =>
    js(
      `fetch(${JSON.stringify(url)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then(async x => ({ status: x.status, body: await x.json().catch(() => null) }))`,
    );
  const ids = new Map();
  for (const o of seed.objects) {
    if (o.input.type === "document") continue;
    const res = await post("/api/objects", { ...o.input, relations: [] });
    if (res.body && res.body.id) ids.set(o.key, res.body.id);
  }
  for (const e of seed.edges) {
    if (ids.has(e.from) && ids.has(e.to))
      await post("/api/edges", { ...e, from: ids.get(e.from), to: ids.get(e.to) });
  }
  const graph = () => js(`fetch('/api/graph?details=true').then(x => x.json())`);
  const orphans = (g) => {
    const have = new Set(g.nodes.map((n) => n.id));
    return g.edges.filter((e) => !have.has(e.from) || !have.has(e.to)).length;
  };
  const keyDown = async (key) => {
    wc.sendInputEvent({ type: "keyDown", keyCode: key });
    wc.sendInputEvent({ type: "keyUp", keyCode: key });
  };
  const clickButton = (re) =>
    js(
      `(() => { const b = [...document.querySelectorAll('button')].find(b => ${re}.test(b.textContent)); if (b) b.click(); return !!b; })()`,
    );
  const text = (sel) =>
    js(`(document.querySelector(${JSON.stringify(sel)}) || {}).innerText || null`);

  // 1) a project with what it holds: Del on the open item, the confirmation with the numbers.
  let g = await graph();
  const kids = new Map();
  for (const e of g.edges)
    if (e.kind === "contains") (kids.get(e.from) ?? kids.set(e.from, []).get(e.from)).push(e.to);
  const size = (id) => 1 + (kids.get(id) ?? []).reduce((n, k) => n + size(k), 0);
  const project = g.nodes
    .filter((n) => n.type === "project")
    .sort((a, b) => size(b.id) - size(a.id))[0];
  r.project = { title: project.title, goes: size(project.id) };
  const before = g.nodes.length;
  await wc.loadURL(`${origin}/?peek=${project.id}`);
  await sleep(3500);
  await shot("1-open");
  await keyDown("Delete");
  await sleep(1200);
  r.confirmText = await text('[role="alertdialog"]');
  await shot("2-confirm");
  await clickButton(/Tout supprimer/);
  await sleep(1500);
  g = await graph();
  r.afterDelete = { nodes: g.nodes.length, orphanEdges: orphans(g) };
  r.bannerText = await text("aside[role=status]");
  await shot("3-banner");
  await clickButton(/^Annuler$/);
  await sleep(2000);
  g = await graph();
  r.afterUndo = {
    nodes: g.nodes.length,
    backToBefore: g.nodes.length === before,
    orphanEdges: orphans(g),
  };
  await shot("4-restored");

  // 2) a lone task: deleted at once, no confirmation; final after the delay.
  const lone = g.nodes.find((n) => n.type === "task" && !(kids.get(n.id) ?? []).length);
  await wc.loadURL(`${origin}/?peek=${lone.id}`);
  await sleep(3000);
  await keyDown("Delete");
  await sleep(1200);
  r.loneConfirmationShown = !!(await text('[role="alertdialog"]'));
  r.loneBanner = await text("aside[role=status]");
  await shot("5-lone");
  await sleep(9500);
  r.loneFinal = (await js(`fetch('/api/objects/${lone.id}').then(x => x.status)`)) === 404;

  // 3) a document with a real file: its bytes must be freed for good after the delay.
  const stored = await js(`(async () => {
    const f = new File([new Uint8Array(20000).fill(65)], 'contrat-test.txt', { type: 'text/plain' });
    const body = new FormData(); body.append('file', f, f.name);
    const res = await fetch('/api/files', { method: 'POST', body });
    return res.json();
  })()`);
  const doc = await post("/api/objects", {
    type: "document",
    title: "Contrat de test",
    status: "active",
    tags: [],
    confidence: null,
    details: {
      mime: "text/plain",
      sizeBytes: 20000,
      checksum: stored.checksum,
      storagePath: stored.storagePath,
      originalName: "contrat-test.txt",
      uploadedAt: new Date().toISOString(),
      source: "upload",
      kind: "contract",
      contentText: null,
    },
    relations: [],
  });
  r.docFileBefore = await js(
    `fetch('/api/files/' + encodeURIComponent(${JSON.stringify(stored.storagePath)}), { cache: 'no-store' }).then(x => x.status)`,
  );
  await wc.loadURL(`${origin}/?peek=${doc.body.id}`);
  await sleep(3000);
  await keyDown("Delete");
  await sleep(1200);
  r.docBanner = await text("aside[role=status]");
  r.docFileDuringDelay = await js(
    `fetch('/api/files/' + encodeURIComponent(${JSON.stringify(stored.storagePath)}), { cache: 'no-store' }).then(x => x.status)`,
  );
  await shot("6-document");
  await sleep(9500);
  r.docFileAfter = await js(
    `fetch('/api/files/' + encodeURIComponent(${JSON.stringify(stored.storagePath)}), { cache: 'no-store' }).then(x => x.status)`,
  );
  r.docObjectAfter = await js(`fetch('/api/objects/${doc.body.id}').then(x => x.status)`);

  // 4) the object menu, and the shortcuts in Settings.
  await wc.loadURL(`${origin}/`);
  await sleep(3500);
  r.menuOpened = await js(`(() => {
    const a = [...document.querySelectorAll('a[href*="/objects/"]')][0];
    if (!a) return false;
    const b = a.getBoundingClientRect();
    a.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 20, clientY: b.top + 20 }));
    return true;
  })()`);
  await sleep(600);
  r.menuText = await text('[role="menu"]');
  await shot("7-menu");
  await keyDown("Escape");
  await wc.loadURL(`${origin}/settings`);
  await sleep(3500);
  await js(`document.getElementById('st-shortcuts')?.scrollIntoView()`);
  await sleep(800);
  r.shortcuts = await text("#st-shortcuts");
  await shot("8-shortcuts");
};
