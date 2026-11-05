[English](DESKTOP.md) · **Français**

# Atlas OS — application de bureau (Windows)

Atlas OS est livré comme un programme Windows installable, construit avec Electron et
electron-builder. L'application est le même code que la version web : la coquille de bureau démarre
le serveur construit sur ce PC uniquement et ouvre une fenêtre dessus. Rien n'est envoyé sur
Internet.

## Commandes

| Commande                | Ce qu'elle fait                                                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run electron:dev`  | Développement : lance `next dev` et une fenêtre Electron dessus (outils de développement disponibles). Utilise le dossier `data/` du projet.                                            |
| `npm run build:server`  | Construit le serveur pour l'application de bureau (`.next/standalone`).                                                                                                                 |
| `npm run dist:dir`      | Construit le serveur, puis une application dépaquetée dans `release/win-unpacked` (vérification rapide, pas d'installateur).                                                            |
| `npm run dist:win`      | Construit le serveur, puis l'installateur Windows `release/Atlas-OS-Setup-<version>.exe` (NSIS).                                                                                        |
| `npm run dist:smoke`    | Lance deux fois l'application construite sur un dossier de données jetable et vérifie l'essentiel (fenêtre, version, base vide, création + conservation, Internet bloqué, pont Ollama). |
| `npm run electron:icon` | Redessine `build/icon.png` à partir de `src/app/icon.svg`.                                                                                                                              |

La version est le champ `version` de `package.json` (elle s'affiche dans la barre latérale et dans
les Paramètres).

## Où vivent les données

Tout ce que l'application garde est dans un dossier par utilisateur Windows : `%APPDATA%\Atlas OS`
(`C:\Users\<toi>\AppData\Roaming\Atlas OS`).

- `data\atlas-pgdata\` — la base de données (un PostgreSQL embarqué, PGlite). **Les documents du
  Coffre sont stockés dedans** (table `document_files`), donc un seul dossier contient tout.
- `data\atlas-pgdata.lock` — indique que la base est ouverte (supprimé à la fermeture).
- `logs\atlas-os.log` — ce que l'application et son serveur ont journalisé (aucun contenu personnel).
- le reste (`Cache`, `Local Storage`, …) — le cache propre à la fenêtre et les préférences de
  l'interface (thème, sons, mascotte, sessions du minuteur, choix de l'assistant).

L'installateur n'écrit que dans le dossier d'installation ; **désinstaller ou mettre à jour ne touche
jamais à `%APPDATA%\Atlas OS`**. Au premier lancement, la base est créée à partir de
`db/migrations` ; les données de démonstration publiques (`src/seed/neutral-fr.ts`) ne servent qu'au
développement et ne font jamais partie de l'application installée.

## Ce qui reste local

- Le serveur écoute sur `127.0.0.1` uniquement, sur un port libre choisi à chaque lancement, et
  exige un secret généré à chaque lancement que seule la fenêtre de l'application connaît
  (`ATLAS_DESKTOP_TOKEN`).
- La fenêtre bloque toute requête qui ne va pas vers ce PC. La seule exception est la vérification
  des mises à jour (voir Mises à jour), faite par l'application elle-même et jamais par une page.
- Les liens vers des pages web (par exemple la page de téléchargement d'Ollama) s'ouvrent dans le
  navigateur par défaut.
- L'assistant parle à l'Ollama de ce PC (`http://127.0.0.1:11434`) depuis le serveur de
  l'application (`/api/ollama/*`), donc pas de problème de CORS et aucune donnée ne quitte la machine.

## Premier lancement sous Windows

L'installateur **n'est pas encore signé numériquement**. Windows SmartScreen affichera « Windows a
protégé votre PC » (« Éditeur inconnu ») : choisis **Informations complémentaires → Exécuter quand
même**. Un certificat de signature est une étape ultérieure. Le pare-feu Windows peut demander une
fois s'il faut autoriser l'application : le serveur n'écoute que sur 127.0.0.1, tu peux donc
refuser.

## Mises à jour

Les mises à jour automatiques utilisent `electron-updater` et le bloc `publish` de
`electron-builder.yml` (GitHub Releases). Le workflow de release (`.github/workflows/release.yml`)
envoie, en plus de l'installateur, `latest.yml` et le fichier `.blockmap` : l'application lit
`latest.yml` pour connaître la dernière version.

- `electron/updater.cjs` vérifie au lancement (après 15 s), puis toutes les 4 heures, sauf si la
  personne l'a désactivé (`updater.json` dans le dossier de données). Rien n'est téléchargé ni
  installé sans clic : « Télécharger », puis « Redémarrer et installer ». `%APPDATA%\Atlas OS` n'est
  jamais touché.
- La page y accède par `window.atlasDesktop.updates` (`electron/preload.cjs`) ; le message est
  `src/components/shell/UpdateNotice.tsx`, les contrôles sont dans Paramètres → Langue et espace de
  travail.
- Règle réseau : une requête d'une page de la fenêtre ne peut aller que vers ce PC. Les requêtes de
  l'outil de mise à jour lui-même (faites par le processus principal, donc sans identifiant de page)
  peuvent aussi atteindre les hôtes de publication GitHub en `https://` et rien d'autre
  (`isUpdateRequest` dans `updater.cjs`, couvert par des tests).
- electron-updater voyage dans `resources/updater/node_modules` (`scripts/stage-updater.mjs`).
- Tester sans publier : servir un dossier contenant le nouvel installateur et `latest.yml` sur une
  adresse locale et lancer l'ancienne application avec `ATLAS_UPDATE_URL=http://127.0.0.1:<port>/`
  (adresses locales uniquement : tout autre hôte est refusé).
- Les erreurs sont des phrases, pas des codes : pas de connexion, aucune version publiée,
  téléchargement interrompu, fichier incomplet, ou vérification échouée ; les données de la personne
  ne sont jamais en danger.

## Autres plateformes

`electron-builder.yml` contient des blocs `mac` et `linux` commentés, et le code de la coquille
distingue déjà `process.platform` (menu). Il suffit d'ajouter le bloc, une icône `.icns` sur macOS,
et un script `dist:mac` / `dist:linux`.
