# QA Council Project Guidelines

## Testing and Live AI
- Keep `pnpm check`, Vitest, CI, and GUI smoke tests offline and deterministic; they must not require provider credentials or start an AI analysis.
- Never call a live AI provider from an automated test. Every token costs money, so automated test runs must not waste or incur token costs.
- Run a live AI acceptance analysis only when the user explicitly requests that specific run, with at most one manual run per explicit request.
- Never test with OpenRouter unless the user explicitly requests that specific OpenRouter test.
