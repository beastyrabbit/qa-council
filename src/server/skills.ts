import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CANONICAL_SKILL_FILES = [
  "00_README.md",
  "01_QA-Architekt.md",
  "02_Test-Manager.md",
  "03_Test-Analyst.md",
  "04_Test-Automation-Engineer.md",
  "05_Tester.md",
  "06_QA-Council.md",
  "07_RACI-Team-Matrix.md",
] as const;

export const EXPECTED_SKILL_HASHES: Record<(typeof CANONICAL_SKILL_FILES)[number], string> = {
  "00_README.md": "9540f5b46adeccc6e704321474f3a15fdb49373e1113bda7163de9fa1a5cc9b9",
  "01_QA-Architekt.md": "4defbe1564f1cd46f85c14b44632287f5ebe2dc08a1d42358ed9c6b97d932151",
  "02_Test-Manager.md": "cb1ae6075566397c8922061acc11906e4992ab2e42c26bdde8747c4480dc6ef2",
  "03_Test-Analyst.md": "7985ee2ebfedb269ba3c7c8121e58b8b49fb0e5b21f74d3cba878e0fa0575591",
  "04_Test-Automation-Engineer.md":
    "8e16737801b24e55940acc3b2cb142054a906a4da87c60ad54aa262ad42046f0",
  "05_Tester.md": "1c4df5770f6051b298395b2879915bb8d233ef21af916c45f090447398fc32c6",
  "06_QA-Council.md": "c88107a984cc169c5b9e836e82fc5f000c2b02f060c348f9d966c9fcd4946dc1",
  "07_RACI-Team-Matrix.md": "1075f5cfc6a64e7ef80d819bfe99e914244fa2ac406d878f0e67ca8cf761f58e",
};

const candidates = [
  path.resolve("resources/qa/source"),
  path.resolve(process.cwd(), "../resources/qa/source"),
  "/app/resources/qa/source",
];

export const REPORT_DESIGN_SKILL_FILE = "report-designer/SKILL.md";
export const EXPECTED_REPORT_DESIGN_SKILL_HASH =
  "baec66030215658f5e9f262e68daa0c030549dd53000d7d7e13908a565676c7f";

const reportSkillCandidates = [
  path.resolve("resources/skills"),
  path.resolve(process.cwd(), "../resources/skills"),
  "/app/resources/skills",
];

export function skillDirectory(): string {
  const directory = candidates.find((candidate) => fs.existsSync(candidate));
  if (!directory) throw new Error("Kanonische QA-Skill-Quellen wurden nicht gefunden.");
  return directory;
}

export function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function loadCanonicalSkills(): Record<string, string> {
  const directory = skillDirectory();
  return Object.fromEntries(
    CANONICAL_SKILL_FILES.map((filename) => {
      const content = fs.readFileSync(path.join(directory, filename));
      const actual = sha256(content);
      if (actual !== EXPECTED_SKILL_HASHES[filename]) {
        throw new Error(`Integritätsfehler in ${filename}: ${actual}`);
      }
      return [filename, content.toString("utf8")];
    }),
  );
}

export function completeCouncilSource(): string {
  const skills = loadCanonicalSkills();
  return CANONICAL_SKILL_FILES.map(
    (filename) => `\n\n===== KANONISCHE QUELLE: ${filename} =====\n\n${skills[filename]}`,
  ).join("");
}

export function loadReportDesignSkill(): string {
  const directory = reportSkillCandidates.find((candidate) => fs.existsSync(candidate));
  if (!directory) throw new Error("Der kanonische Report-Design-Skill wurde nicht gefunden.");
  const content = fs.readFileSync(path.join(directory, REPORT_DESIGN_SKILL_FILE));
  const actual = sha256(content);
  if (actual !== EXPECTED_REPORT_DESIGN_SKILL_HASH) {
    throw new Error(`Integritätsfehler in ${REPORT_DESIGN_SKILL_FILE}: ${actual}`);
  }
  return content.toString("utf8");
}

export function roleSkillFile(role: string): string {
  const map: Record<string, string> = {
    "QA-Architekt": "01_QA-Architekt.md",
    "Test-Manager": "02_Test-Manager.md",
    "Test-Analyst": "03_Test-Analyst.md",
    "Test-Automation-Engineer": "04_Test-Automation-Engineer.md",
    Tester: "05_Tester.md",
  };
  return map[role] ?? "05_Tester.md";
}
