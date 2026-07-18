import type { z } from "zod";

export interface StructuredToolCall {
  name: string;
  callId: string;
  args: unknown;
}

export interface StructuredTurn<TStage> {
  stage: TStage;
  content: string;
  toolCalls: StructuredToolCall[];
}

export class SupervisorSubmissionError extends Error {
  override name = "SupervisorSubmissionError";
}

export function validateSingleSubmission<T>(options: {
  calls: StructuredToolCall[];
  submitName: string;
  schema: z.ZodType<T>;
  semanticValidate?: (value: T) => string[];
  content?: string;
  contentValidate?: (content: string) => string[];
}) {
  const submits = options.calls.filter((call) => call.name === options.submitName);
  const errors: string[] = [];
  if (submits.length !== 1) {
    errors.push(
      submits.length === 0
        ? `Der erforderliche Tool-Aufruf ${options.submitName} fehlt.`
        : `${options.submitName} wurde ${submits.length}-mal statt genau einmal aufgerufen.`,
    );
  }
  const parsed = submits.length === 1 ? options.schema.safeParse(submits[0]?.args) : undefined;
  if (parsed && !parsed.success) {
    errors.push(...parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  errors.push(...(options.contentValidate?.(options.content ?? "") ?? []));
  if (parsed?.success) {
    errors.push(...(options.semanticValidate?.(parsed.data) ?? []));
    if (errors.length === 0) return { success: true as const, value: parsed.data, errors };
  }
  return { success: false as const, errors };
}

export async function runSubmissionRepairs<T, TStage>(options: {
  submitName: string;
  schema: z.ZodType<T>;
  semanticValidate?: (value: T) => string[];
  contentValidate?: (content: string) => string[];
  execute: (
    attempt: number,
    feedback: { errors: string[]; previousRaw: string },
  ) => Promise<StructuredTurn<TStage>>;
}) {
  let previousRaw = "";
  let errors: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const turn = await options.execute(attempt, { errors, previousRaw });
    const validation = validateSingleSubmission({
      calls: turn.toolCalls,
      submitName: options.submitName,
      schema: options.schema,
      semanticValidate: options.semanticValidate,
      content: turn.content,
      contentValidate: options.contentValidate,
    });
    if (validation.success) return { stage: turn.stage, value: validation.value };
    errors = validation.errors;
    previousRaw = JSON.stringify({ text: turn.content, toolCalls: turn.toolCalls });
  }
  throw new SupervisorSubmissionError(
    `${options.submitName} blieb nach zwei Reparaturversuchen ungültig: ${errors.join(" ")}`,
  );
}
