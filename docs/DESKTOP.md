**English** · [Français](DESKTOP.fr.md)

# Atlas OS — desktop app (Windows)

Atlas OS ships as an installable Windows program built with Electron and electron-builder. The app
is the same code as the web build: the desktop shell starts the built server on this PC only and
opens a window on it. Nothing is sent over the internet.

## Commands

| Command                 | What it does                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run electron:dev`  | Development: starts `next dev` and an Electron window on it (developer tools available). Uses the project's own `data/` folder.                                          |
| `npm run build:server`  | Builds the server for the desktop app (`.next/standalone`).                                                                                                              |
| `npm run dist:dir`      | Builds the server, then an unpacked app in `release/win-unpacked` (quick check, no installer).                                                                           |
| `npm run dist:win`      | Builds the server, then the Windows installer `release/Atlas-OS-Setup-<version>.exe` (NSIS).                                                                             |
| `npm run dist:smoke`    | Starts the built app twice on a throw-away data folder and checks the essentials (window, version, empty database, create + keep data, internet blocked, Ollama bridge). |
| `npm run electron:icon` | Redraws `build/icon.png` from `src/app/icon.svg`.                                                                                                                        |

The version is `version` in `package.json` (it is shown in the sidebar and in Settings).

## Where the data lives

Everything the app keeps is in one folder per Windows user: `%APPDATA%\Atlas OS`
(`C:\Users\<you>\AppData\Roaming\Atlas OS`).

- `data\atlas-pgdata\` — the database (an embedded PostgreSQL, PGlite). **The documents of the Vault
  are stored inside it** (table `document_files`), so one folder holds everything.
- `data\atlas-pgdata.lock` — marks the database as open (removed on exit).
- `logs\atlas-os.log` — what the app and its server logged (no personal content).
- the rest (`Cache`, `Local Storage`, …) — the window's own cache and the interface preferences
  (theme, sounds, mascot, timer sessions, assistant choice).

The installer only writes to the install folder; **uninstalling or updating never touches
`%APPDATA%\Atlas OS`**. On a first launch the database is created from `db/migrations`; the public
demo data (`src/seed/neutral-fr.ts`) is development-only and never part of the installed app.

## What stays local

- The server listens on `127.0.0.1` only, on a free port chosen at each launch, and asks for a
  secret generated at each launch that only the app's window knows (`ATLAS_DESKTOP_TOKEN`).
- The window blocks every request that is not to this PC. The only exception is the update check
  (see Updates), made by the app itself and never by a page.
- Links to web pages (e.g. the Ollama download page) open in the default browser.
- The assistant talks to the Ollama on this PC (`http://127.0.0.1:11434`) from the app's own
  server (`/api/ollama/*`), so there is no CORS problem and no data leaves the machine.

## First launch on Windows

The installer is **not code-signed yet**. Windows SmartScreen will show “Windows protected your PC”
(“Unknown publisher”; on a French Windows: “Windows a protégé votre PC”): choose **More info → Run
anyway** (“Informations complémentaires → Exécuter quand même”). A code-signing certificate is a
later step. The Windows firewall may ask once whether to allow the app: the server only listens on
127.0.0.1, so declining is fine.

## Updates

Automatic updates use `electron-updater` and the `publish` block of `electron-builder.yml` (GitHub
Releases). The release workflow (`.github/workflows/release.yml`) uploads, besides the installer,
`latest.yml` and the `.blockmap` file: the app reads `latest.yml` to learn the newest version.

- `electron/updater.cjs` checks at launch (after 15 s), then every 4 hours, unless the person turned
  it off (`updater.json` in the data folder). Nothing is downloaded or installed without a click:
  "Télécharger", then "Redémarrer et installer". `%APPDATA%\Atlas OS` is never touched.
- The page reaches it through `window.atlasDesktop.updates` (`electron/preload.cjs`); the notice is
  `src/components/shell/UpdateNotice.tsx`, the controls are in Settings → Language and workspace.
- Network rule: a request from a page of the window may only go to this PC. The updater's own
  requests (made by the main process, so with no page id) may also reach `https://` GitHub release
  hosts and nothing else (`isUpdateRequest` in `updater.cjs`, covered by tests).
- electron-updater travels in `resources/updater/node_modules` (`scripts/stage-updater.mjs`).
- Test without publishing: serve a folder holding the new installer and `latest.yml` on a local
  address and start the old app with `ATLAS_UPDATE_URL=http://127.0.0.1:<port>/` (local addresses
  only: any other host is refused).
- Errors are words, not codes: no connection, no published version, interrupted download, incomplete
  file, or a failed check; the person's data is never at risk.

## Other platforms

`electron-builder.yml` has commented `mac` and `linux` blocks, and the shell code already branches on
`process.platform` (menu). Add the block, an `.icns` icon on macOS, and a `dist:mac` / `dist:linux`
script.
