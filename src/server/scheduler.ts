import type { ProviderId } from "../shared/types.js";
import type { SqliteDatabase } from "./db/index.js";
import { withDatabase } from "./db/index.js";

export interface SchedulerLimits {
  runs: number;
  providerRuns: Record<ProviderId, number>;
  inference: Record<ProviderId, number>;
}

export interface ScheduledRun {
  runId: string;
  provider: ProviderId;
}

const integerEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

export function defaultSchedulerLimits(): SchedulerLimits {
  return {
    runs: integerEnv("RUN_SLOTS", 3),
    providerRuns: {
      codex: integerEnv("CODEX_RUN_SLOTS", 2),
      openrouter: integerEnv("OPENROUTER_RUN_SLOTS", 2),
      aibox: integerEnv("AIBOX_RUN_SLOTS", 1),
    },
    inference: {
      codex: integerEnv("CODEX_INFERENCE_SLOTS", 6),
      openrouter: integerEnv("OPENROUTER_INFERENCE_SLOTS", 6),
      aibox: integerEnv("AIBOX_INFERENCE_SLOTS", 2),
    },
  };
}

class InferencePool {
  private active = 0;
  private readonly waiting: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
    abort?: () => void;
  }> = [];

  constructor(private readonly limit: number) {}

  async use<T>(signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
    signal?.throwIfAborted();
    if (this.active >= this.limit) {
      await new Promise<void>((resolve, reject) => {
        const item: (typeof this.waiting)[number] = { resolve, reject, signal };
        item.abort = () => {
          const index = this.waiting.indexOf(item);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(new DOMException("Vorgang abgebrochen.", "AbortError"));
        };
        signal?.addEventListener("abort", item.abort, { once: true });
        this.waiting.push(item);
      });
    }
    signal?.throwIfAborted();
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.release();
    }
  }

  private release() {
    while (this.active < this.limit) {
      const next = this.waiting.shift();
      if (!next) return;
      if (next.abort) next.signal?.removeEventListener("abort", next.abort);
      if (next.signal?.aborted) {
        next.reject(new DOMException("Vorgang abgebrochen.", "AbortError"));
        continue;
      }
      next.resolve();
      return;
    }
  }

  snapshot() {
    return { active: this.active, waiting: this.waiting.length, limit: this.limit };
  }
}

export class RunScheduler {
  private readonly pending: ScheduledRun[] = [];
  private readonly known = new Set<string>();
  private readonly activeByProvider: Record<ProviderId, number> = {
    codex: 0,
    openrouter: 0,
    aibox: 0,
  };
  private active = 0;
  private draining = false;
  private readonly inferencePools: Record<ProviderId, InferencePool>;

  constructor(
    private readonly database: SqliteDatabase,
    private readonly execute: (runId: string) => Promise<void>,
    readonly limits = defaultSchedulerLimits(),
  ) {
    this.inferencePools = {
      codex: new InferencePool(limits.inference.codex),
      openrouter: new InferencePool(limits.inference.openrouter),
      aibox: new InferencePool(limits.inference.aibox),
    };
  }

  enqueue(job: ScheduledRun) {
    if (this.known.has(job.runId)) return false;
    this.known.add(job.runId);
    this.pending.push(job);
    queueMicrotask(() => this.drain());
    return true;
  }

  async withInferenceSlot<T>(
    provider: ProviderId,
    signal: AbortSignal | undefined,
    task: () => Promise<T>,
  ) {
    return this.inferencePools[provider].use(signal, task);
  }

  private drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.active < this.limits.runs) {
        const index = this.pending.findIndex(
          (job) => this.activeByProvider[job.provider] < this.limits.providerRuns[job.provider],
        );
        if (index < 0) break;
        const [job] = this.pending.splice(index, 1);
        if (!job) break;
        this.active += 1;
        this.activeByProvider[job.provider] += 1;
        void withDatabase(this.database, () => this.execute(job.runId))
          .catch(() => {
            // executeRun records its own terminal error. This catch protects the scheduler.
          })
          .finally(() => {
            this.active -= 1;
            this.activeByProvider[job.provider] -= 1;
            this.known.delete(job.runId);
            this.drain();
          });
      }
    } finally {
      this.draining = false;
    }
  }

  snapshot() {
    return {
      active: this.active,
      pending: this.pending.map((job) => ({ ...job })),
      activeByProvider: { ...this.activeByProvider },
      inference: {
        codex: this.inferencePools.codex.snapshot(),
        openrouter: this.inferencePools.openrouter.snapshot(),
        aibox: this.inferencePools.aibox.snapshot(),
      },
    };
  }
}
