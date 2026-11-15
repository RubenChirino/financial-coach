import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import { CLIENT_MESSAGE_PATHS, pickMessages } from "./client-messages";

function clientFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return clientFiles(path);
    if (!/\.tsx?$/.test(name) || /\.test\./.test(name)) return [];
    return readFileSync(path, "utf8").startsWith('"use client"') ? [path] : [];
  });
}

const covered = (ns: string) =>
  CLIENT_MESSAGE_PATHS.some((p) => ns === p || ns.startsWith(`${p}.`));

describe("client messages", () => {
  it("covers every namespace a client component asks for", () => {
    const used = new Set<string>();
    for (const file of clientFiles("src")) {
      for (const m of readFileSync(file, "utf8").matchAll(/useTranslations\(\s*"([^"]+)"\s*\)/g)) {
        used.add(m[1] as string);
      }
    }
    expect(used.size).toBeGreaterThan(5);
    expect([...used].filter((ns) => !covered(ns))).toEqual([]);
  });

  it("keeps the picked paths and drops the rest", () => {
    const picked = pickMessages(en, CLIENT_MESSAGE_PATHS) as typeof en;
    expect(picked.bank).toEqual(en.bank);
    expect(picked.advisor.chat).toEqual(en.advisor.chat);
    expect(picked.app.name).toBe(en.app.name);
    expect(picked.dashboard.subtitleGreeting).toBe(en.dashboard.subtitleGreeting);
    expect(Object.keys(picked.dashboard).sort()).toEqual(["subtitle", "subtitleGreeting", "title"]);
    expect(picked).not.toHaveProperty("insights");
    expect(JSON.stringify(picked).length).toBeLessThan(JSON.stringify(en).length);
  });
});
