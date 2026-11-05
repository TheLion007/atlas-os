import { ai } from "./ai";
import { cal } from "./cal";
import { common } from "./common";
import { create } from "./create";
import { feel } from "./feel";
import { finance } from "./finance";
import { graph } from "./graph";
import { hist } from "./hist";
import { hm } from "./hm";
import { map } from "./map";
import { memory } from "./memory";
import { notes } from "./notes";
import { proj } from "./proj";
import { overview } from "./overview";
import { rm } from "./rm";
import { shell } from "./shell";
import { st } from "./st";
import { tm } from "./tm";
import { types } from "./types";
import { up } from "./up";
import { vault } from "./vault";

/** The whole catalogue. Each area is written in both languages side by side (see define.ts). */
export const AREAS = [
  common,
  shell,
  types,
  overview,
  create,
  graph,
  map,
  memory,
  finance,
  feel,
] as const;

export const en = {
  ...common.en,
  ...shell.en,
  ...types.en,
  ...overview.en,
  ...create.en,
  ...graph.en,
  ...map.en,
  ...memory.en,
  ...finance.en,
  ...feel.en,
  ...proj.en,
  ...hist.en,
  ...hm.en,
  ...notes.en,
  ...vault.en,
  ...st.en,
  ...cal.en,
  ...tm.en,
  ...ai.en,
  ...up.en,
  ...rm.en,
};
export const fr = {
  ...common.fr,
  ...shell.fr,
  ...types.fr,
  ...overview.fr,
  ...create.fr,
  ...graph.fr,
  ...map.fr,
  ...memory.fr,
  ...finance.fr,
  ...feel.fr,
  ...proj.fr,
  ...hist.fr,
  ...hm.fr,
  ...notes.fr,
  ...vault.fr,
  ...st.fr,
  ...cal.fr,
  ...tm.fr,
  ...ai.fr,
  ...up.fr,
  ...rm.fr,
};

export type MessageKey = keyof typeof en;
