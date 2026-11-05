import { area } from "./define";

/** Automatic updates: the notice, and the controls in Settings (desktop app only). */
export const up = area(
  {
    "up.title": "Updates",
    "up.available": "New version available",
    "up.availableBody": "Atlas OS {latest} is ready to download (you have {current}).",
    "up.download": "Download",
    "up.downloading": "Downloading… {percent} %",
    "up.ready": "Update ready",
    "up.readyBody": "Restart to install Atlas OS {latest}. Your data stays where it is.",
    "up.install": "Restart and install",
    "up.later": "Later",
    "up.autoTitle": "Check for updates automatically",
    "up.autoSub":
      "At launch, then every few hours. Only asks GitHub for the latest version number: nothing of yours is sent.",
    "up.version": "Version {current}",
    "up.checkNow": "Check now",
    "up.checking": "Checking…",
    "up.status.idle": "Not checked yet.",
    "up.status.checking": "Checking for a newer version…",
    "up.status.uptodate": "Atlas OS is up to date.",
    "up.status.available": "Version {latest} is available.",
    "up.status.downloading": "Downloading version {latest}… {percent} %",
    "up.status.ready": "Version {latest} is ready: restart to install it.",
    "up.err.offline": "No internet connection, so the check could not run. Try again later.",
    "up.err.not_found": "No published version was found yet.",
    "up.err.interrupted":
      "The download was interrupted. Your data is untouched; try the download again.",
    "up.err.corrupt": "The downloaded file is incomplete. Try the download again.",
    "up.err.failed": "The check failed. Try again in a moment.",
  },
  {
    "up.title": "Mises à jour",
    "up.available": "Nouvelle version disponible",
    "up.availableBody": "Atlas OS {latest} est prêt à être téléchargé (tu as la {current}).",
    "up.download": "Télécharger",
    "up.downloading": "Téléchargement… {percent} %",
    "up.ready": "Mise à jour prête",
    "up.readyBody": "Redémarre pour installer Atlas OS {latest}. Tes données restent en place.",
    "up.install": "Redémarrer et installer",
    "up.later": "Plus tard",
    "up.autoTitle": "Vérifier les mises à jour automatiquement",
    "up.autoSub":
      "Au lancement, puis toutes les quelques heures. Demande seulement à GitHub le numéro de la dernière version : rien de toi n’est envoyé.",
    "up.version": "Version {current}",
    "up.checkNow": "Vérifier maintenant",
    "up.checking": "Vérification…",
    "up.status.idle": "Pas encore vérifié.",
    "up.status.checking": "Recherche d’une version plus récente…",
    "up.status.uptodate": "Atlas OS est à jour.",
    "up.status.available": "La version {latest} est disponible.",
    "up.status.downloading": "Téléchargement de la version {latest}… {percent} %",
    "up.status.ready": "La version {latest} est prête : redémarre pour l’installer.",
    "up.err.offline":
      "Pas de connexion à Internet : la vérification n’a pas pu se faire. Réessaie plus tard.",
    "up.err.not_found": "Aucune version publiée n’a été trouvée pour l’instant.",
    "up.err.interrupted":
      "Le téléchargement a été interrompu. Tes données sont intactes ; relance le téléchargement.",
    "up.err.corrupt": "Le fichier téléchargé est incomplet. Relance le téléchargement.",
    "up.err.failed": "La vérification a échoué. Réessaie dans un instant.",
  },
);
