import { area } from "./define";

/** "Mes données": export, import, the data folder, the daily backup, read-only mode. */
export const md = area(
  {
    "st.nav.data": "My data",
    "md.title": "My data",
    "md.sub": "Back up, move or share your data between PCs.",
    // export
    "md.export.title": "Export my data",
    "md.export.sub":
      "One .atlasbackup file with everything: projects, work history, Vault documents and their files, timer, settings, mascot and preferences.",
    "md.export.button": "Export my data",
    "md.export.working": "Exporting…",
    "md.export.done": "Backup saved.",
    "md.export.where": "File: {path}",
    "md.export.size": "{size} · {items} items",
    // import
    "md.import.title": "Import data",
    "md.import.sub":
      "Choose an .atlasbackup file. It is checked first, and a safety copy of your current data is made before anything changes.",
    "md.import.button": "Import data",
    "md.import.checking": "Checking the file…",
    "md.import.summary": "What this backup holds",
    "md.import.from": "Made on {date} on {device}, with Atlas OS {version}.",
    "md.import.migrated":
      "This backup comes from an older version: it is brought up to date automatically.",
    "md.import.mode": "How do you want to import it?",
    "md.import.merge": "Merge with my current data",
    "md.import.mergeHint":
      "Adds what is missing. When the same item exists on both sides, the most recent one is kept. Nothing is deleted.",
    "md.import.replace": "Replace all my data",
    "md.import.replaceHint":
      "Your current data is replaced by the backup's. Atlas OS restarts to finish.",
    "md.import.cancel": "Cancel",
    "md.import.replaceTitle": "Replace all your data?",
    "md.import.replaceBody":
      "Everything you have now will be replaced by the content of this backup. This cannot be undone from the app. A safety copy of your current data is saved first, so you can still go back by importing it.",
    "md.import.replaceConfirm": "Yes, replace my data",
    "md.import.working": "Importing…",
    "md.import.safety": "Safety copy of your previous data: {path}",
    "md.import.mergeDone":
      "Done: {added} added, {updated} updated with a more recent version, {kept} already up to date.",
    "md.import.mergeSkipped": "{count} links could not be merged and were left out.",
    "md.import.replaceDone": "Your data is ready. Atlas OS is restarting…",
    "md.import.rolledBack":
      "The imported data did not start, so your previous data was put back. Safety copy: {path}",
    "md.import.applied": "Import finished. Safety copy of your previous data: {path}",
    // counts
    "md.c.plans": "{count} plan | {count} plans",
    "md.c.projects": "{count} project | {count} projects",
    "md.c.subProjects": "{count} sub-project | {count} sub-projects",
    "md.c.tasks": "{count} task | {count} tasks",
    "md.c.milestones": "{count} deadline | {count} deadlines",
    "md.c.decisions": "{count} decision | {count} decisions",
    "md.c.risks": "{count} risk | {count} risks",
    "md.c.notes": "{count} note | {count} notes",
    "md.c.documents": "{count} document | {count} documents",
    "md.c.budgets": "{count} budget | {count} budgets",
    "md.c.events": "{count} event | {count} events",
    "md.c.others": "{count} other item | {count} other items",
    "md.c.links": "{count} link | {count} links",
    "md.c.workHistory": "{count} work history entry | {count} work history entries",
    "md.c.preferences": "{count} preference set | {count} preference sets",
    // errors
    "md.err.not_a_backup": "This file is not an Atlas OS backup.",
    "md.err.corrupt": "This backup file is damaged or incomplete. Nothing was changed.",
    "md.err.newer_version":
      "This backup was made by a newer version of Atlas OS. Update Atlas OS to import it.",
    "md.err.unreadable_file":
      "This file cannot be read. Check that it still exists and is not in use.",
    "md.err.unreadable_database":
      "The data inside this backup cannot be read. It may come from an incompatible version. Nothing was changed.",
    "md.err.failed": "The operation failed. Nothing was changed.",
    "md.err.read_only": "Atlas OS is open in read-only mode: this is not possible.",
    // location
    "md.loc.title": "Data location",
    "md.loc.sub":
      "The folder where Atlas OS keeps all its data. Pick a OneDrive, Google Drive, Dropbox or Syncthing folder to keep two PCs in step.",
    "md.loc.current": "Current folder",
    "md.loc.default": "Default folder",
    "md.loc.change": "Change…",
    "md.loc.back": "Back to the default folder",
    "md.loc.open": "Open",
    "md.loc.dialogTitle": "Use this folder for your data?",
    "md.loc.target": "New folder: {path}",
    "md.loc.hasData": "This folder already holds Atlas OS data (for example from your other PC).",
    "md.loc.empty": "This folder holds no Atlas OS data yet.",
    "md.loc.use": "Use the data already in this folder",
    "md.loc.useHint":
      "Atlas OS will open the data found there. Your current data stays where it is, untouched.",
    "md.loc.useEmpty": "Use this folder as it is",
    "md.loc.useEmptyHint":
      "Atlas OS starts empty there. Your current data stays where it is, untouched.",
    "md.loc.move": "Move my data here",
    "md.loc.moveHint":
      "Your data is copied here and checked, then removed from the old folder. Atlas OS restarts.",
    "md.loc.replace": "Replace this folder's data with mine",
    "md.loc.replaceHint":
      "The data found in this folder is set aside in a “data.avant-remplacement” folder (not deleted), then yours is copied here. Atlas OS restarts.",
    "md.loc.cancel": "Cancel",
    "md.loc.working": "Moving your data…",
    "md.loc.restarting": "Done. Atlas OS is restarting on the new folder…",
    "md.loc.err.not_writable":
      "Atlas OS cannot write in this folder. Pick another one, or check the folder's permissions.",
    "md.loc.err.same": "This is already the data folder.",
    "md.loc.err.nested": "Pick a folder that is not inside the current data folder.",
    "md.loc.err.not_absolute": "Pick a folder from the list.",
    "md.loc.err.target_has_data":
      "This folder already holds data. Choose another option, or another folder.",
    "md.loc.err.copy_failed":
      "The data could not be copied completely. Nothing was changed: your data is still in the old folder.",
    "md.loc.err.read_only": "Atlas OS is open in read-only mode: the folder cannot be changed now.",
    "md.loc.err.failed": "The folder could not be changed. Nothing was changed.",
    // automatic backup
    "md.auto.title": "Automatic backup",
    "md.auto.sub":
      "Atlas OS makes one .atlasbackup a day in the folder you choose, and keeps the last 7. Older ones are deleted automatically.",
    "md.auto.switch": "Back up automatically every day",
    "md.auto.folder": "Backup folder",
    "md.auto.choose": "Choose the folder…",
    "md.auto.none": "No folder chosen yet.",
    "md.auto.now": "Back up now",
    "md.auto.last": "Last backup: {path}",
    "md.auto.never": "No automatic backup yet.",
    "md.auto.err.folder_unreachable":
      "The backup folder is not reachable. Check the disk or the sync service; the backup will be retried.",
    "md.auto.err.failed": "The last automatic backup failed. It will be retried.",
    "md.auto.err.not_writable": "Atlas OS cannot write in this folder. Pick another one.",
    "md.auto.err.no_folder": "Choose a folder first.",
    "md.auto.running": "Backing up…",
    "md.auto.done": "Backup saved.",
    // read-only
    "md.ro.banner":
      "Read-only mode: another PC has these data open. You can look, but nothing you change here is saved.",
    // shared
    "md.close": "Close",
    "md.progress": "Progress",
    "md.mb": "{size} MB",
    "md.kb": "{size} KB",
    "md.restart": "Restart Atlas OS",
  },
  {
    "st.nav.data": "Mes données",
    "md.title": "Mes données",
    "md.sub": "Sauvegarder, déplacer ou partager tes données entre plusieurs PC.",
    "md.export.title": "Exporter mes données",
    "md.export.sub":
      "Un seul fichier .atlasbackup avec tout : projets, historique de travail, documents du Coffre avec leurs fichiers, minuteur, réglages, mascotte et préférences.",
    "md.export.button": "Exporter mes données",
    "md.export.working": "Export en cours…",
    "md.export.done": "Sauvegarde enregistrée.",
    "md.export.where": "Fichier : {path}",
    "md.export.size": "{size} · {items} éléments",
    "md.import.title": "Importer des données",
    "md.import.sub":
      "Choisis un fichier .atlasbackup. Il est vérifié d’abord, et une sauvegarde de sécurité de tes données actuelles est faite avant tout changement.",
    "md.import.button": "Importer des données",
    "md.import.checking": "Vérification du fichier…",
    "md.import.summary": "Ce que contient cette sauvegarde",
    "md.import.from": "Faite le {date} sur {device}, avec Atlas OS {version}.",
    "md.import.migrated":
      "Cette sauvegarde vient d’une version plus ancienne : elle est mise à jour automatiquement.",
    "md.import.mode": "Comment veux-tu l’importer ?",
    "md.import.merge": "Fusionner avec mes données actuelles",
    "md.import.mergeHint":
      "Ajoute ce qui manque. Quand un même élément existe des deux côtés, le plus récent est gardé. Rien n’est supprimé.",
    "md.import.replace": "Remplacer toutes mes données",
    "md.import.replaceHint":
      "Tes données actuelles sont remplacées par celles de la sauvegarde. Atlas OS redémarre pour terminer.",
    "md.import.cancel": "Annuler",
    "md.import.replaceTitle": "Remplacer toutes tes données ?",
    "md.import.replaceBody":
      "Tout ce que tu as maintenant sera remplacé par le contenu de cette sauvegarde. Impossible d’annuler depuis l’application. Une sauvegarde de sécurité de tes données actuelles est enregistrée avant, pour pouvoir revenir en arrière en l’important.",
    "md.import.replaceConfirm": "Oui, remplacer mes données",
    "md.import.working": "Importation en cours…",
    "md.import.safety": "Sauvegarde de sécurité de tes données précédentes : {path}",
    "md.import.mergeDone":
      "Terminé : {added} ajoutés, {updated} mis à jour avec une version plus récente, {kept} déjà à jour.",
    "md.import.mergeSkipped":
      "{count} liens n’ont pas pu être fusionnés et ont été laissés de côté.",
    "md.import.replaceDone": "Tes données sont prêtes. Atlas OS redémarre…",
    "md.import.rolledBack":
      "Les données importées n’ont pas démarré : tes données précédentes ont été remises en place. Sauvegarde de sécurité : {path}",
    "md.import.applied":
      "Importation terminée. Sauvegarde de sécurité de tes données précédentes : {path}",
    "md.c.plans": "{count} plan | {count} plans",
    "md.c.projects": "{count} projet | {count} projets",
    "md.c.subProjects": "{count} sous-projet | {count} sous-projets",
    "md.c.tasks": "{count} tâche | {count} tâches",
    "md.c.milestones": "{count} échéance | {count} échéances",
    "md.c.decisions": "{count} décision | {count} décisions",
    "md.c.risks": "{count} risque | {count} risques",
    "md.c.notes": "{count} note | {count} notes",
    "md.c.documents": "{count} document | {count} documents",
    "md.c.budgets": "{count} budget | {count} budgets",
    "md.c.events": "{count} événement | {count} événements",
    "md.c.others": "{count} autre élément | {count} autres éléments",
    "md.c.links": "{count} lien | {count} liens",
    "md.c.workHistory":
      "{count} entrée d’historique de travail | {count} entrées d’historique de travail",
    "md.c.preferences": "{count} jeu de préférences | {count} jeux de préférences",
    "md.err.not_a_backup": "Ce fichier n’est pas une sauvegarde Atlas OS.",
    "md.err.corrupt": "Ce fichier de sauvegarde est abîmé ou incomplet. Rien n’a été modifié.",
    "md.err.newer_version":
      "Cette sauvegarde a été faite par une version plus récente d’Atlas OS. Mets Atlas OS à jour pour l’importer.",
    "md.err.unreadable_file":
      "Ce fichier est illisible. Vérifie qu’il existe toujours et qu’il n’est pas utilisé.",
    "md.err.unreadable_database":
      "Les données de cette sauvegarde sont illisibles. Elles viennent peut-être d’une version incompatible. Rien n’a été modifié.",
    "md.err.failed": "L’opération a échoué. Rien n’a été modifié.",
    "md.err.read_only": "Atlas OS est ouvert en lecture seule : ce n’est pas possible.",
    "md.loc.title": "Emplacement des données",
    "md.loc.sub":
      "Le dossier où Atlas OS garde toutes ses données. Choisis un dossier OneDrive, Google Drive, Dropbox ou Syncthing pour garder deux PC à jour.",
    "md.loc.current": "Dossier actuel",
    "md.loc.default": "Dossier par défaut",
    "md.loc.change": "Changer…",
    "md.loc.back": "Revenir au dossier par défaut",
    "md.loc.open": "Ouvrir",
    "md.loc.dialogTitle": "Utiliser ce dossier pour tes données ?",
    "md.loc.target": "Nouveau dossier : {path}",
    "md.loc.hasData":
      "Ce dossier contient déjà des données Atlas OS (par exemple de ton autre PC).",
    "md.loc.empty": "Ce dossier ne contient pas encore de données Atlas OS.",
    "md.loc.use": "Utiliser les données déjà présentes dans ce dossier",
    "md.loc.useHint":
      "Atlas OS ouvrira les données qui s’y trouvent. Tes données actuelles restent où elles sont, intactes.",
    "md.loc.useEmpty": "Utiliser ce dossier tel quel",
    "md.loc.useEmptyHint":
      "Atlas OS démarre à vide à cet endroit. Tes données actuelles restent où elles sont, intactes.",
    "md.loc.move": "Déplacer mes données ici",
    "md.loc.moveHint":
      "Tes données sont copiées ici et vérifiées, puis retirées de l’ancien dossier. Atlas OS redémarre.",
    "md.loc.replace": "Remplacer les données de ce dossier par les miennes",
    "md.loc.replaceHint":
      "Les données trouvées dans ce dossier sont mises de côté dans un dossier « data.avant-remplacement » (pas supprimées), puis les tiennes y sont copiées. Atlas OS redémarre.",
    "md.loc.cancel": "Annuler",
    "md.loc.working": "Déplacement de tes données…",
    "md.loc.restarting": "Terminé. Atlas OS redémarre sur le nouveau dossier…",
    "md.loc.err.not_writable":
      "Atlas OS ne peut pas écrire dans ce dossier. Choisis-en un autre, ou vérifie les droits du dossier.",
    "md.loc.err.same": "C’est déjà le dossier des données.",
    "md.loc.err.nested": "Choisis un dossier qui ne soit pas dans le dossier de données actuel.",
    "md.loc.err.not_absolute": "Choisis un dossier dans la fenêtre de sélection.",
    "md.loc.err.target_has_data":
      "Ce dossier contient déjà des données. Choisis une autre option, ou un autre dossier.",
    "md.loc.err.copy_failed":
      "Les données n’ont pas pu être copiées en entier. Rien n’a été changé : tes données sont toujours dans l’ancien dossier.",
    "md.loc.err.read_only":
      "Atlas OS est ouvert en lecture seule : le dossier ne peut pas être changé maintenant.",
    "md.loc.err.failed": "Le dossier n’a pas pu être changé. Rien n’a été modifié.",
    "md.auto.title": "Sauvegarde automatique",
    "md.auto.sub":
      "Atlas OS fait une sauvegarde .atlasbackup par jour dans le dossier que tu choisis, et garde les 7 dernières. Les plus anciennes sont supprimées automatiquement.",
    "md.auto.switch": "Sauvegarder automatiquement chaque jour",
    "md.auto.folder": "Dossier des sauvegardes",
    "md.auto.choose": "Choisir le dossier…",
    "md.auto.none": "Aucun dossier choisi pour l’instant.",
    "md.auto.now": "Sauvegarder maintenant",
    "md.auto.last": "Dernière sauvegarde : {path}",
    "md.auto.never": "Pas encore de sauvegarde automatique.",
    "md.auto.err.folder_unreachable":
      "Le dossier des sauvegardes est inaccessible. Vérifie le disque ou le service de synchronisation ; nouvelle tentative plus tard.",
    "md.auto.err.failed":
      "La dernière sauvegarde automatique a échoué. Nouvelle tentative plus tard.",
    "md.auto.err.not_writable": "Atlas OS ne peut pas écrire dans ce dossier. Choisis-en un autre.",
    "md.auto.err.no_folder": "Choisis d’abord un dossier.",
    "md.auto.running": "Sauvegarde en cours…",
    "md.auto.done": "Sauvegarde enregistrée.",
    "md.ro.banner":
      "Mode lecture seule : un autre PC a ces données ouvertes. Tu peux regarder, mais rien de ce que tu changes ici n’est enregistré.",
    "md.close": "Fermer",
    "md.progress": "Progression",
    "md.mb": "{size} Mo",
    "md.kb": "{size} Ko",
    "md.restart": "Redémarrer Atlas OS",
  },
);
