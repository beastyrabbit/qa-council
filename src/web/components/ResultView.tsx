/* biome-ignore-all lint/security/noDangerouslySetInnerHtml: Presentation-HTML wird serverseitig per expliziter Allowlist sanitisiert. */
import { ArrowLeft, Copy, Download, ListChecks, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  DerivedAnalysisRecord,
  PresentationKind,
  PresentationRecord,
  RunDetails,
} from "../../shared/types";
import { api } from "../lib/api";
import { SanitizedMarkdown } from "./SanitizedMarkdown";

import { FORMAT_NAMES } from "./ViewShared";

export function ResultView({
  presentationId,
  pageSlug,
  onBack,
  onPresentationChange,
}: {
  presentationId: string;
  pageSlug: string | null;
  onBack: () => void;
  onPresentationChange: (id: string) => void;
}) {
  const [details, setDetails] = useState<RunDetails | null>(null);
  const [kind, setKind] = useState<PresentationKind>("text");
  const [runId, setRunId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [section, setSection] = useState<"presentation" | "top10">("presentation");
  const [presentationContent, setPresentationContent] = useState<PresentationRecord | null>(null);
  const [top10, setTop10] = useState<DerivedAnalysisRecord | null>(null);
  const [startingTop10, setStartingTop10] = useState(false);
  const load = useCallback(
    async (preferredKind?: PresentationKind) => {
      const reference = await api<PresentationRecord>(`/api/presentations/${presentationId}`);
      const value = await api<RunDetails>(`/api/runs/${reference.runId}`);
      setPresentationContent(reference);
      setDetails(value);
      setRunId(reference.runId);
      setKind(preferredKind ?? reference.kind);
      const latestTop10 = await api<DerivedAnalysisRecord | null>(
        `/api/runs/${reference.runId}/derived-analyses/top10?attempt=${reference.attemptNo}`,
      );
      setTop10(latestTop10);
    },
    [presentationId],
  );

  useEffect(() => {
    void load().catch((reason) => setError(reason.message));
  }, [load]);
  useEffect(() => {
    if (
      !details ||
      (["completed", "failed", "cancelled"].includes(details.run.status) &&
        top10?.status !== "running" &&
        top10?.status !== "queued")
    )
      return;
    const timer = window.setInterval(() => {
      void load(kind).catch((reason) => setError(reason.message));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [details, kind, load, top10?.status]);
  const presentation = presentationContent?.kind === kind ? presentationContent : undefined;
  const newspaperPage = pageSlug
    ? presentation?.pages?.find((page) => page.slug === pageSlug)
    : undefined;
  const renderedHtml = pageSlug ? newspaperPage?.html : presentation?.html;
  const hasAuthoredReportStyles = renderedHtml?.includes("data-report-workspace") ?? false;
  useEffect(() => {
    if (section === "presentation" && presentation && presentation.id !== presentationId) {
      onPresentationChange(presentation.id);
    }
  }, [onPresentationChange, presentation, presentationId, section]);

  async function selectPresentation(next: PresentationKind) {
    setSection("presentation");
    setKind(next);
    const existing = details?.presentations.find((item) => item.kind === next);
    if (existing) {
      onPresentationChange(existing.id);
      return;
    }
    const reportsAreBuilding =
      details?.artifacts.some((item) => item.kind === "final") &&
      details &&
      !["completed", "failed", "cancelled"].includes(details.run.status);
    if (reportsAreBuilding) return;
    setCreating(true);
    setError("");
    try {
      const created = await api<{ id: string }>(`/api/runs/${runId}/presentations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: next }),
      });
      onPresentationChange(created.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCreating(false);
    }
  }

  async function startTop10() {
    if (!runId) return;
    setStartingTop10(true);
    setError("");
    try {
      const analysis = await api<DerivedAnalysisRecord>(`/api/runs/${runId}/derived-analyses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "top10_next_steps" }),
      });
      setTop10(analysis);
      setSection("top10");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStartingTop10(false);
    }
  }

  return (
    <div className="result-page">
      <div className="result-toolbar">
        <button className="button button--quiet" type="button" onClick={onBack}>
          <ArrowLeft size={17} /> Zurück
        </button>
        <div className="result-tabs" role="tablist" aria-label="Darstellung">
          {(Object.keys(FORMAT_NAMES) as PresentationKind[]).map((item) => (
            <button
              className={kind === item ? "active" : ""}
              type="button"
              role="tab"
              id={`result-tab-${item}`}
              aria-controls="result-presentation-panel"
              aria-selected={kind === item}
              tabIndex={kind === item ? 0 : -1}
              key={item}
              onClick={() => void selectPresentation(item)}
            >
              {FORMAT_NAMES[item]}
            </button>
          ))}
        </div>
        <div className="result-toolbar__actions">
          <button
            className="button button--primary"
            type="button"
            disabled={startingTop10}
            onClick={() => void startTop10()}
          >
            <ListChecks size={16} />
            {startingTop10 ? "Wird gestartet …" : "Top 10 nächste Schritte"}
          </button>
          <button
            className="button button--quiet"
            type="button"
            onClick={() => void navigator.clipboard.writeText(window.location.href)}
          >
            <Copy size={16} /> URL kopieren
          </button>
          {kind === "onepaper" && (
            <a className="button button--quiet" href={`/api/presentations/${presentationId}/pdf`}>
              <Download size={17} /> PDF
            </a>
          )}
          <a className="button button--quiet" href={`/api/runs/${runId}/download`}>
            <Download size={17} /> Markdown
          </a>
        </div>
      </div>
      <nav className="result-subnav" aria-label="Ergebnisbereiche">
        <button
          className={section === "presentation" ? "active" : ""}
          type="button"
          onClick={() => setSection("presentation")}
        >
          Ergebnis
        </button>
        <button
          className={section === "top10" ? "active" : ""}
          type="button"
          onClick={() => setSection("top10")}
        >
          Top 10
        </button>
      </nav>
      {error && <p className="notice notice--error">{error}</p>}
      {section === "presentation" && pageSlug && presentation && !newspaperPage && (
        <p className="notice notice--error">Diese Zeitungsseite wurde nicht gefunden.</p>
      )}
      {section === "presentation" &&
        (creating ||
          (!presentation && details?.artifacts.some((item) => item.kind === "final"))) && (
          <div className="result-loading">
            <LoaderCircle className="spin" />{" "}
            {creating
              ? "Darstellung wird aus dem finalen Ergebnis erzeugt …"
              : `${FORMAT_NAMES[kind]} wird im Hintergrund gestaltet und geprüft …`}
          </div>
        )}
      {section === "presentation" && renderedHtml && (
        <div
          id="result-presentation-panel"
          className={`rendered-result${hasAuthoredReportStyles ? " rendered-result--authored" : ""}`}
          role="tabpanel"
          aria-labelledby={`result-tab-${kind}`}
          data-presentation-id={presentation?.id}
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      )}
      {section === "top10" && (
        <main className="result-support result-support--top10">
          <header>
            <span>HANDLUNGSPLAN</span>
            <h1>Top 10 nächste Schritte</h1>
            <p>
              Aus dem finalen Ergebnis abgeleitet und gegen die isolierten Einzelreviews geprüft.
            </p>
          </header>
          {!top10 && (
            <button
              className="button button--primary"
              type="button"
              disabled={startingTop10}
              onClick={() => void startTop10()}
            >
              <ListChecks size={16} /> Analyse starten
            </button>
          )}
          {top10 && ["queued", "running"].includes(top10.status) && (
            <div className="result-loading">
              <LoaderCircle className="spin" /> Empfehlungen werden belegt und priorisiert …
            </div>
          )}
          {top10?.status === "failed" && (
            <p className="notice notice--error">{top10.error ?? "Analyse fehlgeschlagen."}</p>
          )}
          {top10?.outputHtml && <SanitizedMarkdown html={top10.outputHtml} />}
        </main>
      )}
    </div>
  );
}
