import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/**
 * Finds user-visible copy written straight into TSX: JSX text, text-bearing attributes and
 * string literals reachable inside JSX expressions. The i18n guard test fails on any of them,
 * so interface text always goes through the message catalogue.
 */
const TEXT_ATTRIBUTES = new Set([
  "aria-label",
  "title",
  "placeholder",
  "alt",
  "aria-description",
  "label",
]);

export interface FoundString {
  file: string;
  line: number;
  text: string;
}

export function scanSource(text: string, file = "source.tsx"): FoundString[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: FoundString[] = [];

  const add = (node: ts.Node, value: string): void => {
    const v = value.replace(/\s+/g, " ").trim();
    if (!/\p{L}{2,}/u.test(v)) return;
    found.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: v });
  };

  const inExpression = (node: ts.Expression): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node, node.text);
    else if (ts.isTemplateExpression(node)) {
      add(node, node.head.text + node.templateSpans.map((s) => s.literal.text).join(" "));
    } else if (ts.isConditionalExpression(node)) {
      inExpression(node.whenTrue);
      inExpression(node.whenFalse);
    } else if (ts.isBinaryExpression(node)) {
      // Only operators that can produce the *value* shown: `&&`/`||`/`??` picks one operand to
      // render, `+` concatenates. A comparison's operands (`===`, `<`, ...) are never displayed.
      const op = node.operatorToken.kind;
      const passthrough =
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken ||
        op === ts.SyntaxKind.PlusToken;
      if (passthrough) {
        inExpression(node.left);
        inExpression(node.right);
      }
    } else if (ts.isParenthesizedExpression(node)) inExpression(node.expression);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) add(node, node.text);
    else if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText())) {
      const init = node.initializer;
      if (init && ts.isStringLiteral(init)) add(init, init.text);
      else if (init && ts.isJsxExpression(init) && init.expression) inExpression(init.expression);
    } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      inExpression(node.expression);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

export function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

export function scanTree(root: string): FoundString[] {
  return tsxFiles(root).flatMap((f) => scanSource(readFileSync(f, "utf8"), f));
}
