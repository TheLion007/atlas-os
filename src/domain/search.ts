import type { ApiObject } from "./api-types";

/**
 * Ranking for the command palette, over the objects already loaded. Deliberately small and
 * predictable: every word typed must match somewhere, and title matches outrank matches in tags
 * or details. A server-side `/api/search` will replace this when the dataset outgrows the client.
 */

export interface SearchHit {
  node: ApiObject;
  score: number;
}

const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Free text found in an object's details (one level deep), for matching. */
function detailText(node: ApiObject): string {
  const parts: string[] = [];
  for (const v of Object.values(node.details ?? {})) {
    if (typeof v === "string") parts.push(v);
  }
  return fold(parts.join(" "));
}

function titleScore(title: string, token: string): number {
  if (title.startsWith(token)) return 60;
  if (new RegExp(`(^|[\\s\\-_/(])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(title))
    return 40;
  return title.includes(token) ? 25 : 0;
}

export function searchObjects(
  nodes: readonly ApiObject[],
  query: string,
  opts: { limit?: number } = {},
): SearchHit[] {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const node of nodes) {
    const title = fold(node.title);
    const meta = fold(`${node.type.replace("_", " ")} ${node.tags.join(" ")}`);
    const body = detailText(node);

    let total = 0;
    let matchedAll = true;
    for (const token of tokens) {
      const t = titleScore(title, token);
      const score = t > 0 ? t : meta.includes(token) ? 15 : body.includes(token) ? 8 : 0;
      if (score === 0) {
        matchedAll = false;
        break;
      }
      total += score;
    }
    if (!matchedAll) continue;
    if (node.status === "active" || node.status === "draft") total += 2;
    hits.push({ node, score: total });
  }

  hits.sort((a, b) => b.score - a.score || a.node.title.localeCompare(b.node.title));
  return hits.slice(0, opts.limit ?? 50);
}
