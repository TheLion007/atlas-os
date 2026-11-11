# Changelog

Versions are listed newest first. Each entry is in English, then in French.
Les versions sont listées de la plus récente à la plus ancienne. Chaque entrée est en anglais, puis en français.

## 1.2.0 — 2026-11-11 — Contextual assistant / Assistant contextuel

### English

- **The assistant is now contextual: opened from a project, a sub-project or a task, it acts only inside that element.** A badge at the top of the panel shows the active context (for example "Roblox game › Map"), with a **Global mode** button to act on the whole application again. Opened anywhere else, it behaves as before.
- From a project it creates sub-projects or tasks; from a sub-project, tasks or sub-sub-projects; from a task, **sub-tasks**. It no longer creates duplicate projects and never goes looking elsewhere.
- It tells a sub-project (a set of tasks with its own goal, like "Map management") from a task (one precise action to tick, like "Draw the terrain"), and you can switch a proposed item from one to the other.
- Questions and quick answers (week, urgent, day) also stay inside the context.
- Tasks can now hold sub-tasks. Your data is migrated automatically; everything stays 100% local.

### Français

- **L'assistant est maintenant contextuel : ouvert depuis un projet, un sous-projet ou une tâche, il agit uniquement dans cet élément.** Un badge en haut du panneau indique le contexte actif (par exemple « Jeu Roblox › Map »), avec un bouton **Mode global** pour agir de nouveau sur toute l'application. Ouvert ailleurs, il se comporte comme avant.
- Depuis un projet, il crée des sous-projets ou des tâches ; depuis un sous-projet, des tâches ou des sous-sous-projets ; depuis une tâche, des **sous-tâches**. Il ne crée plus de projets en double et ne va jamais chercher ailleurs.
- Il distingue un sous-projet (un ensemble de tâches avec un objectif propre, comme « Gestion de la map ») d'une tâche (une action précise à cocher, comme « Dessiner le terrain »), et tu peux basculer un élément proposé de l'un à l'autre.
- Les questions et les réponses rapides (semaine, urgent, journée) restent aussi dans le contexte.
- Une tâche peut maintenant contenir des sous-tâches. Tes données sont migrées automatiquement ; tout reste 100 % local.

## 1.1.1 — 2026-11-09 — Sub-projects / Sous-projets

### English

- A sub-project now has the same interface as a project: the same header and the same tabs (Tasks, Notes, Vault, Timeline, Budget and risks, plus the Overview).
- A task attached to two containers (for example a project and its sub-project) is no longer counted twice in the project's progress.

### Français

- Un sous-projet a maintenant la même interface qu'un projet : le même en-tête et les mêmes onglets (Tâches, Notes, Coffre, Timeline, Budget et risques, plus l'Aperçu).
- Une tâche rattachée à deux conteneurs (par exemple un projet et son sous-projet) n'est plus comptée deux fois dans la progression du projet.

## 1.1.0 — 2026-11-09 — "My data" / « Mes données »

### English

- **Export and import.** One `.atlasbackup` file with everything (projects, work history, Vault documents and their files, timer, settings, mascot, preferences) and a `manifest.json` (version, date, device name, counts). Import checks the file, shows its content, and offers **Merge** (adds what is missing, the most recent wins) or **Replace** (explicit confirmation). A safety copy is always made first, and a failed import restores the previous state.
- **Data folder of your choice** (OneDrive, Google Drive, Dropbox, Syncthing…): move your data or use the data already there. A lock file warns "already open on [device]" with read-only, force or quit; it is refreshed every 30 s and considered stale after 2 minutes. Changes made by another device are detected.
- **Daily automatic backup** in a folder you choose, keeping the last 7.
- Clear French messages for a corrupted file, an unreachable folder or a version that is too recent. Everything stays 100% local.
- Known limits: cloud sync not tested with a real service; activity log and preferences are not merged; after a crash the lock stays up to 2 minutes.

### Français

- **Export et import.** Un seul fichier `.atlasbackup` avec tout (projets, historique de travail, documents du Coffre et leurs fichiers, minuteur, réglages, mascotte, préférences) et un `manifest.json` (version, date, nom de l'appareil, nombres). L'import vérifie le fichier, montre son contenu, et propose **Fusionner** (ajoute ce qui manque, le plus récent l'emporte) ou **Remplacer** (confirmation explicite). Une copie de sécurité est toujours faite avant, et un import raté remet l'état précédent.
- **Dossier de données au choix** (OneDrive, Google Drive, Dropbox, Syncthing…) : déplacer tes données ou utiliser celles déjà présentes. Un fichier verrou prévient « déjà ouvert sur [appareil] » avec lecture seule, forcer ou quitter ; il est rafraîchi toutes les 30 s et périmé après 2 minutes. Les changements faits par un autre appareil sont détectés.
- **Sauvegarde automatique quotidienne** dans un dossier de ton choix, en gardant les 7 dernières.
- Messages clairs en français pour un fichier corrompu, un dossier inaccessible ou une version trop récente. Tout reste 100 % local.
- Limites connues : synchro cloud non testée avec un vrai service ; journal d'activité et préférences non fusionnés ; après un plantage le verrou reste actif jusqu'à 2 minutes.

## 1.0.3

See / Voir `docs/release-notes/v1.0.3.md`.
