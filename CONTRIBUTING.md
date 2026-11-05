**English** · [Français](CONTRIBUTING.fr.md)

# Contributing to Atlas OS

Thank you for wanting to help. Atlas OS is a local-first Windows app (Electron + Next.js + an embedded PostgreSQL): **no data ever leaves the user's PC**, and contributions must keep it that way.

## Before you start

- For anything bigger than a small fix, **open an issue or a discussion first** so we can agree on the approach before you spend time on it.
- **Design rule:** the interface follows the reference design. Please do not add a new button, panel or style on your own initiative. The sidebar holds exactly its ten entries.
- **Privacy rule:** no telemetry, no analytics, no new network call. The only connection the app makes is the update check to GitHub (see [docs/DESKTOP.md](docs/DESKTOP.md)).

## Setting up

Requirements: Node.js 22+ (see `.nvmrc`).

```bash
git clone https://github.com/TheLion007/atlas-os.git
cd atlas-os
npm install
npm run dev            # http://127.0.0.1:3000
```

The development database is the `data/` folder next to the project; it is git-ignored. Never commit it, a backup, or a `.env` file.

## Proposing a change

1. Fork the repository and create a branch (`git checkout -b my-change`).
2. Make your change, with tests where it makes sense.
3. Run **`npm run check`**: lint, types, tests and formatting must all pass.
4. Open a pull request that explains **what** changes and **why**. Screenshots help for anything visible.

Commit messages: a short summary line in the imperative ("Fix the calendar week start"), then details if needed.

## Where things are

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the scripts and conventions, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the layers, and [docs/DESKTOP.md](docs/DESKTOP.md) for the Windows app.

## Reporting a problem

Use the [issue form](https://github.com/TheLion007/atlas-os/issues/new/choose). Give your Atlas OS version (Settings), what you did, what you expected and what happened. **Never attach your database or private documents.** For a security problem, do not open a public issue: contact the maintainer through GitHub instead.

## License

By contributing, you agree that your contribution is released under the [MIT license](LICENSE).
