import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { verifyDeployment } from "./verify-deployment.mjs";

const appHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const health = (version = "0.5.4") => Response.json({ ok: true, version, schemaVersion: 5 });
const html = () =>
  new Response(appHtml, { headers: { "content-type": "text/html; charset=utf-8" } });

function verify(fetchImpl, options = {}) {
  return verifyDeployment({
    baseUrl: "http://localhost:3000",
    expectedVersion: "0.5.4",
    timeoutMs: 200,
    pollIntervalMs: 1,
    requestTimeoutMs: 20,
    fetchImpl,
    log: vi.fn(),
    ...options,
  });
}

describe("verifyDeployment", () => {
  it("checks health and the real app HTML without redirects or caching", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(health()).mockResolvedValueOnce(html());
    await expect(verify(fetch)).resolves.toBe("deployed");
    expect(fetch.mock.calls.map(([url]) => url.pathname)).toEqual(["/api/health", "/"]);
    for (const [, options] of fetch.mock.calls) {
      expect(options).toMatchObject({ redirect: "manual", cache: "no-store" });
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("waits for an older version to become the expected version", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(health("0.5.3"))
      .mockResolvedValueOnce(health())
      .mockResolvedValueOnce(html());
    await expect(verify(fetch)).resolves.toBe("deployed");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each(["0.5.5", "0.10.0", "1.0.0", "0.5.5-rc.1"])(
    "reports a newer version %s as superseded without checking HTML",
    async (version) => {
      const fetch = vi.fn().mockResolvedValueOnce(health(version));
      const log = vi.fn();
      await expect(verify(fetch, { log })).resolves.toBe("superseded");
      expect(log).toHaveBeenCalledWith(expect.stringContaining("superseded"));
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["0.5.4-rc.2", "0.5.4-rc.10"],
    ["0.5.4-rc.10", "0.5.4"],
  ])("orders prereleases %s before %s", async (older, expectedVersion) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(health(older))
      .mockResolvedValueOnce(health(expectedVersion))
      .mockResolvedValueOnce(html());
    await expect(verify(fetch, { expectedVersion })).resolves.toBe("deployed");
  });

  it.each([401, 403, 301, 302, 307, 308, 404])("rejects HTTP %s immediately", async (status) => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status }));
    await expect(verify(fetch)).rejects.toThrow(`HTTP ${status}`);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects an HTML auth page from the health endpoint", async () => {
    await expect(verify(vi.fn().mockResolvedValueOnce(html()))).rejects.toThrow(
      "expected application/json",
    );
  });

  it("rejects malformed JSON immediately", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("{", { headers: { "content-type": "application/json" } }),
      );
    await expect(verify(fetch)).rejects.toThrow("malformed JSON");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    { ok: false, version: "0.5.4", schemaVersion: 5 },
    { ok: true },
    { ok: true, version: 54, schemaVersion: 5 },
    { ok: true, version: "0.5.4" },
    { ok: true, version: "unknown", schemaVersion: 5 },
  ])("rejects an invalid health response %j", async (body) => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(body));
    await expect(verify(fetch)).rejects.toThrow(/expected \{|Invalid semver/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries connection errors and 5xx during Recreate rollout", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("connection refused"))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(health())
      .mockResolvedValueOnce(html());
    await expect(verify(fetch)).resolves.toBe("deployed");
  });

  it("retries request timeouts", async () => {
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
      )
      .mockResolvedValueOnce(health())
      .mockResolvedValueOnce(html());
    await expect(verify(fetch)).resolves.toBe("deployed");
  });

  it("bounds requests by the overall timeout", async () => {
    const fetch = vi.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    await expect(verify(fetch, { timeoutMs: 15, requestTimeoutMs: 1000 })).rejects.toThrow(
      /Deployment timed out.*\/api\/health/,
    );
  });

  it("reports the last observed version on overall timeout", async () => {
    const fetch = vi.fn(async () => health("0.5.3"));
    await expect(verify(fetch, { timeoutMs: 15 })).rejects.toThrow(
      "Deployment timed out after 15 ms: Deployed version 0.5.3; expected 0.5.4",
    );
  });

  it.each([
    new Response("<html>Sign in</html>", { headers: { "content-type": "text/html" } }),
    new Response(null, { status: 302 }),
    new Response(null, { status: 401 }),
    Response.json({ ok: true }),
    new Response(appHtml, { status: 201, headers: { "content-type": "text/html" } }),
  ])("rejects an invalid app page after matching health", async (response) => {
    const fetch = vi.fn().mockResolvedValueOnce(health()).mockResolvedValueOnce(response);
    await expect(verify(fetch)).rejects.toThrow(/\/:/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries a 5xx from the app page and rechecks health", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(health())
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(health())
      .mockResolvedValueOnce(html());
    await expect(verify(fetch)).resolves.toBe("deployed");
    expect(fetch.mock.calls.map(([url]) => url.pathname)).toEqual([
      "/api/health",
      "/",
      "/api/health",
      "/",
    ]);
  });
});
