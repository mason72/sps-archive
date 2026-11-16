/**
 * Every icon-only button says what it does on hover.
 *
 * Justin (2026-11-16) hovered the editor's Grid / Film strip / People icons and
 * got nothing: they carried an `aria-label` (read by screen readers only) and
 * no `title` (what a browser shows on hover). The Intel icon beside them had
 * both, so one row behaved two ways. A sweep found 66 more like it across the
 * app, plus 19 icon buttons with no label at all.
 *
 * This reads every .tsx file with the TypeScript parser and fails on a
 * <button> that renders no text and has no `title`, when it either has an
 * aria-label (the drift that hit Justin) or contains only icon components.
 * Toggle switches (a span knob beside visible text) and photo thumbnails
 * (an <img>) are not icon-only by this definition and are left alone.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const SRC = path.join(process.cwd(), "src");

function tsxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(p);
    return p.endsWith(".tsx") && !p.endsWith(".test.tsx") ? [p] : [];
  });
}

type Kids = ts.NodeArray<ts.JsxChild> | readonly ts.JsxChild[];

/** Does this subtree put any text on screen? */
function rendersText(kids: Kids, sf: ts.SourceFile): boolean {
  const exprText = (e: ts.Expression | undefined): boolean => {
    if (!e) return false;
    if (ts.isParenthesizedExpression(e)) return exprText(e.expression);
    if (ts.isJsxElement(e)) return rendersText(e.children, sf);
    if (ts.isJsxFragment(e)) return rendersText(e.children, sf);
    if (ts.isJsxSelfClosingElement(e)) return false;
    if (ts.isConditionalExpression(e)) return exprText(e.whenTrue) || exprText(e.whenFalse);
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return exprText(e.right);
    }
    if (e.kind === ts.SyntaxKind.NullKeyword || e.kind === ts.SyntaxKind.FalseKeyword) return false;
    return true; // a string, a variable, a call: assume it is text
  };
  return kids.some((c) => {
    if (ts.isJsxText(c)) return /[A-Za-z0-9]/.test(c.getText(sf));
    if (ts.isJsxExpression(c)) return exprText(c.expression);
    if (ts.isJsxElement(c) || ts.isJsxFragment(c)) return rendersText(c.children, sf);
    return false;
  });
}

/** Tag names of every element in the subtree (to tell icons from knobs and photos). */
function tagNames(kids: Kids, sf: ts.SourceFile, out: string[] = []): string[] {
  const visit = (n: ts.Node) => {
    if (ts.isJsxSelfClosingElement(n)) out.push(n.tagName.getText(sf));
    if (ts.isJsxElement(n)) out.push(n.openingElement.tagName.getText(sf));
    ts.forEachChild(n, visit);
  };
  kids.forEach(visit);
  return out;
}

function findUnlabelled(): string[] {
  const bad: string[] = [];
  for (const file of tsxFiles(SRC)) {
    const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (n: ts.Node) => {
      const open = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;
      if (open && open.tagName.getText(sf) === "button") {
        const props = open.attributes.properties;
        const names = props.filter(ts.isJsxAttribute).map((a) => a.name.getText(sf));
        const kids = ts.isJsxElement(n) ? n.children : [];
        const spread = props.some(ts.isJsxSpreadAttribute);
        if (!spread && !names.includes("title") && !rendersText(kids, sf)) {
          const tags = tagNames(kids, sf);
          const hasAria = names.includes("aria-label") || names.includes("aria-labelledby");
          const iconsOnly = tags.length > 0 && tags.every((t) => /^[A-Z]/.test(t));
          if (hasAria || iconsOnly) {
            const line = sf.getLineAndCharacterOfPosition(open.getStart()).line + 1;
            bad.push(`${path.relative(process.cwd(), file)}:${line}`);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return bad;
}

describe("icon buttons", () => {
  it("every icon-only button has a hover label (title)", () => {
    expect(findUnlabelled()).toEqual([]);
  });
});
