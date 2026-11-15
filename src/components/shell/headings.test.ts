import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { headingFor } from "./headings";

const lookup = (messages: unknown, key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], messages);

describe("headingFor", () => {
  it("gives the dashboard a greeting with data and an explanation without", () => {
    expect(headingFor("/", true)).toEqual({
      title: "dashboard.title",
      subtitle: "dashboard.subtitleGreeting",
    });
    expect(headingFor("/", false).subtitle).toBe("dashboard.subtitle");
  });

  it("matches a section and its sub-routes, but not a longer name", () => {
    expect(headingFor("/goals", true).title).toBe("goals.title");
    expect(headingFor("/predictions/anything", true).title).toBe("predictions.title");
    expect(headingFor("/goalsxyz", true).title).toBe("app.name");
  });

  it("falls back to the app name for every other page", () => {
    for (const path of ["/transactions", "/settings/bank", "/travels"]) {
      expect(headingFor(path, true)).toEqual({ title: "app.name", subtitle: "app.tagline" });
    }
  });

  it("only names keys that exist in both languages", () => {
    const paths = ["/", "/goals", "/opportunities", "/predictions", "/transactions"];
    for (const path of paths) {
      for (const hasData of [true, false]) {
        const { title, subtitle } = headingFor(path, hasData);
        for (const key of [title, subtitle]) {
          expect(typeof lookup(en, key), key).toBe("string");
          expect(typeof lookup(es, key), key).toBe("string");
        }
      }
    }
  });
});
