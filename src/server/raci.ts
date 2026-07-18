import { loadCanonicalSkills } from "./skills.js";

export const QA_ROLES = [
  "QA-Architekt",
  "Test-Manager",
  "Test-Analyst",
  "Tester",
  "Test-Automation-Engineer",
] as const;
export type QaRole = (typeof QA_ROLES)[number];
export type RaciResponsibility = "A" | "R" | "A/R" | "C";

const ROLE_COLUMNS: QaRole[] = [
  "QA-Architekt",
  "Test-Manager",
  "Test-Analyst",
  "Tester",
  "Test-Automation-Engineer",
];

export interface RaciCatalogRow {
  id: string;
  activity: string;
  responsibilities: Record<QaRole, "A" | "R" | "A/R" | "C" | "I" | null>;
  trigger: string;
  artifact: string;
}

export interface ProposedActivityRoute {
  id: string;
  evidence: string[];
  consultants?: string[];
  triggerStatus: "satisfied" | "missing" | "unclear";
  missingInputs?: string[];
  rationale: string;
}

export interface RowMandate {
  activityId: string;
  activity: string;
  responsibility: RaciResponsibility;
  trigger: string;
  triggerStatus: ProposedActivityRoute["triggerStatus"];
  missingInputs: string[];
  expectedArtifact: string;
  evidence: string[];
  rationale: string;
}

export interface CompiledRoleAssignment {
  role: QaRole;
  participation: "full" | "consulted";
  mandates: RowMandate[];
}

let catalogCache: Map<string, RaciCatalogRow> | undefined;

function parseResponsibility(value: string) {
  const normalized = value.replaceAll("*", "").trim();
  if (["A", "R", "A/R", "C", "I"].includes(normalized)) {
    return normalized as "A" | "R" | "A/R" | "C" | "I";
  }
  return null;
}

export function parseRaciCatalog(markdown: string) {
  const rows = new Map<string, RaciCatalogRow>();
  for (const line of markdown.split("\n")) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length !== 9 || !/^\d+\.\d+a?$/.test(cells[0] ?? "")) continue;
    const responsibilities = Object.fromEntries(
      ROLE_COLUMNS.map((role, index) => [role, parseResponsibility(cells[index + 2] ?? "")]),
    ) as RaciCatalogRow["responsibilities"];
    rows.set(cells[0], {
      id: cells[0],
      activity: cells[1],
      responsibilities,
      trigger: cells[7],
      artifact: cells[8],
    });
  }
  validateRaciCatalog(rows);
  return rows;
}

export function validateRaciCatalog(rows: Map<string, RaciCatalogRow>) {
  if (rows.size !== 37) throw new Error(`RACI-Katalog enthält ${rows.size} statt 37 Zeilen.`);
  for (const row of rows.values()) {
    const values = Object.values(row.responsibilities);
    if (values.filter((value) => value === "A" || value === "A/R").length !== 1) {
      throw new Error(`RACI ${row.id}: genau eine A-Rolle ist erforderlich.`);
    }
    if (!values.some((value) => value === "R" || value === "A/R")) {
      throw new Error(`RACI ${row.id}: mindestens eine R-Rolle ist erforderlich.`);
    }
    if (values.some((value) => value === null)) {
      throw new Error(`RACI ${row.id}: jede Rolle muss klassifiziert sein.`);
    }
    if (!row.activity || !row.trigger || !row.artifact) {
      throw new Error(`RACI ${row.id}: Aktivität, Trigger und Artefakt sind Pflicht.`);
    }
  }
  const atdd = rows.get("3.5");
  if (
    atdd?.responsibilities["QA-Architekt"] !== "A" ||
    atdd.responsibilities["Test-Analyst"] !== "R" ||
    atdd.responsibilities.Tester !== "C"
  ) {
    throw new Error("RACI 3.5 entspricht nicht dem kanonischen A/R/C-Sonderfall.");
  }
}

export function raciCatalog() {
  catalogCache ??= parseRaciCatalog(loadCanonicalSkills()["07_RACI-Team-Matrix.md"]);
  return catalogCache;
}

