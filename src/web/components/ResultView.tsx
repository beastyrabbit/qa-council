/* biome-ignore-all lint/security/noDangerouslySetInnerHtml: Presentation-HTML wird serverseitig per expliziter Allowlist sanitisiert. */
import { ArrowLeft, CircleX, Copy, Download, ListChecks } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type {
  DerivedAnalysisRecord,
  PresentationKind,
  PresentationRecord,
  RunDetails,
} from "../../shared/types";
import { api } from "../lib/api";
import { SanitizedMarkdown } from "./SanitizedMarkdown";
import { FORMAT_NAMES } from "./ViewShared";

type TabReadiness = "available" | "building" | "missing";

function ReadinessDot({ state }: { state: TabReadiness }) {
  if (state === "available") return <span className="size-1.5 rounded-full bg-primary" />;
  if (state === "building") return <Spinner className="size-3 text-muted-foreground" />;
  return <span className="size-1.5 rounded-full border border-muted-foreground/50" />;
}

const PresentationPanel = memo(function PresentationPanel({
  html,
  authored,
  kind,
  presentationId,
}: {
  html: string;
  authored: boolean;
  kind: PresentationKind;
  presentationId?: string;
}) {
  return (
    <div
      id="result-presentation-panel"
      className={`rendered-result${authored ? " rendered-result--authored" : ""}`}
      role="tabpanel"
      aria-labelledby={`result-tab-${kind}`}
      data-presentation-id={presentationId}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

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
  const scrollPositions = useRef<Record<string, number>>({});
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

  const contentKey = `${section}-${kind}-${pageSlug ?? ""}`;
  useEffect(() => {
    if (section === "presentation" && !renderedHtml) return;
    window.scrollTo(0, scrollPositions.current[contentKey] ?? 0);
  }, [contentKey, section, renderedHtml]);

  function rememberScroll() {
    scrollPositions.current[contentKey] = window.scrollY;
  }

  const runTerminal = details
    ? ["completed", "failed", "cancelled"].includes(details.run.status)
    : false;
  const reportsAreBuilding = Boolean(
    details?.artifacts.some((item) => item.kind === "final") && details && !runTerminal,
  );

  function readinessFor(item: PresentationKind): TabReadiness {
    if (details?.presentations.some((entry) => entry.kind === item)) return "available";
    if (reportsAreBuilding) return "building";
    return "missing";
  }

  async function selectPresentation(next: PresentationKind) {
    rememberScroll();
    setSection("presentation");
    setKind(next);
    const existing = details?.presentations.find((item) => item.kind === next);
    if (existing) {
      onPresentationChange(existing.id);
      return;
    }
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
    <div className="result-page min-h-svh bg-[#e7e1d6] dark:bg-[#26251f]">
      <div className="result-toolbar sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft /> Zurück
        </Button>
        <Tabs
          className="result-tabs"
          value={kind}
          onValueChange={(value) => value && void selectPresentation(value as PresentationKind)}
        >
          <TabsList aria-label="Darstellung">
            {(Object.keys(FORMAT_NAMES) as PresentationKind[]).map((item) => (
              <TabsTrigger value={item} id={`result-tab-${item}`} key={item} className="gap-1.5">
                <ReadinessDot state={readinessFor(item)} />
                {FORMAT_NAMES[item]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="result-toolbar__actions ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(window.location.href);
              toast.success("Link kopiert.");
            }}
          >
            <Copy /> URL kopieren
          </Button>
          {kind === "onepaper" && (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<a href={`/api/presentations/${presentationId}/pdf`} />}
            >
              <Download /> PDF
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<a href={`/api/runs/${runId}/download`} />}
          >
            <Download /> Markdown
          </Button>
        </div>
      </div>
      <nav
        className="result-subnav sticky top-[49px] z-10 flex items-center gap-1 border-b bg-background/90 px-4 py-1.5 backdrop-blur"
        aria-label="Ergebnisbereiche"
      >
        <Button
          variant={section === "presentation" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => {
            rememberScroll();
            setSection("presentation");
          }}
        >
          Ergebnis
        </Button>
        <Button
          variant={section === "top10" ? "secondary" : "ghost"}
          size="sm"
          className="gap-1.5"
          onClick={() => {
            rememberScroll();
            setSection("top10");
          }}
        >
          <ListChecks />
          Top 10
          {top10 && ["queued", "running"].includes(top10.status) && <Spinner className="size-3" />}
        </Button>
      </nav>
      {error && (
        <Alert variant="destructive" className="mx-auto mt-6 w-full max-w-3xl">
          <CircleX />
          <AlertTitle>Fehler</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {section === "presentation" && pageSlug && presentation && !newspaperPage && (
        <Alert variant="destructive" className="mx-auto mt-6 w-full max-w-3xl">
          <CircleX />
          <AlertDescription>Diese Zeitungsseite wurde nicht gefunden.</AlertDescription>
        </Alert>
      )}
      {section === "presentation" && !renderedHtml && !details && !error && (
        <div className="mx-auto mt-8 flex w-full max-w-4xl flex-col gap-4 rounded-lg bg-background/60 p-8">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}
      {section === "presentation" &&
        (creating ||
          (!presentation && details?.artifacts.some((item) => item.kind === "final"))) && (
          <div className="result-loading mx-auto mt-8 flex w-fit items-center gap-2.5 rounded-lg bg-background/80 px-5 py-3 text-sm text-muted-foreground">
            <Spinner />
            {creating
              ? "Darstellung wird aus dem finalen Ergebnis erzeugt …"
              : `${FORMAT_NAMES[kind]} wird im Hintergrund gestaltet und geprüft …`}
          </div>
        )}
      {section === "presentation" && renderedHtml && (
        <PresentationPanel
          html={renderedHtml}
          authored={hasAuthoredReportStyles}
          kind={kind}
          presentationId={presentation?.id}
        />
      )}
      {section === "top10" && (
        <main className="result-support result-support--top10 mx-auto my-8 w-full max-w-3xl rounded-lg border bg-(--paper) p-8 shadow-sm">
          <header className="mb-5">
            <span className="block text-[10px] font-semibold tracking-widest uppercase opacity-60">
              Handlungsplan
            </span>
            <h1 className="mt-1 font-serif text-2xl font-bold">Top 10 nächste Schritte</h1>
            <p className={cn("mt-1 text-sm opacity-75")}>
              Aus dem finalen Ergebnis abgeleitet und gegen die isolierten Einzelreviews geprüft.
            </p>
          </header>
          {!top10 && (
            <Button disabled={startingTop10} onClick={() => void startTop10()}>
              {startingTop10 ? <Spinner /> : <ListChecks />}
              {startingTop10 ? "Wird gestartet …" : "Analyse starten"}
            </Button>
          )}
          {top10 && ["queued", "running"].includes(top10.status) && (
            <div className="flex items-center gap-2.5 text-sm opacity-75">
              <Spinner /> Empfehlungen werden belegt und priorisiert …
            </div>
          )}
          {top10?.status === "failed" && (
            <Alert variant="destructive">
              <CircleX />
              <AlertDescription>{top10.error ?? "Analyse fehlgeschlagen."}</AlertDescription>
            </Alert>
          )}
          {top10?.outputHtml && <SanitizedMarkdown html={top10.outputHtml} />}
        </main>
      )}
    </div>
  );
}
