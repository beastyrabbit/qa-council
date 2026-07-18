import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, type SqliteDatabase } from "./db/index.js";
import { RunScheduler } from "./scheduler.js";

const databases: SqliteDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("zentrale Run-Queue", () => {
  it("beachtet globale und providerbezogene Run-Limits", async () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const started: string[] = [];
    const scheduler = new RunScheduler(
      database,
      async (runId) => {
        started.push(runId);
        const gate = deferred();
        gates.set(runId, gate);
        await gate.promise;
      },
      {
        runs: 2,
        providerRuns: { codex: 1, openrouter: 2, aibox: 1 },
        inference: { codex: 2, openrouter: 2, aibox: 1 },
      },
    );
    scheduler.enqueue({ runId: "c1", provider: "codex" });
    scheduler.enqueue({ runId: "c2", provider: "codex" });
    scheduler.enqueue({ runId: "o1", provider: "openrouter" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(["c1", "o1"]);
    expect(scheduler.snapshot().active).toBe(2);

    gates.get("c1")?.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(["c1", "o1", "c2"]);
    gates.get("c2")?.resolve();
    gates.get("o1")?.resolve();
  });

  it("begrenzt Inference-Slots pro Provider", async () => {
    const database = createDatabase(":memory:");
    databases.push(database);
    const scheduler = new RunScheduler(database, async () => {}, {
      runs: 1,
      providerRuns: { codex: 1, openrouter: 1, aibox: 1 },
      inference: { codex: 1, openrouter: 1, aibox: 1 },
    });
    const gate = deferred();
    const order: string[] = [];
    const first = scheduler.withInferenceSlot("codex", undefined, async () => {
      order.push("first");
      await gate.promise;
    });
    const second = scheduler.withInferenceSlot("codex", undefined, async () => {
      order.push("second");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["first"]);
    expect(scheduler.snapshot().inference.codex.waiting).toBe(1);
    gate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });
});