export function compileRaciAssignments(
  proposals: ProposedActivityRoute[],
  allowedLocators?: ReadonlySet<string>,
) {
  const isAllowedLocator = (candidate: string) => {
    if (!allowedLocators || allowedLocators.has(candidate)) return true;
    const parsedCandidate = candidate.match(/^(.*?)\s+·\s+Zeilen\s+(\d+)[–-](\d+)$/i);
    if (!parsedCandidate) return false;
    const candidateStart = Number(parsedCandidate[2]);
    const candidateEnd = Number(parsedCandidate[3]);
    return [...allowedLocators].some((allowed) => {
      const parsedAllowed = allowed.match(/^(.*?)\s+·\s+Zeilen\s+(\d+)[–-](\d+)$/i);
      return (
        parsedAllowed?.[1].trim() === parsedCandidate[1].trim() &&
        candidateStart >= Number(parsedAllowed[2]) &&
        candidateEnd <= Number(parsedAllowed[3])
      );
    });
  };
  const catalog = raciCatalog();
  const errors: string[] = [];
  const seen = new Set<string>();
  const mandates = new Map<QaRole, RowMandate[]>();

  if (proposals.length === 0) errors.push("Keine RACI-Aktivität wurde ausgewählt.");
  for (const proposal of proposals) {
    if (!proposal || typeof proposal !== "object") {
      errors.push("Ein RACI-Vorschlag ist kein Objekt.");
      continue;
    }
    if (seen.has(proposal.id)) {
      errors.push(`RACI ${proposal.id} wurde doppelt ausgewählt.`);
      continue;
    }
    seen.add(proposal.id);
    const row = catalog.get(proposal.id);
    if (!row) {
      errors.push(`RACI ${proposal.id} existiert nicht.`);
      continue;
    }
    if (typeof proposal.rationale !== "string" || !proposal.rationale.trim()) {
      errors.push(`RACI ${proposal.id} hat keine Begründung.`);
    }
    const normalizedEvidence = Array.isArray(proposal.evidence)
      ? proposal.evidence.map((locator) => {
          if (typeof locator !== "string") return locator;
          const trimmed = locator.trim();
          if (!allowedLocators || allowedLocators.has(trimmed)) return trimmed;
          return trimmed
            .replace(/^(?:---\s*)?CHUNK\s+\d+\/\d+\s*:\s*/i, "")
            .replace(/\s*---$/, "")
            .trim();
        })
      : [];
    if (normalizedEvidence.length === 0) {
      errors.push(`RACI ${proposal.id} hat keinen Dokumentbeleg.`);
    } else if (
      normalizedEvidence.some(
        (locator) => typeof locator !== "string" || !locator.trim() || !isAllowedLocator(locator),
      )
    ) {
      errors.push(`RACI ${proposal.id} enthält einen unbekannten oder leeren Dokument-Locator.`);
    }
    if (!["satisfied", "missing", "unclear"].includes(proposal.triggerStatus)) {
      errors.push(`RACI ${proposal.id} hat keinen gültigen Triggerstatus.`);
    }
    if (
      proposal.triggerStatus !== "satisfied" &&
      (!Array.isArray(proposal.missingInputs) ||
        proposal.missingInputs.length === 0 ||
        proposal.missingInputs.some((input) => typeof input !== "string" || !input.trim()))
    ) {
      errors.push(`RACI ${proposal.id} benötigt konkrete fehlende Inputs.`);
    }

    const add = (role: QaRole, responsibility: RaciResponsibility) => {
      const roleMandates = mandates.get(role) ?? [];
      roleMandates.push({
        activityId: row.id,
        activity: row.activity,
        responsibility,
        trigger: row.trigger,
        triggerStatus: proposal.triggerStatus,
        missingInputs: proposal.missingInputs ?? [],
        expectedArtifact: row.artifact,
        evidence: normalizedEvidence as string[],
        rationale: proposal.rationale ?? "",
      });
      mandates.set(role, roleMandates);
    };

    for (const role of QA_ROLES) {
      const responsibility = row.responsibilities[role];
      if (responsibility === "A" || responsibility === "R" || responsibility === "A/R") {
        add(role, responsibility);
      }
    }
    const roleAliases = new Map<string, QaRole>([
      ["qaarchitect", "QA-Architekt"],
      ["testmanager", "Test-Manager"],
      ["testanalyst", "Test-Analyst"],
      ["tester", "Tester"],
      ["testautomationengineer", "Test-Automation-Engineer"],
    ]);
    const normalizeAlias = (value: unknown) =>
      String(value)
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, "");
    const consultants = Array.isArray(proposal.consultants)
      ? [
          ...new Set(
            proposal.consultants.map(
              (consultant) => roleAliases.get(normalizeAlias(consultant)) ?? consultant,
            ),
          ),
        ]
      : [];
    for (const consultant of consultants) {
      if (!QA_ROLES.includes(consultant as QaRole)) {
        errors.push(`RACI ${proposal.id}: unbekannte C-Rolle ${consultant}.`);
        continue;
      }
      const role = consultant as QaRole;
      if (row.responsibilities[role] !== "C") {
        errors.push(`RACI ${proposal.id}: ${role} ist keine C-Rolle.`);
        continue;
      }
      add(role, "C");
    }
  }

  const assignments = [...mandates.entries()].map(([role, roleMandates]) => ({
    role,
    participation: roleMandates.some((mandate) => mandate.responsibility !== "C")
      ? ("full" as const)
      : ("consulted" as const),
    mandates: roleMandates,
  }));
  return { assignments, errors };
}

export function formatRoleMandates(assignment: CompiledRoleAssignment) {
  return assignment.mandates
    .map(
      (mandate, index) => `${index + 1}. Aktivität ${mandate.activityId} — ${mandate.activity}
   Verantwortung: ${mandate.responsibility}
   Teilnahme auf dieser Zeile: ${mandate.responsibility === "C" ? "konsultativ" : "voll"}
   Handoff-Trigger: ${mandate.trigger}
   Triggerstatus: ${mandate.triggerStatus}
   Fehlende Inputs: ${mandate.missingInputs.join("; ") || "keine"}
   Erwartetes Artefakt: ${mandate.expectedArtifact}
   Dokumentbeleg: ${mandate.evidence.join("; ")}
   Routing-Begründung: ${mandate.rationale}`,
    )
    .join("\n\n");
}
