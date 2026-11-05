import type { EdgeKind } from "@/domain/enums";
import type { CreateObjectInput } from "@/domain/schemas";
import type { Seed, SeedEdge, SeedObject } from "@/seed/seed-types";
import { minimalPdf, seedId } from "@/seed/seed-types";

/**
 * Test-only data. A coherent multi-domain example (Borland and Dorsel; real estate, business,
 * personal; financial planning) kept so the domain and canvas tests cover a rich graph. It is
 * never shipped: the public demo uses `src/seed/neutral-fr.ts`.
 *
 * EVERY figure here is invented for demonstration and is tagged `illustrative`. Nothing is
 * verified market data, and the approximate coordinates are for illustration only. Dorsel is data
 * in this file, not architecture: the same structure holds a project anywhere in the world.
 *
 * The chain that sets the move date is temporally coherent: the relocation follows the
 * purchase, which follows the savings target, which follows the sale of the Borland flat.
 */

export const SEED_TODAY = "2026-09-21";

const TAX_NOTES_TEXT = [
  "Tax notes (illustrative)",
  "",
  "- Taxe foncière (property tax) for the Ironfield flat: notice arrives in May, paid by 30 June.",
  "- 2026 amount: 1,240 EUR.",
  "- Keep the notice with the flat's documents; it supports the yearly tax memory.",
].join("\n");

/**
 * The files behind a few seeded documents, preloaded by the development fixture store so the
 * preview and content search can be tried without uploading anything. Illustrative content.
 */
export const SEED_FILES = {
  taxNotice: {
    path: `files/${seedId("file:tax-notice")}/property-tax-notice-2026.pdf`,
    mime: "application/pdf",
    text: minimalPdf([
      "Property tax notice 2026 (illustrative)",
      "Property: Ironfield flat",
      "Amount due: 1,240.00 EUR",
      "Due date: 30 June 2026",
    ]),
    get bytes() {
      return this.text.length;
    },
  },
  taxNotes: {
    path: `files/${seedId("file:tax-notes")}/tax-notes.txt`,
    mime: "text/plain",
    text: TAX_NOTES_TEXT,
    get bytes() {
      return new TextEncoder().encode(this.text).length;
    },
  },
} as const;

const TAG = "illustrative";
const SRC = "Illustrative, not verified market data";

