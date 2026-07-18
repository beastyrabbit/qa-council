export function workflowPhaseForArtifact(kind: string) {
  if (kind === "document-extraction" || kind === "coverage-manifest") return "Extraction";
  if (kind.startsWith("evidence")) return "Evidence";
  if (kind === "triage") return "Routing/RACI";
  if (kind.startsWith("role-review")) return "Rollenreviews";
  if (kind.startsWith("cross-review")) return "Peer-Reviews und Ranking";
  if (kind === "joint-review") return "Gemeinsames Review";
  if (kind.startsWith("debate-")) return "Pro/Contra-Debatte";
  if (kind.startsWith("council-round")) return "Council-Runden";
  if (["synthesis", "dissent-pass", "final"].includes(kind)) return "Synthese und Dissent-Audit";
  if (kind.startsWith("report-")) return "Reports";
  return "Weitere Artefakte";
}
