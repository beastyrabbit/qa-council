import { describe, expect, it } from "vitest";
import { settleParallel } from "./orchestrator.js";

describe("settleParallel", () => {
  it("bricht Geschwisteraufrufe nach dem ersten endgültigen Fehler ab", async () => {
    let siblingAborted = false;

    await expect(
      settleParallel([
        async () => {
          throw new Error("fatal");
        },
        (signal) =>
          new Promise<never>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                siblingAborted = true;
                reject(signal.reason);
              },
              { once: true },
            );
          }),
      ]),
    ).rejects.toThrow("fatal");

    expect(siblingAborted).toBe(true);
  });
});
