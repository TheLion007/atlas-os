"use strict";
/**
 * `ATLAS_SMOKE_ASSISTANT=<model>`: a scripted pass through the structured assistant inside the real
 * window, on the throw-away data folder of the smoke test. It writes a sentence, reads the model's
 * proposal, creates everything, then undoes it, taking pictures of each moment. Only used by
 * `npm run dist:smoke` / manual verification; never part of normal use.
 */
const fs = require("node:fs");
const path = require("node:path");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function smokeAssistant(window, origin, out, shotsDir) {
  const wc = window.webContents;
  const js = (code) => wc.executeJavaScript(code);
  const shot = async (name) => {
    if (!shotsDir) return;
    fs.mkdirSync(shotsDir, { recursive: true });
    fs.writeFileSync(path.join(shotsDir, `${name}.png`), (await wc.capturePage()).toPNG());
  };
  const model = process.env.ATLAS_SMOKE_ASSISTANT;
  const text =
    process.env.ATLAS_SMOKE_ASSISTANT_TEXT ||
    "Crée un plan NIRYS avec mes projets Atlas OS, Nova Audio et Nimbus, et dans Atlas ajoute les sous-projets déploiement, design et promotion";
  const r = (out.assistant = { model, steps: [] });
  const graph = () =>
    js(
      `fetch('/api/graph').then(r => r.json()).then(g => g.nodes.map(n => n.type + ':' + n.title).sort())`,
    );

  // French, as the person uses it (the language is a cookie).
  await js(`document.cookie = 'atlas.locale=fr; path=/'`);
  // The person's choice of model, as the Settings would store it.
  await js(
    `localStorage.setItem('atlas-ollama', JSON.stringify({ state: { model: ${JSON.stringify(model)}, dismissed: false }, version: 1 }))`,
  );
  // Existing data: one project the sentence mentions, so "already exists" is exercised too.
  await js(
    `fetch('/api/objects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'project', title: 'Atlas OS', status: 'active', tags: [], confidence: null, details: { description: '' }, relations: [] }) }).then(r => r.status)`,
  );
  await wc.loadURL(`${origin}/`);
  await sleep(3500);
  r.before = await graph();

  wc.sendInputEvent({ type: "keyDown", keyCode: "J", modifiers: ["control"] });
  wc.sendInputEvent({ type: "keyUp", keyCode: "J", modifiers: ["control"] });
  await sleep(2500);
  await js(`(() => {
    const ta = document.querySelector('textarea');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(300);
  await shot("1-written");
  const t0 = Date.now();
  await js(
    `[...document.querySelectorAll('button')].find(b => /Organiser|Sort/.test(b.textContent))?.click()`,
  );
  await sleep(1200);
  await shot("2-thinking");
  r.thinkingShown = await js(`!!document.querySelector('[role=status] svg')`);
  r.thinkingText = await js(`(document.querySelector('[role=status]') || {}).innerText || null`);

  // Wait for the proposal (or an error message).
  let state = "timeout";
  for (let i = 0; i < 240; i++) {
    state = await js(
      `document.querySelector('section[aria-label]') && /voilà ce que|here is what/i.test(document.body.innerText) ? 'proposal' : document.querySelector('[role=alert]') ? 'error' : 'wait'`,
    );
    if (state !== "wait") break;
    await sleep(1000);
  }
  r.state = state;
  r.ms = Date.now() - t0;
  await sleep(600);
  await shot("3-proposal");
  r.proposalText = await js(
    `(document.querySelector('section[aria-label]') || document.querySelector('[role=alert]') || document.body).innerText`,
  );
  r.fields = await js(
    `[...document.querySelectorAll('section[aria-label] input[type=text], section[aria-label] input:not([type])')].map(i => i.value)`,
  );
  if (state !== "proposal") return;

  // Rename the first editable title, untick the last checkbox: the buttons must follow.
  const created0 = await js(
    `document.querySelector('[role=status].num, section[aria-label] p[role=status]')?.innerText`,
  );
  r.summaryBefore = created0;
  await js(`(() => {
    const boxes = [...document.querySelectorAll('section[aria-label] input[type=checkbox]')];
    boxes[boxes.length - 1]?.click();
  })()`);
  await sleep(500);
  r.summaryAfterUntick = await js(
    `document.querySelector('section[aria-label] p[role=status]')?.innerText`,
  );
  await js(`(() => {
    const boxes = [...document.querySelectorAll('section[aria-label] input[type=checkbox]')];
    boxes[boxes.length - 1]?.click();
  })()`);
  await sleep(300);

  await js(
    `[...document.querySelectorAll('button')].find(b => /Tout créer|Create all/.test(b.textContent))?.click()`,
  );
  await sleep(4000);
  await shot("4-created");
  r.after = await graph();
  r.undoLabel = await js(
    `[...document.querySelectorAll('button')].map(b => b.textContent).find(t => /Annuler la dernière|Undo the last/.test(t)) || null`,
  );
  await js(
    `[...document.querySelectorAll('button')].find(b => /Annuler la dernière|Undo the last/.test(b.textContent))?.click()`,
  );
  await sleep(3500);
  await shot("5-undone");
  r.afterUndo = await graph();
};
