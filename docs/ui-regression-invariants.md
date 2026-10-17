# UI-Regressionshinweise

## Report-CSS

`src/web/styles.css` ist eine gemeinsame Laufzeitquelle: `src/server/pdf.ts` lädt sie für
PDF- und Screenshot-Exporte. Die Tests in `src/web/styles.test.ts` prüfen die drei
`@scope (.rendered-result:not(.rendered-result--authored))`-Blöcke, die drei
`legacy-report`-Layer und weitere Selektoren. Die Datei darf deshalb nicht in separate
Chrome- und Report-Dateien aufgeteilt werden, ohne diese Kopplung und die PDF-Ausgabe
gleichzeitig anzupassen.

Autoren-Reports werden über `rendered-result--authored` vom generischen Report-CSS isoliert.
Die Report-Designer-Stufe schreibt ihre eigenen Report-Dateien; die gesperrte
Anwendungs-CSS bleibt dabei systemseitig vorgegeben und schreibgeschützt
([`docs/architecture.md`](architecture.md)).

## TypeScript-Aliase

Der Workspace verwendet `paths` in `tsconfig.json` und einen separaten `resolve.alias` in
`vitest.config.ts`. `baseUrl` gehört nicht in die TypeScript-Konfiguration.

## GUI-Smoke-Hooks

`test/gui-smoke.mjs` prüft stabile Klassen und IDs, unter anderem `.upload-zone`,
`.test-provider`, `.run-layout`, `.archive-row`, `.document-detail` und
`.run-toolbar__actions`. Diese Hooks sind Teil des Smoke-Vertrags und dürfen bei UI-
Umgestaltungen nicht entfernt werden.
