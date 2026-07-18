import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  runSubmissionRepairs,
  SupervisorSubmissionError,
  validateSingleSubmission,
} from "./structured-submit.js";

const schema = z.object({ value: z.string().min(1) }).strict();
const call = (args: unknown, callId = "call-1") => ({
  name: "submit_test",
  callId,
  args,
});

describe("strukturierte Supervisor-Submits", () => {
  it("lehnt fehlende, doppelte und schema-ungültige Submits ab", () => {
    expect(
      validateSingleSubmission({ calls: [], submitName: "submit_test", schema }).errors[0],
    ).toContain("fehlt");
    expect(
      validateSingleSubmission({
        calls: [call({ value: "a" }), call({ value: "b" }, "call-2")],
        submitName: "submit_test",
        schema,
      }).errors[0],
    ).toContain("2-mal");
    expect(
      validateSingleSubmission({
        calls: [call({ value: "" })],
        submitName: "submit_test",
        schema,
      }).success,
    ).toBe(false);
  });

  it("kann zusätzlich erforderlichen Markdown-Inhalt validieren", () => {
    expect(
      validateSingleSubmission({
        calls: [call({ value: "ok" })],
        submitName: "submit_test",
        schema,
        content: "",
        contentValidate: (content) => (content.trim() ? [] : ["Markdown-Kritik fehlt."]),
      }),
    ).toMatchObject({ success: false, errors: ["Markdown-Kritik fehlt."] });
  });

  it("führt höchstens zwei stateless Reparaturen aus", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ stage: 0, content: "roh", toolCalls: [] })
      .mockResolvedValueOnce({ stage: 1, content: "", toolCalls: [call({ value: "" })] })
      .mockResolvedValueOnce({ stage: 2, content: "", toolCalls: [call({ value: "ok" })] });
    await expect(
      runSubmissionRepairs({ submitName: "submit_test", schema, execute }),
    ).resolves.toEqual({ stage: 2, value: { value: "ok" } });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("liefert nach zwei erfolglosen Reparaturen einen benannten Fehler", async () => {
    await expect(
      runSubmissionRepairs({
        submitName: "submit_test",
        schema,
        execute: async (attempt) => ({ stage: attempt, content: "", toolCalls: [] }),
      }),
    ).rejects.toBeInstanceOf(SupervisorSubmissionError);
  });
});