export function exampleSeed(): Seed {
  const objects: SeedObject[] = [];
  const edges: SeedEdge[] = [];
  const add = (key: string, input: CreateObjectInput) => {
    objects.push({ key, input: { ...input, tags: [TAG, ...(input.tags ?? [])] } });
  };
  const edge = (kind: EdgeKind, from: string, to: string, extra: Partial<SeedEdge> = {}) => {
    edges.push({ kind, from, to, ...extra });
  };

  // ── Places (a generic hierarchy: country → city → district) ───────────────────────────────
  const place = (
    key: string,
    title: string,
    level: "country" | "city" | "district",
    countryCode: string,
    lat: number,
    lng: number,
    extra: Record<string, unknown> = {},
  ) =>
    add(key, {
      type: "location",
      title,
      details: { level, countryCode, lat, lng, coordinatesSource: "manual", ...extra },
    });
  place("borland", "Borland", "country", "BE", 50.5, 4.47);
  place("bremont", "Bremont", "city", "BE", 50.85, 4.35, { city: "Bremont" });
  place("ironfield", "Ironfield", "district", "BE", 50.83, 4.37, {
    city: "Bremont",
    district: "Ironfield",
  });
  place("uplands", "Uplands", "country", "AE", 23.42, 53.85);
  place("dorsel", "Dorsel", "city", "AE", 25.2, 55.27, { city: "Dorsel" });
  place("marina", "Dorsel Marina", "district", "AE", 25.08, 55.14, {
    city: "Dorsel",
    district: "Dorsel Marina",
    category: "waterfront",
    studiedOn: "2026-08-14",
    verdict: "Strong shortlist candidate; check service charges.",
  });
  place("jlt", "Juniper Lake Towers", "district", "AE", 25.07, 55.14, {
    city: "Dorsel",
    district: "JLT",
  });
  place("birchbay", "Birch Bay", "district", "AE", 25.19, 55.26, {
    city: "Dorsel",
    district: "Birch Bay",
  });
  edge("contains", "borland", "bremont");
  edge("contains", "bremont", "ironfield");
  edge("contains", "uplands", "dorsel");
  edge("contains", "dorsel", "marina");
  edge("contains", "dorsel", "jlt");
  edge("contains", "dorsel", "birchbay");

  // ── Scenarios ─────────────────────────────────────────────────────────────────────────────
  add("sc_cons", {
    type: "scenario",
    title: "Conservative",
    details: { variant: "conservative", description: "Lower savings, slower sale." },
  });
  add("sc_base", {
    type: "scenario",
    title: "Base",
    details: { variant: "base", description: "The plan as currently expected." },
  });
  add("sc_opt", {
    type: "scenario",
    title: "Optimistic",
    details: { variant: "optimistic", description: "Higher savings, faster sale." },
  });

  // ── Plans ─────────────────────────────────────────────────────────────────────────────────
  add("pl_dorsel", {
    type: "plan",
    title: "Dorsel relocation programme",
    details: { description: "Everything that moves the household and its money to Dorsel." },
  });

  // ── Projects ──────────────────────────────────────────────────────────────────────────────
  add("p_reloc", {
    type: "project",
    title: "Dorsel relocation",
    color: "purple",
    details: {
      description: "Move the household to Dorsel.",
      kind: "relocation",
      priority: 1,
      startDate: "2026-01-15",
      targetDate: "2029-03-31",
    },
  });
  add("p_marina", {
    type: "project",
    title: "Marina 1BR purchase",
    details: {
      description: "Buy a one-bedroom apartment as the home base.",
      kind: "property",
      priority: 1,
      startDate: "2026-09-01",
      targetDate: "2028-12-31",
      budgetAmount: 420000,
      budgetCurrency: "EUR",
    },
  });
  add("p_ironfield", {
    type: "project",
    title: "Ironfield flat sale",
    details: {
      description: "Sell the Bremont flat to release capital.",
      kind: "property",
      priority: 2,
      startDate: "2026-08-01",
      targetDate: "2028-03-31",
    },
  });
  add("p_biz", {
    type: "project",
    title: "Consulting entity setup",
    details: {
      description: "Set up a company to work from Dorsel.",
      kind: "business",
      priority: 3,
      startDate: "2026-10-01",
      targetDate: "2027-09-30",
    },
  });
  add("sp_dd", {
    type: "sub_project",
    title: "Due diligence",
    details: { description: "Check the apartment before committing." },
  });
  add("sp_fin", {
    type: "sub_project",
    title: "Financing",
    details: { description: "Decide how the purchase is funded." },
  });
  edge("contains", "p_marina", "sp_dd");
  edge("contains", "p_marina", "sp_fin");
  edge("contains", "pl_dorsel", "p_reloc");
  edge("contains", "pl_dorsel", "p_marina");
  edge("contains", "pl_dorsel", "p_biz");
  edge("located_at", "p_reloc", "dorsel");
  edge("located_at", "p_marina", "marina");
  edge("located_at", "p_ironfield", "ironfield");
  edge("located_at", "p_biz", "dorsel");

  // ── Tasks ─────────────────────────────────────────────────────────────────────────────────
  const task = (
    key: string,
    title: string,
    parent: string,
    status: "draft" | "active" | "done",
    effort: number,
    due?: string,
  ) => {
    add(key, { type: "task", title, status, details: { effort, ...(due ? { due } : {}) } });
    edge("contains", parent, key);
  };
  task("t_bank", "Open a Uplands bank account", "p_reloc", "done", 1);
  task("t_scout", "Book the scouting trip", "p_reloc", "done", 1);
  task("t_visa", "Choose a visa route", "p_reloc", "active", 2, "2026-11-15");
  task("t_visit", "Visit the Marina 1BR", "sp_dd", "done", 2);
  task("t_charges", "Review service charge history", "sp_dd", "active", 2, "2026-10-05");
  task("t_valuation", "Commission an independent valuation", "sp_dd", "draft", 3, "2026-12-01");
  task("t_mortgage", "Compare mortgage offers", "sp_fin", "active", 3, "2026-10-30");
  task("t_preapproval", "Get a pre-approval", "sp_fin", "draft", 2, "2027-01-15");
  task("t_val", "Get the Ironfield flat valued", "p_ironfield", "done", 2);
  task("t_agent", "Choose an agent", "p_ironfield", "active", 1, "2026-10-12");
  task("t_epc", "Prepare the energy certificate", "p_ironfield", "active", 2, "2026-10-25");
  task("t_list", "List the property", "p_ironfield", "draft", 2, "2027-02-01");
  task("t_name", "Register a trade name", "p_biz", "draft", 1, "2026-11-30");
  edge("depends_on", "t_valuation", "t_charges");
  edge("depends_on", "t_preapproval", "t_mortgage");
  edge("depends_on", "t_list", "t_agent");
  edge("depends_on", "t_list", "t_epc");

  // ── Milestones: the chain that sets the move date ────────────────────────────────────────
  add("m_sold", {
    type: "milestone",
    title: "Ironfield flat sold",
    details: {
      date: "2028-03-31",
      baselineDate: "2028-03-31",
      gateCriteria: [
        { text: "Deed signed", met: false },
        { text: "Funds received", met: false },
      ],
    },
  });
  add("m_savings", {
    type: "milestone",
    title: "Savings target reached",
    details: {
      date: "2028-06-30",
      baselineDate: "2028-06-30",
      gateCriteria: [{ text: "Capital covers the purchase", met: false }],
    },
  });
  add("m_purchase", {
    type: "milestone",
    title: "Purchase the Marina 1BR",
    details: {
      date: "2028-12-31",
      baselineDate: "2028-09-30",
      gateCriteria: [
        { text: "Valuation supports the price", met: false },
        { text: "Financing confirmed", met: false },
      ],
    },
  });
  add("m_reloc", {
    type: "milestone",
    title: "Relocation",
    details: { date: "2029-03-31", baselineDate: "2029-01-15" },
  });
  edge("contains", "p_ironfield", "m_sold");
  edge("contains", "p_reloc", "m_savings");
  edge("contains", "p_reloc", "m_purchase");
  edge("contains", "p_reloc", "m_reloc");
  edge("depends_on", "m_sold", "t_list");
  edge("depends_on", "m_savings", "m_sold");
  edge("depends_on", "m_purchase", "m_savings", { lagDays: 30 });
  edge("depends_on", "m_purchase", "t_preapproval");
  edge("depends_on", "m_purchase", "t_valuation");
  edge("depends_on", "m_reloc", "m_purchase", { lagDays: 60 });

  // ── Properties ────────────────────────────────────────────────────────────────────────────
  add("prop_marina", {
    type: "property",
    title: "Marina 1BR, Tower B",
    details: { sizeM2: 78, beds: 1, stage: "shortlisted", listingRef: "ILLUSTRATIVE-001" },
  });
  add("prop_jlt", {
    type: "property",
    title: "JLT 1BR alternative",
    details: { sizeM2: 71, beds: 1, stage: "identified" },
  });
  add("prop_ironfield", {
    type: "property",
    title: "Ironfield flat",
    details: { sizeM2: 92, beds: 2, stage: "for sale" },
  });
  edge("contains", "p_marina", "prop_marina");
  edge("contains", "p_marina", "prop_jlt");
  edge("contains", "p_ironfield", "prop_ironfield");
  edge("located_at", "prop_marina", "marina");
  edge("located_at", "prop_jlt", "jlt");
  edge("located_at", "prop_ironfield", "ironfield");

  // ── Estimates: every value carries its provenance ────────────────────────────────────────
  const estimate = (
    key: string,
    title: string,
    details: Record<string, unknown>,
    confidence: number | null,
  ) =>
    add(key, {
      type: "estimate",
      title,
      confidence,
      details: { source: SRC, asOf: "2026-09-01", ...details } as never,
    });
  estimate(
    "e_cap_actual",
    "Capital on hand",
    { amount: 109400, currency: "EUR", category: "capital", dataKind: "actual" },
    90,
  );
  estimate(
    "e_cap_target",
    "Capital needed for the purchase",
    { amount: 420000, currency: "EUR", category: "capital", dataKind: "target" },
    null,
  );
  estimate(
    "e_price",
    "Marina 1BR asking price",
    { amount: 1650000, currency: "AED", category: "acquisition_cost", dataKind: "estimate" },
    55,
  );
  estimate(
    "e_charge",
    "Marina 1BR service charge",
    {
      amount: 14000,
      currency: "AED",
      unit: "currency_per_year",
      category: "property_cost",
      dataKind: "estimate",
    },
    40,
  );
  estimate(
    "e_rent",
    "Marina 1BR expected rent",
    {
      amount: 7500,
      currency: "AED",
      unit: "currency_per_month",
      category: "rental",
      dataKind: "estimate",
    },
    40,
  );
  estimate(
    "e_sale",
    "Ironfield flat expected sale price",
    { amount: 285000, currency: "EUR", category: "income", dataKind: "estimate" },
    60,
  );
  estimate(
    "e_income",
    "Net income",
    {
      amount: 5200,
      currency: "EUR",
      unit: "currency_per_month",
      category: "income",
      subcategory: "Salary",
      dataKind: "actual",
    },
    80,
  );
  estimate(
    "e_sav_c",
    "Monthly savings (conservative)",
    {
      amount: 1500,
      currency: "EUR",
      unit: "currency_per_month",
      category: "capital",
      dataKind: "assumption",
      scenarioId: seedId("sc_cons"),
    },
    70,
  );
  estimate(
    "e_sav_b",
    "Monthly savings (base)",
    {
      amount: 1800,
      currency: "EUR",
      unit: "currency_per_month",
      category: "capital",
      dataKind: "assumption",
      scenarioId: seedId("sc_base"),
    },
    70,
  );
  estimate(
    "e_sav_o",
    "Monthly savings (optimistic)",
    {
      amount: 2100,
      currency: "EUR",
      unit: "currency_per_month",
      category: "capital",
      dataKind: "assumption",
      scenarioId: seedId("sc_opt"),
    },
    70,
  );
  edge("estimates", "e_price", "prop_marina");
  edge("estimates", "e_charge", "prop_marina");
  edge("estimates", "e_rent", "prop_marina");
  edge("estimates", "e_sale", "prop_ironfield");
  edge("estimates", "e_sav_c", "p_reloc");
  edge("estimates", "e_sav_b", "p_reloc");
  edge("estimates", "e_sav_o", "p_reloc");
  edge("funded_by", "prop_marina", "e_cap_actual");
  // ── Finance: balances, flows, a holding, a debt, goals and assumptions ────────────────────
  // Every value is one Estimate object with its data kind; totals and projections are derived.
  estimate(
    "e_current",
    "Current account",
    { amount: 6200, currency: "EUR", category: "cash", subcategory: "Bank", dataKind: "actual" },
    95,
  );
  estimate(
    "e_etf",
    "ETF portfolio (world index)",
    {
      amount: 42800,
      currency: "EUR",
      category: "investment",
      subcategory: "ETF",
      dataKind: "actual",
      costBasis: 36000,
      ticker: "IWDA",
      quantity: 460,
    },
    90,
  );
  estimate(
    "e_usd",
    "US brokerage account",
    {
      amount: 8500,
      currency: "USD",
      category: "investment",
      subcategory: "Stocks",
      dataKind: "actual",
      costBasis: 9100,
    },
    85,
  );
  estimate(
    "e_flat_value",
    "Ironfield flat (valuation)",
    {
      amount: 310000,
      currency: "EUR",
      category: "asset",
      subcategory: "Real estate",
      dataKind: "actual",
    },
    70,
  );
  estimate(
    "e_mortgage_debt",
    "Ironfield mortgage (outstanding)",
    {
      amount: 142000,
      currency: "EUR",
      category: "liability",
      subcategory: "Mortgage",
      dataKind: "actual",
    },
    95,
  );
  const flow = (key: string, title: string, amount: number, sub: string) =>
    estimate(
      key,
      title,
      {
        amount,
        currency: "EUR",
        unit: "currency_per_month",
        category: "expense",
        subcategory: sub,
        dataKind: "actual",
      },
      85,
    );
  flow("e_exp_mortgage", "Mortgage repayment", 980, "Housing");
  flow("e_exp_living", "Groceries and household", 640, "Food");
  flow("e_exp_transport", "Transport", 180, "Transport");
  flow("e_exp_subs", "Subscriptions", 65, "Subscriptions");
  flow("e_exp_insurance", "Health insurance", 140, "Health");
  estimate(
    "e_goal_invest",
    "Investment portfolio goal",
    { amount: 75000, currency: "EUR", category: "investment", dataKind: "target" },
    null,
  );
  const returns = (key: string, title: string, pct: number, scenario: string) =>
    estimate(
      key,
      title,
      {
        amount: pct,
        currency: null,
        unit: "percent",
        category: "investment",
        dataKind: "assumption",
        scenarioId: seedId(scenario),
      },
      50,
    );
  returns("e_ret_c", "Annual return (conservative)", 3, "sc_cons");
  returns("e_ret_b", "Annual return (base)", 5, "sc_base");
  returns("e_ret_o", "Annual return (optimistic)", 7, "sc_opt");
  edge("estimates", "e_flat_value", "prop_ironfield");
  edge("estimates", "e_mortgage_debt", "prop_ironfield");
  edge("estimates", "e_exp_mortgage", "prop_ironfield");
  edge("estimates", "e_goal_invest", "sp_fin");

  // Six months of transactions through the current account (dated movements, always actual).
  const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  const txn = (
    key: string,
    title: string,
    date: string,
    amount: number,
    kind: string,
    subcategory: string | null,
    account = "e_current",
  ) => {
    add(key, {
      type: "transaction",
      title,
      details: {
        date,
        amount,
        currency: "EUR",
        kind,
        subcategory,
        source: "bank_statement",
      } as never,
    });
    edge("references", key, account, { label: "account" });
  };
  months.forEach((m, i) => {
    const wobble = [0, 35, -20, 60, 15, -40][i] ?? 0;
    txn(`tx_salary_${i}`, "Salary", `${m}-01`, 5200, "income", "Salary");
    txn(`tx_mortgage_${i}`, "Mortgage repayment", `${m}-03`, 980, "expense", "Housing");
    txn(`tx_food_a_${i}`, "Groceries", `${m}-09`, 310 + wobble, "expense", "Food");
    txn(`tx_food_b_${i}`, "Groceries", `${m}-23`, 290 - wobble / 2, "expense", "Food");
    txn(
      `tx_transport_${i}`,
      "Transport pass and fuel",
      `${m}-12`,
      170 + (i % 2) * 25,
      "expense",
      "Transport",
    );
    txn(`tx_subs_${i}`, "Subscriptions", `${m}-15`, 65, "expense", "Subscriptions");
    txn(`tx_etf_${i}`, "Monthly ETF purchase", `${m}-05`, 500, "investment", "ETF");
    if (m !== "2026-09")
      txn(`tx_ins_${i}`, "Health insurance", `${m}-20`, 140, "expense", "Health");
  });
  txn("tx_tax", "Property tax (précompte immobilier)", "2026-06-30", 1240, "expense", "Taxes");
  txn("tx_travel", "Flights to Dorsel", "2026-08-11", 620, "expense", "Travel");
  txn("tx_bonus", "Annual bonus", "2026-06-25", 3100, "income", "Salary");
  edge("references", "tx_travel", "p_reloc");
  edge("references", "tx_tax", "prop_ironfield");

  // The blueprint's worked example: capital depends on the savings rate, which depends on income.
  edge("depends_on", "e_cap_actual", "e_sav_b");
  edge("depends_on", "e_sav_b", "e_income");
  edge("depends_on", "m_savings", "e_sav_b");

  // ── Decisions ─────────────────────────────────────────────────────────────────────────────
  add("d_district", {
    type: "decision",
    title: "Which district?",
    details: {
      question: "Which district should the apartment be in?",
      options: [
        { id: "marina", label: "Dorsel Marina" },
        { id: "jlt", label: "Juniper Lake Towers" },
        { id: "birchbay", label: "Birch Bay" },
      ],
      criteria: [
        { id: "yield", label: "Rental yield", weight: 3 },
        { id: "walk", label: "Walkability", weight: 2 },
        { id: "price", label: "Price", weight: 3 },
      ],
      scores: {
        marina: { yield: 3, walk: 5, price: 2 },
        jlt: { yield: 4, walk: 3, price: 4 },
        birchbay: { yield: 3, walk: 3, price: 3 },
      },
      deadline: "2026-12-15",
    },
  });
  add("d_zone", {
    type: "decision",
    title: "Free zone or mainland?",
    details: {
      question: "Where should the consulting entity be registered?",
      options: [
        { id: "free", label: "Free zone" },
        { id: "main", label: "Mainland" },
      ],
      deadline: "2027-03-01",
    },
  });
  add("d_mortgage", {
    type: "decision",
    title: "Mortgage or cash?",
    status: "done",
    details: {
      question: "Fund the purchase with a mortgage or from capital?",
      options: [
        { id: "mortgage", label: "Mortgage" },
        { id: "cash", label: "Cash" },
      ],
      resolvedOptionId: "cash",
      rationale:
        "Keeps the plan simple and avoids a currency-linked liability while the income situation is still moving.",
      resolvedAt: "2026-09-19T09:00:00Z",
    },
  });
  edge("contains", "p_marina", "d_district");
  edge("contains", "p_marina", "d_mortgage");
  edge("contains", "p_biz", "d_zone");
  edge("depends_on", "m_purchase", "d_district");
  edge("references", "d_district", "marina");
  edge("references", "d_district", "jlt");
  edge("references", "d_district", "birchbay");

  // ── Memory (ADR 0002): durable knowledge, distinct from the operational objects above ───────
  add("mem_plan", {
    type: "memory",
    title: "Purchase property before relocation",
    confidence: 85,
    details: { memoryType: "plan", sourceKind: "user" },
  });
  add("mem_cash", {
    type: "memory",
    title: "Prefer cash purchase",
    confidence: 90,
    details: {
      memoryType: "preference",
      detail: "Avoids a currency-linked liability while the income situation is still moving.",
      sourceKind: "ai_proposal",
    },
  });
  // `about` gives each memory its display colour, inherited from p_reloc (purple) rather than
  // stored on the memory itself (ADR 0002 §5). `mem_cash` is about both the purchase project and
  // the relocation, exercising the primary/secondary context rule (ADR 0002 §3).
  edge("about", "mem_plan", "p_reloc", { label: "primary" });
  edge("about", "mem_cash", "p_marina", { label: "primary" });
  edge("about", "mem_cash", "p_reloc");
  edge("derived_from", "mem_plan", "m_purchase");
  edge("derived_from", "mem_cash", "d_mortgage");
  edge("supported_by", "mem_cash", "doc_listing");

  // ── Risks ─────────────────────────────────────────────────────────────────────────────────
  const risk = (
    key: string,
    title: string,
    parent: string,
    probability: number,
    impact: number,
    mitigation: string,
  ) => {
    add(key, { type: "risk", title, details: { probability, impact, mitigation } });
    edge("contains", parent, key);
  };
  risk(
    "r_price",
    "Prices rise before the purchase",
    "p_marina",
    4,
    4,
    "Lock a reservation early if the valuation supports it.",
  );
  risk(
    "r_fin",
    "Financing is declined",
    "p_marina",
    2,
    5,
    "Keep the cash option open (see the closed decision).",
  );
  risk(
    "r_visa",
    "Visa processing takes longer",
    "p_reloc",
    3,
    4,
    "Start paperwork six months before the move.",
  );
  risk(
    "r_sale",
    "The flat sells slower than planned",
    "p_ironfield",
    3,
    3,
    "Price to the valuation and choose an agent early.",
  );
  risk(
    "r_charge",
    "Service charges increase",
    "p_marina",
    2,
    2,
    "Review the charge history before committing.",
  );
  risk("r_fx", "Transfer rate worsens", "p_marina", 3, 2, "Transfer in tranches.");

  // ── Notes, documents, people, events ─────────────────────────────────────────────────────
  add("n_scout", {
    type: "note",
    title: "Scouting trip notes",
    details: {
      pinned: true,
      blocks: [
        { id: "1", type: "heading", text: "Marina first impressions" },
        {
          id: "2",
          type: "paragraph",
          text: "Quiet after 22:00 on the upper floors; check the tram line noise on the lower ones.",
        },
      ],
    },
  });
  add("n_visa", {
    type: "note",
    title: "Visa route research",
    details: {
      blocks: [
        {
          id: "1",
          type: "paragraph",
          text: "Compare the employer-sponsored and self-sponsored routes.",
        },
      ],
    },
  });
  add("doc_listing", {
    type: "document",
    title: "Marina 1BR listing (PDF)",
    details: { mime: "application/pdf", issuer: "Broker (illustrative)", sizeBytes: 482113 },
  });
  add("doc_passport", {
    type: "document",
    title: "Passport",
    details: { mime: "application/pdf", validUntil: "2030-04-18", issuer: "Illustrative issuer" },
  });
  add("doc_tax", {
    type: "document",
    title: "Property tax notice 2026",
    tags: ["tax", "borland"],
    details: {
      mime: "application/pdf",
      kind: "tax",
      issuer: "Regional tax office (illustrative)",
      description: "Notice for the Ironfield flat's property tax, paid in June.",
      source: "upload",
      originalName: "property-tax-notice-2026.pdf",
      storagePath: SEED_FILES.taxNotice.path,
      sizeBytes: SEED_FILES.taxNotice.bytes,
    },
  });
  add("doc_precompte", {
    type: "document",
    title: "Tax notes",
    tags: ["tax"],
    details: {
      mime: "text/plain",
      kind: "tax",
      description: "Working notes on what is due and when.",
      source: "upload",
      originalName: "tax-notes.txt",
      storagePath: SEED_FILES.taxNotes.path,
      sizeBytes: SEED_FILES.taxNotes.bytes,
      contentText: SEED_FILES.taxNotes.text,
    },
  });
  add("doc_etf", {
    type: "document",
    title: "Broker statement Q2 2026",
    tags: ["investments"],
    details: {
      mime: "application/pdf",
      kind: "statement",
      issuer: "Broker (illustrative)",
      source: "upload",
      sizeBytes: 211_420,
    },
  });
  add("mem_tax", {
    type: "memory",
    title: "Borland property tax on the Ironfield flat is due every June",
    confidence: 85,
    details: { memoryType: "fact", sourceKind: "user", detail: "" },
  });
  edge("references", "doc_tax", "tx_tax");
  edge("references", "doc_tax", "p_ironfield");
  edge("references", "doc_precompte", "p_ironfield");
  edge("references", "doc_etf", "e_etf");
  edge("about", "mem_tax", "p_ironfield", { label: "primary" });
  edge("supported_by", "mem_tax", "doc_tax");
  edge("supported_by", "mem_tax", "doc_precompte");
  add("person_broker", {
    type: "person",
    title: "Mortgage broker",
    details: {
      role: "Broker",
      org: "Illustrative Advisory",
      countryCode: "BE",
      lastContact: "2026-09-10",
    },
  });
  add("person_adviser", {
    type: "person",
    title: "Relocation adviser",
    details: { role: "Adviser", countryCode: "AE" },
  });
  add("ev_scout", {
    type: "event",
    title: "Dorsel scouting trip",
    details: { kind: "trip", startsAt: "2026-11-08T08:00:00Z", durationMinutes: 8640 },
  });
  add("ev_call", {
    type: "event",
    title: "Mortgage broker call",
    details: { kind: "appointment", startsAt: "2026-10-08T14:00:00Z", durationMinutes: 45 },
  });
  edge("references", "n_scout", "p_marina");
  edge("references", "n_visa", "p_reloc");
  edge("references", "n_visa", "t_visa");
  edge("references", "doc_listing", "prop_marina");
  edge("references", "doc_passport", "p_reloc");
  edge("references", "t_mortgage", "person_broker", { label: "assignee" });
  edge("references", "p_reloc", "person_adviser", { label: "owner" });
  edge("contains", "p_reloc", "ev_scout");
  edge("contains", "sp_fin", "ev_call");
  edge("located_at", "ev_scout", "dorsel");

  return {
    today: SEED_TODAY,
    objects,
    edges,
    activity: [
      {
        key: "t_bank",
        action: "updated",
        hoursAgo: 5,
        diff: { status: { from: "active", to: "done" } },
      },
      {
        key: "e_cap_actual",
        action: "updated",
        hoursAgo: 26,
        diff: { amount: { from: 107000, to: 109400 } },
      },
      {
        key: "d_mortgage",
        action: "updated",
        hoursAgo: 49,
        diff: { status: { from: "active", to: "done" } },
      },
      { key: "r_price", action: "created", hoursAgo: 71 },
      { key: "t_epc", action: "created", hoursAgo: 96 },
      {
        key: "m_purchase",
        action: "updated",
        hoursAgo: 120,
        diff: { date: { from: "2028-09-30", to: "2028-12-31" } },
      },
      { key: "prop_jlt", action: "created", hoursAgo: 190 },
    ],
    files: Object.values(SEED_FILES).map((f) => ({ path: f.path, mime: f.mime, text: f.text })),
    settings: {
      baseCurrency: "EUR",
      activeScenario: "base",
      timelineStart: null,
      timelineEnd: null,
      fxRates: [
        {
          from: "AED",
          to: "EUR",
          rate: 0.25,
          asOf: "2026-09-01",
          source: "Illustrative rate, not market data",
        },
      ],
    },
  };
}
