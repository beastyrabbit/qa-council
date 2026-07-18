import { describe, expect, it } from "vitest";
import { routeFromPath } from "./App.js";

describe("persistente Frontend-Routen", () => {
  it.each([
    ["/pruefen", "review"],
    ["/dokumente", "documents"],
    ["/laeufe", "runs"],
    ["/tests", "tests"],
    ["/archiv", "archive"],
    ["/einstellungen", "settings"],
  ] as const)("ordnet %s der Ansicht %s zu", (pathname, view) => {
    expect(routeFromPath(pathname).view).toBe(view);
  });

  it("erhält IDs auf kanonischen Detailseiten", () => {
    expect(routeFromPath("/dokumente/doc-1")).toMatchObject({
      view: "documents",
      documentId: "doc-1",
    });
    expect(routeFromPath("/laeufe/run-1")).toMatchObject({
      view: "runs",
      runId: "run-1",
    });
  });

  it("erkennt reload-sichere Dateirouten mit Attempt", () => {
    expect(routeFromPath("/laeufe/run-1/dateien/art-2", "?attempt=3")).toMatchObject({
      fileRunId: "run-1",
      artifactId: "art-2",
      fileAttempt: 3,
    });
  });
});
