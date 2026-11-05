// `npm run electron:dev`: starts the Next dev server, waits for it, opens the Electron window on
// it (with the developer tools available), and stops the server when the window closes.
import { spawn } from "node:child_process";
import http from "node:http";
import { createRequire } from "node:module";

const PORT = process.env.ATLAS_DEV_PORT || "3100";
const URL_ = `http://127.0.0.1:${PORT}`;
const require = createRequire(import.meta.url);
const electron = require("electron");

const next = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "-H", "127.0.0.1", "-p", PORT],
  {
    stdio: "inherit",
    env: { ...process.env, NEXT_PUBLIC_ATLAS_FIXTURES: "" },
  },
);

function ready() {
  return new Promise((resolve) => {
    const attempt = () => {
      http
        .get(`${URL_}/api/health`, (res) => {
          res.resume();
          if (res.statusCode === 200) resolve();
          else setTimeout(attempt, 500);
        })
        .on("error", () => setTimeout(attempt, 500));
    };
    attempt();
  });
}

await ready();
const app = spawn(electron, ["."], {
  stdio: "inherit",
  env: { ...process.env, ATLAS_DEV_URL: URL_ },
});
const stop = () => {
  next.kill();
  process.exit(0);
};
app.on("exit", stop);
process.on("SIGINT", stop);
