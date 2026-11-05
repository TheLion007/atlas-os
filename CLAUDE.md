@AGENTS.md

# Règle visuelle absolue

**L'artefact Claude Design est la référence visuelle absolue.** Ne jamais réintroduire un élément, un bouton, un panneau ou un style de l'ancienne interface à la place de celui de l'artefact. Seuls la logique, les données et les fonctionnalités de l'ancienne application sont conservées.

- En cas de conflit entre l'ancienne application et l'artefact, c'est l'artefact qui gagne.
- Si l'artefact ne contient pas un élément, ne pas l'ajouter de sa propre initiative.
- La barre latérale contient **exactement** les 10 entrées de l'artefact (Accueil, Projets, Calendrier, Graphe, Carte, Coffre, Minuteur, Notes, Historique, Paramètres), dans cet ordre (`src/components/shell/artifact-nav.ts`, protégé par `sidebar-artifact.test.tsx`). Les autres écrans (Chronologie, Mémoire, Plans, Tâches, Finance, Décisions, Risques) sont accessibles par la palette Ctrl+K et par « Autres vues » dans les Paramètres, jamais dans la barre.
- Les thèmes (Indigo par défaut, Lagon, Violet) et les profils sonores (Doux par défaut, Normal, Cristallin) sont des réglages validés : ne pas les supprimer.
- Avant chaque commit : `npx tsc --noEmit`, `npx eslint src tests` et `npx vitest run`.
