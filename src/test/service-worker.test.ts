import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

/**
 * Runs `public/sw.js` in a sandbox against a fake Cache Storage and checks
 * the privacy invariant: no app route or /api response is ever cached, and
 * an offline navigation gets the static offline page, never app HTML.
 */

const ROOT = path.resolve(__dirname, "../..");
const SW_SOURCE = fs.readFileSync(path.join(ROOT, "public/sw.js"), "utf8");

/** Every App Router route, e.g. "/", "/transactions", "/settings/bank". */
function appRoutes(): string[] {
  const appDir = path.join(ROOT, "src/app");
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "page.tsx") {
        const rel = path.relative(appDir, dir).split(path.sep).join("/");
        // Route groups "(x)" don't appear in URLs.
        const url = `/${rel.replace(/\([^)]+\)\/?/g, "")}`.replace(/\/$/, "");
        routes.push(url || "/");
      }
    }
  };
  walk(appDir);
  return routes;
}

interface FakeRequest {
  url: string;
  method: string;
  mode: string;
}

function loadWorker(opts: { online: boolean; existingCaches?: Record<string, string[]> }) {
  const stores = new Map<string, Map<string, Response>>();
  for (const [name, urls] of Object.entries(opts.existingCaches ?? {})) {
    stores.set(name, new Map(urls.map((u) => [u, new Response(`cached ${u}`)])));
  }
  const writes: string[] = [];
  const listeners = new Map<string, (event: unknown) => void>();

  const cacheFor = (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, store);
    return {
      add: async (url: string) => {
        writes.push(url);
        store.set(url, new Response(`static ${url}`));
      },
      addAll: async (urls: string[]) => {
        for (const u of urls) {
          writes.push(u);
          store.set(u, new Response(`static ${u}`));
        }
      },
      put: async (req: FakeRequest | string, res: Response) => {
        const url = typeof req === "string" ? req : req.url;
        writes.push(url);
        store.set(url, res);
      },
    };
  };

  const caches = {
    open: async (name: string) => cacheFor(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (req: FakeRequest | string) => {
      const url = typeof req === "string" ? req : new URL(req.url).pathname;
      for (const store of stores.values()) {
        const hit = store.get(url);
        if (hit) return hit.clone();
      }
      return undefined;
    },
  };

  const fetchImpl = async (req: FakeRequest) => {
    if (!opts.online) throw new TypeError("Failed to fetch");
    return new Response(`network ${new URL(req.url).pathname}`);
  };

  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
    skipWaiting: () => {},
    clients: { claim: () => {} },
  };
  vm.runInNewContext(SW_SOURCE, { self, caches, fetch: fetchImpl, Response, URL, Promise });

  async function dispatchLifecycle(type: "install" | "activate") {
    let done: Promise<unknown> = Promise.resolve();
    listeners.get(type)?.({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  }

  async function dispatchFetch(pathname: string, mode = "navigate", method = "GET") {
    let response: Promise<Response> | null = null;
    listeners.get("fetch")?.({
      request: { url: `https://app.test${pathname}`, method, mode },
      respondWith: (p: Promise<Response>) => (response = p),
    });
    return response ? await (response as Promise<Response>) : null;
  }

  return { stores, writes, dispatchLifecycle, dispatchFetch };
}

describe("service worker", () => {
  it("precaches only static, data-free files — never an app route or /api", async () => {
    const worker = loadWorker({ online: true });
    await worker.dispatchLifecycle("install");

    const routes = appRoutes();
    expect(routes).toContain("/");
    expect(routes).toContain("/transactions");
    expect(worker.writes.length).toBeGreaterThan(0);
    for (const url of worker.writes) {
      expect(routes).not.toContain(url);
      expect(url.startsWith("/api")).toBe(false);
      expect(url).toMatch(/\.(html|json|png)$/);
    }
    expect(worker.writes).toContain("/offline.html");
  });

  it("deletes older caches on activate, including the v1 cache that held the dashboard", async () => {
    const worker = loadWorker({ online: true, existingCaches: { "fc-shell-v1": ["/", "/lock"] } });
    await worker.dispatchLifecycle("install");
    await worker.dispatchLifecycle("activate");
    expect([...worker.stores.keys()]).not.toContain("fc-shell-v1");
  });

  it("serves navigations from the network and caches nothing at runtime", async () => {
    const worker = loadWorker({ online: true });
    await worker.dispatchLifecycle("install");
    const before = worker.writes.length;
    for (const route of appRoutes()) {
      const res = await worker.dispatchFetch(route);
      expect(await res?.text()).toBe(`network ${route}`);
    }
    expect(worker.writes.length).toBe(before);
  });

  it("falls back to the offline page — not cached app HTML — when the network fails", async () => {
    // Even with a stale v1 cache still holding "/" (activate not yet run).
    const worker = loadWorker({ online: false, existingCaches: { "fc-shell-v1": ["/"] } });
    await worker.dispatchLifecycle("install");
    const res = await worker.dispatchFetch("/");
    expect(await res?.text()).toBe("static /offline.html");
  });

  it("does not intercept non-navigation requests", async () => {
    const worker = loadWorker({ online: true });
    await worker.dispatchLifecycle("install");
    expect(await worker.dispatchFetch("/api/backup", "cors")).toBeNull();
    expect(await worker.dispatchFetch("/_next/static/chunk.js", "no-cors")).toBeNull();
    expect(await worker.dispatchFetch("/", "navigate", "POST")).toBeNull();
  });
});
