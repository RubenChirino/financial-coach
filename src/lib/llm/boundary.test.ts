import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Structural guarantees behind the LLM gateway, checked over every source file:
 *
 *  1. Only `lib/llm/gateway.ts` imports a provider SDK or an AI SDK generation
 *     function — by name, namespace, default, re-export, `import()` or
 *     `require()`. Type-only imports are fine anywhere. (Biome's
 *     `noRestrictedImports` catches named imports in the editor; this also
 *     catches the forms it can't.)
 *  2. Only `lib/redact.ts` casts to `Redacted`, so `redact()` stays the type's
 *     only constructor.
 */

const SRC = path.resolve(__dirname, "../..");
const GATEWAY = "lib/llm/gateway.ts";
const REDACT = "lib/redact.ts";
const GENERATION_FUNCTIONS = new Set([
  "generateText",
  "generateObject",
  "streamText",
  "streamObject",
  "embed",
  "embedMany",
]);

function isProviderSdk(module: string): boolean {
  return (
    (module.startsWith("@ai-sdk/") && module !== "@ai-sdk/react") ||
    module.startsWith("ollama-ai-provider")
  );
}

interface ImportUse {
  module: string;
  /** Imported binding names; "*" for namespace / export-star / dynamic. */
  names: string[];
}

interface Scan {
  imports: ImportUse[];
  redactedCasts: number;
}

function importDeclaration(node: ts.ImportDeclaration): ImportUse | null {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return null;
  const module = node.moduleSpecifier.text;
  const clause = node.importClause;
  if (!clause) return { module, names: ["*"] };
  if (clause.isTypeOnly) return null;
  const names: string[] = [];
  if (clause.name) names.push("default");
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) names.push("*");
  if (bindings && ts.isNamedImports(bindings)) {
    for (const el of bindings.elements) {
      if (!el.isTypeOnly) names.push((el.propertyName ?? el.name).text);
    }
  }
  return names.length > 0 ? { module, names } : null;
}

function reExport(node: ts.ExportDeclaration): ImportUse | null {
  if (node.isTypeOnly || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) {
    return null;
  }
  const module = node.moduleSpecifier.text;
  const clause = node.exportClause;
  if (!clause || ts.isNamespaceExport(clause)) return { module, names: ["*"] };
  const names = clause.elements
    .filter((el) => !el.isTypeOnly)
    .map((el) => (el.propertyName ?? el.name).text);
  return names.length > 0 ? { module, names } : null;
}

/** `import("x")` or `require("x")`. */
function dynamicImport(node: ts.CallExpression): ImportUse | null {
  const [arg] = node.arguments;
  const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
  if (!(isImport || isRequire) || !arg || !ts.isStringLiteralLike(arg)) return null;
  return { module: arg.text, names: ["*"] };
}

function isRedactedCast(node: ts.Node, sf: ts.SourceFile): boolean {
  return (
    (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
    ts.isTypeReferenceNode(node.type) &&
    node.type.typeName.getText(sf) === "Redacted"
  );
}

/** Value (non type-only) imports and `Redacted` casts in one source file. */
function scanSource(fileName: string, text: string): Scan {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const imports: ImportUse[] = [];
  let redactedCasts = 0;

  const visit = (node: ts.Node) => {
    let use: ImportUse | null = null;
    if (ts.isImportDeclaration(node)) use = importDeclaration(node);
    else if (ts.isExportDeclaration(node)) use = reExport(node);
    else if (ts.isCallExpression(node)) use = dynamicImport(node);
    if (use) imports.push(use);
    if (isRedactedCast(node, sf)) redactedCasts++;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { imports, redactedCasts };
}

function callsModel(use: ImportUse): boolean {
  if (isProviderSdk(use.module)) return true;
  if (use.module !== "ai") return false;
  return use.names.some((n) => n === "*" || n === "default" || GENERATION_FUNCTIONS.has(n));
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|mts|cts)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const scans = sourceFiles(SRC).map((file) => {
  const rel = path.relative(SRC, file).split(path.sep).join("/");
  return { rel, ...scanSource(rel, fs.readFileSync(file, "utf8")) };
});

describe("LLM boundary", () => {
  it("only the gateway imports a provider SDK or an AI SDK generation function", () => {
    const offenders = scans
      .filter((s) => s.rel !== GATEWAY)
      .flatMap((s) =>
        s.imports.filter(callsModel).map((u) => `${s.rel}: ${u.module} {${u.names.join(", ")}}`),
      );
    expect(offenders).toEqual([]);
  });

  it("only redact.ts casts to Redacted", () => {
    const offenders = scans
      .filter((s) => s.rel !== REDACT && s.redactedCasts > 0)
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it("is not vacuous: it sees the gateway's imports and redact.ts's casts", () => {
    const gateway = scans.find((s) => s.rel === GATEWAY);
    const gatewayModules = new Set(gateway?.imports.filter(callsModel).map((u) => u.module));
    expect([...gatewayModules].sort()).toEqual(
      [
        "@ai-sdk/anthropic",
        "@ai-sdk/google",
        "@ai-sdk/openai",
        "ai",
        "ollama-ai-provider-v2",
      ].sort(),
    );
    expect(scans.find((s) => s.rel === REDACT)?.redactedCasts).toBeGreaterThan(0);
  });

  it("flags every import form, and ignores type-only imports", () => {
    const probe = scanSource(
      "probe.ts",
      [
        'import * as ai from "ai";',
        'import ai2 from "ai";',
        'import { generateText as gt } from "ai";',
        'export { streamText } from "ai";',
        'const p = await import("@ai-sdk/openai");',
        'const o = require("ollama-ai-provider-v2");',
        'const r = "x" as Redacted;',
        'const r2 = <Redacted>"x";',
        'import type { LanguageModel } from "ai";',
        'import { type ModelMessage, DefaultChatTransport } from "ai";',
        'import { useChat } from "@ai-sdk/react";',
      ].join("\n"),
    );
    expect(probe.imports.filter(callsModel)).toHaveLength(6);
    expect(probe.redactedCasts).toBe(2);
    expect(probe.imports.filter((u) => !callsModel(u)).map((u) => u.module)).toEqual([
      "ai",
      "@ai-sdk/react",
    ]);
  });
});
