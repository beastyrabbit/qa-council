import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

class RetryableError extends Error {}

function parseVersion(version) {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(
      version,
    );
  if (!match) throw new Error(`Invalid semver: ${version}`);
  const prerelease = match[4]?.split(".");
  if (prerelease?.some((part) => /^0\d+$/.test(part))) {
    throw new Error(`Invalid semver: ${version}`);
  }
  return { core: match.slice(1, 4).map(BigInt), prerelease };
}

function compareVersions(actual, expected) {
  for (let i = 0; i < 3; i++) {
    if (actual.core[i] !== expected.core[i]) return actual.core[i] > expected.core[i] ? 1 : -1;
  }
  const a = actual.prerelease;
  const b = expected.prerelease;
  if (!a || !b) return a === b ? 0 : a ? -1 : 1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    if (a[i] === undefined || b[i] === undefined) return a[i] === undefined ? -1 : 1;
    const aNumeric = /^\d+$/.test(a[i]);
    const bNumeric = /^\d+$/.test(b[i]);
    if (aNumeric && bNumeric) return BigInt(a[i]) > BigInt(b[i]) ? 1 : -1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

export async function verifyDeployment({
  baseUrl,
  expectedVersion,
  timeoutMs = 30 * 60 * 1000,
  pollIntervalMs = 20_000,
  requestTimeoutMs = 10_000,
  fetchImpl = globalThis.fetch,
  log = console.log,
}) {
  const base = new URL(baseUrl);
  if (!["http:", "https:"].includes(base.protocol)) {
    throw new Error("Deployment URL must use HTTP or HTTPS");
  }
  const expected = parseVersion(expectedVersion);
  for (const value of [timeoutMs, pollIntervalMs, requestTimeoutMs]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error("Timeouts and poll interval must be positive integers");
    }
  }
  const deadline = Date.now() + timeoutMs;
  let lastState = "No response yet";

  async function request(path, contentType) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new RetryableError("Overall timeout reached");
    const signal = AbortSignal.timeout(Math.min(requestTimeoutMs, remaining));
    let response;
    try {
      response = await fetchImpl(new URL(path, base), {
        redirect: "manual",
        cache: "no-store",
        signal,
      });
    } catch (error) {
      throw new RetryableError(`${path}: ${error.message}`);
    }
    if (response.status >= 500 && response.status <= 599) {
      await response.body?.cancel();
      throw new RetryableError(`${path}: HTTP ${response.status}`);
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error(
        `${path}: unexpected HTTP ${response.status}, auth or redirect is not allowed`,
      );
    }
    const actualType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (actualType !== contentType) {
      await response.body?.cancel();
      throw new Error(
        `${path}: expected ${contentType}, received ${actualType ?? "no content type"}`,
      );
    }
    try {
      return await response.text();
    } catch (error) {
      throw new RetryableError(`${path}: ${error.message}`);
    }
  }

  while (Date.now() < deadline) {
    try {
      const body = await request("/api/health", "application/json");
      let health;
      try {
        health = JSON.parse(body);
      } catch {
        throw new Error("/api/health: malformed JSON");
      }
      if (
        health?.ok !== true ||
        typeof health.version !== "string" ||
        !Number.isInteger(health.schemaVersion) ||
        health.schemaVersion < 0
      ) {
        throw new Error(
          "/api/health: expected { ok: true, version: semver, schemaVersion: integer }",
        );
      }
      const comparison = compareVersions(parseVersion(health.version), expected);
      if (comparison > 0) {
        log(`Release ${expectedVersion} superseded by deployed version ${health.version}`);
        return "superseded";
      }
      lastState = `Deployed version ${health.version}; expected ${expectedVersion}`;
      if (health.version === expectedVersion) {
        const html = await request("/", "text/html");
        if (
          !html.includes("<title>QA Council</title>") ||
          !html.includes('<div id="root"></div>')
        ) {
          throw new Error("/: HTML does not contain the QA Council app markers");
        }
        log(`Deployment verified: ${expectedVersion}, health and app HTML are ready`);
        return "deployed";
      }
    } catch (error) {
      if (!(error instanceof RetryableError)) throw error;
      lastState = error.message;
    }
    log(lastState);
    const remaining = deadline - Date.now();
    if (remaining > 0) await sleep(Math.min(pollIntervalMs, remaining));
  }
  throw new Error(`Deployment timed out after ${timeoutMs} ms: ${lastState}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyDeployment({
    baseUrl: process.env.DEPLOYMENT_URL,
    expectedVersion: process.env.EXPECTED_VERSION,
    timeoutMs: Number(process.env.DEPLOYMENT_TIMEOUT_MS ?? 1_800_000),
    pollIntervalMs: Number(process.env.DEPLOYMENT_POLL_INTERVAL_MS ?? 20_000),
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
