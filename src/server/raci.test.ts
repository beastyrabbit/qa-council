import { describe, expect, it } from "vitest";
import { compileRaciAssignments, raciCatalog } from "./raci.js";

describe("kanonischer RACI-Katalog", () => {
  it("parst und validiert alle 37 Aktivitätszeilen", () => {
    const catalog = raciCatalog();
    expect(catalog.size).toBe(37);
    expect(catalog.get("3.5")?.responsibilities).toMatchObject({
      "QA-Architekt": "A",
      "Test-Analyst": "R",
      Tester: "C",
    });
    expect(catalog.get("1.1")?.responsibilities["Test-Manager"]).toBe("A/R");
    expect(catalog.get("2.1")?.responsibilities["Test-Analyst"]).toBe("A/R");
    expect(catalog.get("4.1a")?.responsibilities["Test-Automation-Engineer"]).toBe("A/R");
  });

  it("leitet A/R serverseitig ab und übernimmt nur gültige C-Opt-ins", () => {
    const result = compileRaciAssignments([
      {
        id: "3.5",
        evidence: ["Abschnitt Akzeptanzkriterien"],
        triggerStatus: "satisfied",
        consultants: ["Tester"],
        rationale: "Die Story enthält konkrete Akzeptanzkriterien.",
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.assignments).toEqual([
      expect.objectContaining({ role: "QA-Architekt", participation: "full" }),
      expect.objectContaining({ role: "Test-Analyst", participation: "full" }),
      expect.objectContaining({ role: "Tester", participation: "consulted" }),
    ]);
  });

  it("weist erfundene IDs und falsche Consultants zurück", () => {
    const result = compileRaciAssignments([
      {
        id: "9.9",
        evidence: ["nirgendwo"],
        triggerStatus: "satisfied",
        consultants: [],
        rationale: "erfunden",
      },
      {
        id: "3.5",
        evidence: ["AC"],
        triggerStatus: "satisfied",
        consultants: ["Test-Manager"],
        rationale: "falsche C-Rolle",
      },
    ]);
    expect(result.errors).toContain("RACI 9.9 existiert nicht.");
    expect(result.errors).toContain("RACI 3.5: Test-Manager ist keine C-Rolle.");
  });

  it("normalisiert den deterministischen CHUNK-Präfix vor der Locator-Prüfung", () => {
    const locator = "Offene Entscheidung · Zeilen 17–25";
    const result = compileRaciAssignments(
      [
        {
          id: "3.5",
          evidence: [`CHUNK 1/1: ${locator}`],
          triggerStatus: "satisfied",
          consultants: [],
          rationale: "Die Akzeptanzkriterien benötigen eine Prüfung.",
        },
      ],
      new Set(["Offene Entscheidung · Zeilen 1–32"]),
    );

    expect(result.errors).toEqual([]);
    expect(result.assignments[0].mandates[0].evidence).toEqual([locator]);
  });

  it("normalisiert eindeutige englische Rollen-Aliase aus Modellantworten", () => {
    const result = compileRaciAssignments([
      {
        id: "1.4",
        evidence: ["Akzeptanzkriterien"],
        triggerStatus: "satisfied",
        consultants: ["Test Automation Engineer"],
        rationale: "Die Automatisierbarkeit muss konsultativ bewertet werden.",
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.assignments).toContainEqual(
      expect.objectContaining({
        role: "Test-Automation-Engineer",
        participation: "consulted",
      }),
    );
  });

  it("akzeptiert tester sowie Bindestrich- und Leerzeichenvarianten", () => {
    const result = compileRaciAssignments([
      {
        id: "3.5",
        evidence: ["Akzeptanzkriterien"],
        triggerStatus: "satisfied",
        consultants: ["tester"],
        rationale: "Die praktische Ausführungssicht wird konsultativ benötigt.",
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.assignments).toContainEqual(
      expect.objectContaining({ role: "Tester", participation: "consulted" }),
    );
  });
});
