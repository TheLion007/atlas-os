import { EXAMPLE_TAG } from "@/domain/creation";
import type { DocumentKind, EdgeKind } from "@/domain/enums";
import type { CreateObjectInput } from "@/domain/schemas";
import type { Seed, SeedActivity, SeedEdge, SeedObject } from "./seed-types";

/**
 * The public example workspace: neutral, French, and entirely invented — a small web studio with
 * five projects, so the demo reads as a real week of work without anyone's life in it. It is the
 * only data the demo (fixtures) mode shows. A person's own database is a separate, local thing
 * that never enters the repository (`/data/` is ignored).
 */
export const NEUTRAL_TODAY = "2026-10-31";

/** What the work journal holds for the demo: a piece of progress some days ago. */
export interface SeedProgress {
  /** The object it concerns (a seed key), or null for an entry with no object. */
  key: string | null;
  /** The project it counts for (a seed key). */
  project: string;
  kind: "task_done" | "note_created" | "file_added";
  daysAgo: number;
}

export interface NeutralSeed extends Seed {
  progress: SeedProgress[];
}

const TAG = EXAMPLE_TAG;

export function neutralSeed(): NeutralSeed {
  const objects: SeedObject[] = [];
  const edges: SeedEdge[] = [];
  const add = (key: string, input: CreateObjectInput) =>
    objects.push({ key, input: { ...input, tags: [TAG, ...(input.tags ?? [])] } });
  const edge = (kind: EdgeKind, from: string, to: string) => edges.push({ kind, from, to });

  add("pl_2026", {
    type: "plan",
    title: "Feuille de route 2026",
    details: { description: "Les cinq chantiers de l’automne pour le studio." },
  });

  const project = (
    key: string,
    title: string,
    color: string,
    kind: string,
    description: string,
    priority: number,
    start: string,
    target: string,
    budget: number,
  ) => {
    add(key, {
      type: "project",
      title,
      color,
      details: {
        description,
        kind,
        priority,
        startDate: start,
        targetDate: target,
        budgetAmount: budget,
        budgetCurrency: "EUR",
      },
    });
    edge("contains", "pl_2026", key);
  };
  project(
    "p_web",
    "Refonte du site web",
    "clay",
    "Web",
    "Nouvelle arborescence, système de design et migration de 140 pages de contenu.",
    1,
    "2026-09-01",
    "2026-11-14",
    18000,
  );
  project(
    "p_v21",
    "Lancement v2.1",
    "sage",
    "Produit",
    "Synchronisation hors ligne, export PDF et nouveau tableau de bord.",
    1,
    "2026-09-15",
    "2026-11-28",
    24000,
  );
  project(
    "p_doc",
    "Documentation technique",
    "slate",
    "Docs",
    "Guide de l’API, tutoriels d’installation et référence de la ligne de commande.",
    2,
    "2026-08-20",
    "2026-12-05",
    6000,
  );
  project(
    "p_db",
    "Migration de la base de données",
    "amber",
    "Infra",
    "Passage au schéma v3 sans interruption de service.",
    2,
    "2026-10-05",
    "2026-12-19",
    9500,
  );
  project(
    "p_ux",
    "Ateliers utilisateurs du T4",
    "purple",
    "Recherche",
    "Huit entretiens et deux ateliers pour préparer la feuille de route 2027.",
    3,
    "2026-10-12",
    "2026-12-10",
    3200,
  );

  const sub = (key: string, parent: string, title: string) => {
    add(key, { type: "sub_project", title, details: { description: "" } });
    edge("contains", parent, key);
  };
  sub("s_web_a", "p_web", "Pages produit");
  sub("s_web_b", "p_web", "Blog et ressources");
  sub("s_web_c", "p_web", "Accessibilité");
  sub("s_v21_a", "p_v21", "Synchronisation hors ligne");
  sub("s_v21_b", "p_v21", "Export PDF");
  sub("s_v21_c", "p_v21", "Tableau de bord");
  sub("s_doc_a", "p_doc", "Guide de l’API");
  sub("s_doc_b", "p_doc", "Tutoriels");
  sub("s_db_a", "p_db", "Schéma v3");
  sub("s_db_b", "p_db", "Scripts de migration");
  sub("s_ux_a", "p_ux", "Recrutement");
  sub("s_ux_b", "p_ux", "Synthèse");

  const task = (
    key: string,
    parent: string,
    title: string,
    status: "draft" | "active" | "done",
    due: string | null,
    effort = 1,
  ) => {
    add(key, { type: "task", title, status, details: { due, effort } });
    edge("contains", parent, key);
  };
  // Refonte du site web
  task("t_web1", "s_web_a", "Maquettes de la page tarifs", "active", "2026-11-03", 2);
  task("t_web2", "s_web_a", "Composant « carte article »", "active", "2026-11-02");
  task("t_web3", "s_web_a", "Rédiger les textes de la page d’accueil", "draft", "2026-11-07");
  task("t_web4", "s_web_a", "Inventaire du contenu", "done", null);
  task("t_web5", "s_web_b", "Redirections 301 des anciennes URL", "active", "2026-11-05");
  task("t_web6", "s_web_b", "Choix de la typographie", "done", null);
  task("t_web7", "s_web_c", "Audit de contraste (AA)", "active", "2026-10-29", 2);
  task("t_web8", "s_web_c", "Navigation au clavier", "draft", "2026-11-10");
  task("t_web9", "p_web", "Payer la facture du studio de design", "active", "2026-10-30");
  task("t_web10", "p_web", "Arborescence validée", "done", null);
  // Lancement v2.1
  task("t_v1", "s_v21_a", "Résolution des conflits de synchronisation", "active", "2026-11-06", 3);
  task("t_v2", "s_v21_a", "Mode hors ligne : tests sur mobile", "draft", "2026-11-12", 2);
  task("t_v3", "s_v21_b", "Modèle de mise en page du PDF", "done", null);
  task("t_v4", "s_v21_b", "Export de plusieurs pages", "active", "2026-11-04");
  task("t_v5", "s_v21_c", "Nouveau graphique du tableau de bord", "active", "2026-11-08");
  task("t_v6", "s_v21_c", "Traductions allemandes", "draft", "2026-11-10");
  task("t_v7", "p_v21", "Corriger le bug de connexion SSO", "done", null);
  // Documentation technique
  task("t_d1", "s_doc_a", "Relire la section authentification", "active", "2026-11-03");
  task("t_d2", "s_doc_a", "Exemples de requêtes en trois langages", "done", null);
  task("t_d3", "s_doc_b", "Tutoriel d’installation sous Windows", "active", "2026-11-09");
  task("t_d4", "s_doc_b", "Tutoriel d’installation sous Linux", "done", null);
  // Migration de la base de données
  task("t_m1", "s_db_a", "Schéma v3 : relecture par l’équipe", "active", "2026-11-05", 2);
  task("t_m2", "s_db_a", "Index des tables d’activité", "draft", "2026-11-14");
  task("t_m3", "s_db_b", "Script de reprise après erreur", "draft", "2026-11-20", 3);
  // Ateliers utilisateurs
  task("t_u1", "s_ux_a", "Envoyer les invitations aux participants", "done", null);
  task("t_u2", "s_ux_a", "Planifier les huit entretiens", "active", "2026-11-04");
  task("t_u3", "s_ux_b", "Grille de synthèse des entretiens", "draft", "2026-11-25");

  const milestone = (key: string, parent: string, title: string, date: string) => {
    add(key, { type: "milestone", title, details: { date, baselineDate: date } });
    edge("contains", parent, key);
  };
  milestone("m_web", "p_web", "Mise en ligne du nouveau site", "2026-11-14");
  milestone("m_v21", "p_v21", "Sortie de la v2.1", "2026-11-28");
  milestone("m_doc", "p_doc", "Documentation publiée", "2026-12-05");
  milestone("m_db", "p_db", "Bascule vers le schéma v3", "2026-12-19");
  edge("depends_on", "m_web", "t_web5");
  edge("depends_on", "m_v21", "t_v1");

  const risk = (
    key: string,
    parent: string,
    title: string,
    probability: number,
    impact: number,
    mitigation: string,
  ) => {
    add(key, { type: "risk", title, details: { probability, impact, mitigation } });
    edge("contains", parent, key);
  };
  risk(
    "r_web",
    "p_web",
    "Contenu livré en retard",
    3,
    3,
    "Relancer l’équipe éditoriale chaque lundi.",
  );
  risk(
    "r_v21",
    "p_v21",
    "Conflits de synchronisation imprévus",
    4,
    4,
    "Prévoir deux jours de tests de charge.",
  );
  risk(
    "r_db",
    "p_db",
    "Interruption pendant la bascule",
    2,
    5,
    "Répéter la migration sur une copie complète.",
  );

  add("d_hebergement", {
    type: "decision",
    title: "Quel hébergeur pour le site ?",
    details: {
      question: "Où héberger le nouveau site ?",
      options: [
        { id: "static", label: "Hébergement statique" },
        { id: "managed", label: "Hébergement géré" },
      ],
      deadline: "2026-11-06",
    },
  });
  edge("contains", "p_web", "d_hebergement");

  type SeedBlock =
    string | { type: "list" | "todo" | "quote" | "code"; text: string; checked?: boolean };
  const note = (key: string, parent: string | null, title: string, lines: SeedBlock[]) => {
    add(key, {
      type: "note",
      title,
      details: {
        pinned: false,
        blocks: lines.map((line, i) =>
          typeof line === "string"
            ? {
                id: String(i + 1),
                type: i === 0 ? ("heading" as const) : ("paragraph" as const),
                text: line,
              }
            : { id: String(i + 1), ...line },
        ),
      },
    });
    if (parent) edge("references", key, parent);
  };
  note("n_web", "p_web", "Principes de design du site", [
    "Intentions",
    "Le nouveau site doit se lire comme un carnet de terrain : clair, chaleureux, sans effets gratuits. Chaque page répond à une seule question.",
    { type: "list", text: "Une seule action principale par page" },
    { type: "list", text: "Contraste AA minimum sur tous les textes" },
    { type: "list", text: "Images toujours accompagnées d’un texte alternatif" },
    { type: "todo", text: "Valider la palette avec l’équipe", checked: true },
    { type: "todo", text: "Tester la typographie sur mobile", checked: false },
    { type: "quote", text: "Si on doit l’expliquer, c’est que ce n’est pas encore assez simple." },
    { type: "code", text: "--rayon-carte: 14px;\n--espace-section: 72px;" },
  ]);
  note("n_v21", "p_v21", "Réunion de cadrage v2.1", [
    "Cadrage",
    "Priorité à la synchronisation hors ligne ; l’export PDF peut glisser d’une semaine.",
  ]);
  note("n_doc", "p_doc", "Plan de la documentation", [
    "Plan",
    "Guide de l’API, puis tutoriels, puis référence de la ligne de commande.",
  ]);
  note("n_ux", "p_ux", "Guide d’entretien", [
    "Trame",
    "Cinq questions ouvertes, une tâche à observer, dix minutes de questions libres.",
  ]);

  note("n_idees", null, "Idées en vrac", [
    "Idées",
    { type: "list", text: "Mode présentation pour les points hebdomadaires" },
    { type: "list", text: "Importer des tâches depuis un tableur" },
    { type: "list", text: "Thème à fort contraste" },
  ]);
  note("n_lectures", null, "Lectures à faire", [
    "Lectures",
    { type: "todo", text: "Le design des objets du quotidien", checked: true },
    { type: "todo", text: "Shape Up", checked: false },
    { type: "todo", text: "Article sur les logiciels local-first", checked: false },
  ]);

  const doc = (
    key: string,
    parent: string,
    title: string,
    mime: string,
    bytes: number,
    kind: DocumentKind,
    tags: string[] = [],
  ) => {
    add(key, {
      type: "document",
      title,
      tags,
      details: { mime, sizeBytes: bytes, issuer: null, kind },
    });
    edge("references", key, parent);
  };
  const pdf = "application/pdf";
  doc("f_web1", "p_web", "Facture-2026-114_Studio-Nord.pdf", pdf, 248_000, "invoice", ["À payer"]);
  doc("f_web2", "p_web", "Charte-graphique-v3.pdf", pdf, 3_100_000, "other", ["Charte"]);
  doc("f_web3", "p_web", "Devis-illustrations-signé.pdf", pdf, 412_000, "contract", ["Signé"]);
  doc("f_web4", "p_web", "Virement-Studio-Nord-septembre.png", "image/png", 3_400_000, "receipt", [
    "Preuve de paiement",
  ]);
  doc("f_web5", "p_web", "Licence-polices-2026.pdf", pdf, 96_000, "invoice", ["Payée"]);
  doc("f_v21", "p_v21", "Specification-synchronisation.pdf", pdf, 612_000, "report", [
    "Spécification",
  ]);
  doc("f_v22", "p_v21", "Contrat-prestation-tests.pdf", pdf, 380_000, "contract", ["À signer"]);
  doc(
    "f_v23",
    "p_v21",
    "Budget-v2.1.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    27_000,
    "report",
    ["Budget"],
  );
  doc("f_db", "p_db", "Schema-v3.sql", "text/plain", 18_000, "other");
  doc("f_db2", "p_db", "Contrat-hébergement-2026.pdf", pdf, 1_200_000, "contract", ["Signé"]);
  doc("f_db3", "p_db", "Facture-hébergement-octobre.pdf", pdf, 88_000, "invoice", ["Payée"]);
  doc("f_ux", "p_ux", "Consentement-participants.pdf", pdf, 92_000, "contract", ["Signé"]);
  doc(
    "f_ux2",
    "p_ux",
    "Formulaire-consentement-modèle.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    52_000,
    "administrative",
    ["Modèle"],
  );

  const reminder = (key: string, parent: string, title: string, startsAt: string) => {
    add(key, {
      type: "event",
      title,
      details: { startsAt, durationMinutes: 30, allDay: false, kind: "appointment" },
    });
    edge("contains", parent, key);
  };
  reminder("ev_host", "p_db", "Relancer l’hébergeur", "2026-11-02T09:00:00.000Z");
  reminder("ev_fonts", "p_web", "Payer les licences de polices", "2026-11-05T08:00:00.000Z");
  reminder("ev_w1", "p_v21", "Point hebdo", "2026-11-09T13:00:00.000Z");
  reminder("ev_w2", "p_v21", "Point hebdo", "2026-11-16T13:00:00.000Z");
  reminder("ev_w3", "p_v21", "Point hebdo", "2026-11-23T13:00:00.000Z");
  reminder("ev_domain", "p_db", "Renouveler le nom de domaine", "2026-11-18T10:00:00.000Z");

  // The journal: a believable stretch of work, busier on weekdays, with a live streak at the end.
  const progress: SeedProgress[] = [];
  const own: Record<string, { tasks: string[]; notes: string[]; files: string[] }> = {
    p_web: {
      tasks: ["t_web4", "t_web6", "t_web10"],
      notes: ["n_web"],
      files: ["f_web1", "f_web2"],
    },
    p_v21: { tasks: ["t_v3", "t_v7"], notes: ["n_v21"], files: ["f_v21"] },
    p_doc: { tasks: ["t_d2", "t_d4"], notes: ["n_doc"], files: [] },
    p_db: { tasks: [], notes: [], files: ["f_db"] },
    p_ux: { tasks: ["t_u1"], notes: ["n_ux"], files: ["f_ux"] },
  };
  const keys = Object.keys(own);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let daysAgo = 0; daysAgo < 365; daysAgo++) {
    const weekday = (new Date(`${NEUTRAL_TODAY}T12:00:00Z`).getUTCDay() - daysAgo + 700) % 7;
    const weekend = weekday === 0 || weekday === 6;
    // The last six days are never empty: the streak is the point of the demo.
    const n = daysAgo < 6 ? 1 + Math.floor(rnd() * 3) : Math.floor(rnd() * (weekend ? 1.3 : 4.2));
    for (let i = 0; i < n; i++) {
      const proj = keys[Math.floor(rnd() * keys.length)] as string;
      const mine = own[proj] as { tasks: string[]; notes: string[]; files: string[] };
      const r = rnd();
      // Prefer the kind the project has something for, so every entry leads to a real object.
      let kind: SeedProgress["kind"] =
        r < 0.7 ? "task_done" : r < 0.88 ? "note_created" : "file_added";
      if (kind === "task_done" && mine.tasks.length === 0)
        kind = mine.files.length ? "file_added" : "note_created";
      if (kind === "note_created" && mine.notes.length === 0)
        kind = mine.files.length ? "file_added" : "task_done";
      if (kind === "file_added" && mine.files.length === 0)
        kind = mine.tasks.length ? "task_done" : "note_created";
      const pool =
        kind === "task_done" ? mine.tasks : kind === "note_created" ? mine.notes : mine.files;
      progress.push({
        key: pool.length ? (pool[Math.floor(rnd() * pool.length)] as string) : null,
        project: proj,
        kind,
        daysAgo,
      });
    }
  }

  const activity: SeedActivity[] = [
    {
      key: "t_web10",
      action: "updated",
      hoursAgo: 4,
      diff: { status: { from: "active", to: "done" } },
    },
    {
      key: "t_v7",
      action: "updated",
      hoursAgo: 22,
      diff: { status: { from: "active", to: "done" } },
    },
    { key: "n_v21", action: "created", hoursAgo: 30 },
    { key: "f_db", action: "created", hoursAgo: 52 },
    { key: "r_v21", action: "created", hoursAgo: 75 },
  ];

  return {
    today: NEUTRAL_TODAY,
    objects,
    edges,
    activity,
    progress,
    settings: {
      baseCurrency: "EUR",
      activeScenario: "base",
      timelineStart: null,
      timelineEnd: null,
      fxRates: [],
    },
  };
}
