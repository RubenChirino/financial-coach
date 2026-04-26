import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoCardlessClient, GoCardlessError } from "./client";

type JsonFetch = (input: unknown, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GoCardlessClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeClient() {
    return new GoCardlessClient(
      { secretId: "id", secretKey: "key" },
      { fetch: fetchMock as unknown as JsonFetch as typeof fetch },
    );
  }

  it("exchanges credentials for an access token and caches it", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        access: "ACCESS",
        refresh: "REFRESH",
        access_expires: 3600,
        refresh_expires: 86_400,
      }),
    );
    const c = makeClient();
    const t1 = await c.getToken();
    const t2 = await c.getToken();
    expect(t1).toBe("ACCESS");
    expect(t2).toBe("ACCESS");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0]!;
    expect(String(firstCall[0])).toContain("/token/new/");
    const init = firstCall[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      secret_id: "id",
      secret_key: "key",
    });
  });

  it("surfaces token errors as GoCardlessError with status + body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ summary: "forbidden" }), { status: 401 }),
    );
    const c = makeClient();
    await expect(c.getToken()).rejects.toMatchObject({
      name: "GoCardlessError",
      status: 401,
    });
  });

  it("sends bearer token on downstream calls", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          access: "ACCESS",
          refresh: "R",
          access_expires: 3600,
          refresh_expires: 86400,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: "BANK_ES",
            name: "BANK",
            countries: ["ES"],
            logo: "x",
            transaction_total_days: "90",
          },
        ]),
      );

    const c = makeClient();
    const list = await c.listInstitutions("ES");
    expect(list).toHaveLength(1);
    const secondCall = fetchMock.mock.calls[1]!;
    expect(String(secondCall[0])).toContain("/institutions/?country=ES");
    const headers = (secondCall[1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer ACCESS");
  });

  it("rejects non-ISO country codes before hitting the network", async () => {
    const c = makeClient();
    await expect(c.listInstitutions("Spain")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates requisitions with the given body", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          access: "ACCESS",
          refresh: "R",
          access_expires: 3600,
          refresh_expires: 86400,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "R1",
          created: "now",
          redirect: "http://x",
          status: "CR",
          institution_id: "B",
          agreement: "A",
          reference: "ref",
          accounts: [],
          user_language: "ES",
          link: "https://pay.example",
        }),
      );
    const c = makeClient();
    const r = await c.createRequisition({
      redirect: "http://x",
      institution_id: "B",
      reference: "ref",
      user_language: "ES",
    });
    expect(r.link).toBe("https://pay.example");
    const init = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({ institution_id: "B", reference: "ref" });
  });

  it("throws GoCardlessError on downstream non-2xx", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          access: "ACCESS",
          refresh: "R",
          access_expires: 3600,
          refresh_expires: 86400,
        }),
      )
      .mockResolvedValueOnce(new Response("nope", { status: 500 }));
    const c = makeClient();
    await expect(c.getAccountBalances("acc")).rejects.toBeInstanceOf(GoCardlessError);
  });
});
