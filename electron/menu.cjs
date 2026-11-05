"use strict";

const { Menu } = require("electron");

/**
 * The application menu, kept short. Editing commands are here because text fields need them.
 * The developer tools only appear in development. Built on `process.platform` so macOS and Linux
 * (later) get their usual app menu without another file.
 */
function buildMenu({ app, packaged, repoUrl, openExternal, showAbout, openDataFolder }) {
  const mac = process.platform === "darwin";
  const template = [
    ...(mac ? [{ role: "appMenu" }] : []),
    {
      label: "Fichier",
      submenu: [
        mac
          ? { role: "close", label: "Fermer la fenêtre" }
          : { role: "quit", label: "Quitter Atlas OS" },
      ],
    },
    {
      label: "Édition",
      submenu: [
        { role: "undo", label: "Annuler" },
        { role: "redo", label: "Rétablir" },
        { type: "separator" },
        { role: "cut", label: "Couper" },
        { role: "copy", label: "Copier" },
        { role: "paste", label: "Coller" },
        { role: "selectAll", label: "Tout sélectionner" },
      ],
    },
    {
      label: "Affichage",
      submenu: [
        { role: "resetZoom", label: "Taille normale" },
        { role: "zoomIn", label: "Agrandir" },
        { role: "zoomOut", label: "Réduire" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Plein écran" },
        ...(packaged
          ? []
          : [
              { type: "separator" },
              { role: "reload", label: "Recharger" },
              { role: "forceReload", label: "Recharger (sans cache)" },
              { role: "toggleDevTools", label: "Outils de développement" },
            ]),
      ],
    },
    {
      label: "Fenêtre",
      submenu: [
        { role: "minimize", label: "Réduire la fenêtre" },
        ...(mac ? [{ role: "zoom" }] : []),
      ],
    },
    {
      label: "Aide",
      submenu: [
        { label: "Ouvrir le dossier des données", click: openDataFolder },
        { label: "Signaler un problème", click: () => openExternal(`${repoUrl}/issues/new`) },
        { type: "separator" },
        { label: `À propos d’Atlas OS (${app.getVersion()})`, click: showAbout },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
