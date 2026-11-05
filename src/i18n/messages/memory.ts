import { area } from "./define";

/** The Memory Storage / Memory Core experience (ADR 0002; the Memory Storage brief). */
export const memory = area(
  {
    "nav.memory": "Memory",
    "memory.title": "Memory",
    "memory.count": "{count} memories",
    "memory.searchPlaceholder": "Search memories…",

    "memory.view.list": "List",
    "memory.view.grid": "Grid",
    "memory.view.graph": "Graph",
    "memory.graph.aria":
      "Memory graph: {memories} memories in {clusters} clusters, {relations} relations",
    "memory.graph.unfiled": "Unfiled",
    "memory.graph.composing": "Composing the memory graph…",
    "memory.graph.hint":
      "Drag to move · scroll to zoom · click a memory to explore it · double-click to open",
    "memory.graph.hintTouch": "Drag to move · pinch to zoom · tap a memory",
    "memory.graph.legend":
      "Clusters are projects · fibres are real relations · brighter means stronger",

    "memory.filter.project": "Project",
    "memory.filter.allProjects": "All projects",
    "memory.filter.noProject": "No project",
    "memory.filter.type": "Type",
    "memory.filter.allTypes": "All types",
    "memory.filter.confidence": "Confidence",
    "memory.filter.allConfidence": "Any confidence",
    "memory.filter.status": "Status",
    "memory.filter.statusActive": "Active",
    "memory.filter.statusAll": "Include archived",

    "memory.sort.label": "Sort",
    "memory.sort.updated": "Recently updated",
    "memory.sort.created": "Recently created",
    "memory.sort.alphabetical": "Alphabetical",
    "memory.sort.confidence": "Confidence",
    "memory.sort.relevance": "Relevance",

    "memory.col.title": "Memory",
    "memory.col.type": "Type",
    "memory.col.context": "Context",
    "memory.col.confidence": "Confidence",
    "memory.col.updated": "Updated",
    "memory.col.provenance": "Source",
    "memory.col.relations": "Related",

    "memory.secondaryMore": "+{count} more",
    "memory.noContext": "No project context",
    "memory.addContext": "Add project context",
    "memory.context": "Context",
    "memory.provenance": "Provenance",
    "memory.derivedFrom": "Derived from",
    "memory.supportedBy": "Supported by",
    "memory.source.user": "Entered directly by you.",
    "memory.source.ai_proposal": "Proposed by the assistant and accepted by you.",
    "memory.source.import": "Brought in from an import.",

    "memory.health.needsReview": "Needs review",
    "memory.health.showFlagged": "Flagged only",
    "memory.health.duplicate": "{count} possible duplicate | {count} possible duplicates",
    "memory.health.low_confidence": "{count} low confidence",
    "memory.health.stale": "{count} not updated in a while",
    "memory.health.orphaned": "{count} orphaned | {count} orphaned",
    "memory.health.possible_contradiction":
      "{count} possible contradiction | {count} possible contradictions",
    "memory.health.unused": "{count} never retrieved | {count} never retrieved",
    "memory.health.hint": "A flag is a prompt to review — Atlas never resolves one on its own.",

    "empty.memory.title": "No memories yet",
    "empty.memory.body":
      "Atlas builds this knowledge layer as you create projects, notes, decisions and other connected information — or add one directly.",
    "empty.memoryFiltered": "No memories match these filters.",
  },
  {
    "nav.memory": "Mémoire",
    "memory.title": "Mémoire",
    "memory.count": "{count} mémoires",
    "memory.searchPlaceholder": "Rechercher des mémoires…",

    "memory.view.list": "Liste",
    "memory.view.grid": "Grille",
    "memory.view.graph": "Graphe",
    "memory.graph.aria":
      "Graphe de la mémoire : {memories} mémoires en {clusters} groupes, {relations} relations",
    "memory.graph.unfiled": "Sans projet",
    "memory.graph.composing": "Composition du graphe de la mémoire…",
    "memory.graph.hint":
      "Glisser pour se déplacer · molette pour zoomer · cliquer une mémoire pour l’explorer · double-clic pour l’ouvrir",
    "memory.graph.hintTouch": "Glisser pour se déplacer · pincer pour zoomer · toucher une mémoire",
    "memory.graph.legend":
      "Les groupes sont des projets · les fibres sont de vraies relations · plus lumineux = plus fort",

    "memory.filter.project": "Projet",
    "memory.filter.allProjects": "Tous les projets",
    "memory.filter.noProject": "Sans projet",
    "memory.filter.type": "Type",
    "memory.filter.allTypes": "Tous les types",
    "memory.filter.confidence": "Confiance",
    "memory.filter.allConfidence": "Toute confiance",
    "memory.filter.status": "Statut",
    "memory.filter.statusActive": "Actives",
    "memory.filter.statusAll": "Inclure les archivées",

    "memory.sort.label": "Trier",
    "memory.sort.updated": "Mise à jour récente",
    "memory.sort.created": "Création récente",
    "memory.sort.alphabetical": "Alphabétique",
    "memory.sort.confidence": "Confiance",
    "memory.sort.relevance": "Pertinence",

    "memory.col.title": "Mémoire",
    "memory.col.type": "Type",
    "memory.col.context": "Contexte",
    "memory.col.confidence": "Confiance",
    "memory.col.updated": "Mise à jour",
    "memory.col.provenance": "Source",
    "memory.col.relations": "Liées",

    "memory.secondaryMore": "+{count} de plus",
    "memory.noContext": "Aucun contexte projet",
    "memory.addContext": "Ajouter un contexte projet",
    "memory.context": "Contexte",
    "memory.provenance": "Provenance",
    "memory.derivedFrom": "Dérivé de",
    "memory.supportedBy": "Étayé par",
    "memory.source.user": "Saisie directement par vous.",
    "memory.source.ai_proposal": "Proposée par l’assistant et acceptée par vous.",
    "memory.source.import": "Importée depuis une autre source.",

    "memory.health.needsReview": "À vérifier",
    "memory.health.showFlagged": "Signalées uniquement",
    "memory.health.duplicate": "{count} doublon possible | {count} doublons possibles",
    "memory.health.low_confidence": "{count} confiance faible",
    "memory.health.stale": "{count} non mise à jour depuis longtemps",
    "memory.health.orphaned": "{count} orpheline | {count} orphelines",
    "memory.health.possible_contradiction":
      "{count} contradiction possible | {count} contradictions possibles",
    "memory.health.unused": "{count} jamais consultée | {count} jamais consultées",
    "memory.health.hint": "Un signalement invite à vérifier — Atlas ne tranche jamais seul.",

    "empty.memory.title": "Pas encore de mémoire",
    "empty.memory.body":
      "Atlas construit cette couche de connaissance au fil de vos projets, notes, décisions et autres informations liées — ou ajoutez-en une directement.",
    "empty.memoryFiltered": "Aucune mémoire ne correspond à ces filtres.",
  },
);
