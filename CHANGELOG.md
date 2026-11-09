# Changelog

Versions are listed newest first. Each entry is in English, then in French.
Les versions sont listées de la plus récente à la plus ancienne. Chaque entrée est en anglais, puis en français.

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
