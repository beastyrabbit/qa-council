/* biome-ignore-all lint/security/noDangerouslySetInnerHtml: Presentation-HTML wird serverseitig per expliziter Allowlist sanitisiert. */
import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowLeft,
  CircleAlert,
  CircleX,
  FileText,
  Play,
  Square,
  Terminal,
  Trash2,
  Users,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { RunDetails, RunEvent, RunStatus } from "../../shared/types";
import { api } from "../lib/api";
import { RunStatus as Status } from "./RunStatus";
import { RunWorkflowGraph } from "./RunWorkflowGraph";
import { SanitizedMarkdown } from "./SanitizedMarkdown";
import { ConfirmDialog, type ConfirmRequest, formatSize, PROVIDER_NAMES } from "./ViewShared";

export const SYSTEM_EVENTS = new Set([
  "run_started",
  "document_extraction_started",
  "document_extraction_progress",
  "document_extraction_reused",
  "document_extraction_resumed",
  "council_composed",
  "input_required",
  "input_answered",
  "stage_retry",
  "debate_skipped",
  "compaction_start",
  "compaction_end",
  "final_created",
  "result_published",
  "report_workspace_scaffolded",
  "report_static_check_completed",
  "report_static_feedback_sent",
  "workspace_tool_start",
  "workspace_tool_end",
  "report_static_recheck_completed",
  "presentation_started",
  "presentation_completed",
  "image_generation_started",
  "image_generation_queued",
  "image_generation_reused",
  "image_generation_completed",
  "image_generation_failed",
  "image_generation_fallback",
  "run_completed",
  "run_failed",
  "run_cancelled",
  "run_cancel_requested",
  "parallel_stage_group_started",
]);

const ATTEMPT_STATUS_NAMES: Record<RunStatus, string> = {
  queued: "Wartet",
  running: "Läuft",
  cancelling: "Wird abgebrochen",
  cancelled: "Abgebrochen",
  waiting_for_input: "Rückfrage",
  completed: "Fertig",
  failed: "Fehler",
};

export function RunView({
  id,
  onBack,
  onResult,
  onFile,
  onChanged,
  backLabel = "Läufe",
}: {
  id: string;
  onBack: () => void;
  onResult: (presentationId: string) => void;
  onFile: (artifactId: string, attempt: number) => void;
  onChanged: () => void;
  backLabel?: string;
}) {
  const [details, setDetails] = useState<RunDetails | null>(null);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState("");
  const [liveFollow, setLiveFollow] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [activity, setActivity] = useState<RunEvent[]>([]);
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const activityCursorRef = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const programmaticScrollRef = useRef(false);
  const terminal = Boolean(
    details && ["completed", "failed", "cancelled"].includes(details.attempt.status),
  );
  const load = useCallback(() => {
    void api<RunDetails>(`/api/runs/${id}${attempt ? `?attempt=${attempt}` : ""}`)
      .then((value) => {
        setDetails(value);
        setAttempt((current) => current || value.run.currentAttempt);
      })
      .catch((reason) => setError(reason.message));
  }, [attempt, id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (terminal) return;
    const timer = window.setInterval(load, 1_500);
    return () => window.clearInterval(timer);
  }, [load, terminal]);

  useEffect(() => {
    void attempt;
    void id;
    activityCursorRef.current = 0;
    setActivity([]);
    setSelectedStageId(null);
  }, [attempt, id]);

  useEffect(() => {
    if (!attempt) return;
    let active = true;
    const poll = async () => {
      try {
        const items = await api<RunEvent[]>(
          `/api/runs/${id}/activity?attempt=${attempt}&afterEventId=${activityCursorRef.current}`,
        );
        if (!active) return;
        if (items.length) {
          activityCursorRef.current = items.at(-1)?.id ?? activityCursorRef.current;
          setActivity((current) => [...current, ...items]);
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    void poll();
    if (terminal)
      return () => {
        active = false;
      };
    const timer = window.setInterval(() => void poll(), 1_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [attempt, id, terminal]);

  const selectedStage = details?.stages.find((stage) => stage.id === selectedStageId);
  const visibleActivity = useMemo(
    () =>
      selectedStageId ? activity.filter((item) => item.stageId === selectedStageId) : activity,
    [activity, selectedStageId],
  );

  useEffect(() => {
    if (!liveFollow || visibleActivity.length === 0) return;
    const frame = window.requestAnimationFrame(() => {
      if (logRef.current) {
        programmaticScrollRef.current = true;
        logRef.current.scrollTop = logRef.current.scrollHeight;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [liveFollow, visibleActivity]);

  function handleStreamScroll() {
    if (programmaticScrollRef.current) {
      programmaticScrollRef.current = false;
      return;
    }
    const element = logRef.current;
    if (!element || !liveFollow) return;
    const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 40;
    if (!atBottom) setLiveFollow(false);
  }

  async function restartFailedRun() {
    if (details?.run.status !== "failed" || details.run.archivedAt) return;
    setRestarting(true);
    setError("");
    try {
      const result = await api<{ attempt: number }>(`/api/runs/${id}/restart`, {
        method: "POST",
      });
      setAttempt(result.attempt);
      setActivity([]);
      load();
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRestarting(false);
    }
  }

  async function submitAnswer(event: FormEvent) {
    event.preventDefault();
    if (!details?.question || !answer.trim()) return;
    await api(`/api/runs/${id}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: details.question.id, answer }),
    });
    setAnswer("");
    load();
  }

  async function toggleArchive() {
    if (!details) return;
    await api(`/api/runs/${id}/archive`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !details.run.archivedAt }),
    });
    await load();
    onChanged();
  }

  function cancelActiveRun() {
    if (!activeRun) return;
    setConfirmRequest({
      title: "Lauf abbrechen?",
      description: "Bereits erzeugte Log-Ausgaben bleiben erhalten.",
      confirmLabel: "Jetzt abbrechen",
      action: async () => {
        setCancelling(true);
        setError("");
        try {
          await api(`/api/runs/${id}/cancel`, { method: "POST" });
          load();
          onChanged();
        } finally {
          setCancelling(false);
        }
      },
    });
  }

  function removeStoppedRun() {
    if (!details || !["failed", "cancelled"].includes(details.run.status)) return;
    const label = details.run.status === "failed" ? "Fehlgeschlagenen" : "Abgebrochenen";
    setConfirmRequest({
      title: `${label} Lauf löschen?`,
      description: "Der Lauf wird mitsamt Protokollen dauerhaft gelöscht.",
      confirmLabel: "Dauerhaft löschen",
      action: async () => {
        await api(`/api/runs/${id}`, { method: "DELETE" });
        onChanged();
        onBack();
      },
    });
  }

  const councilEvent = details
    ? [...details.events].reverse().find((item) => item.type === "council_composed")
    : undefined;
  const eventRoles =
    councilEvent?.data &&
    typeof councilEvent.data === "object" &&
    "roles" in councilEvent.data &&
    Array.isArray(councilEvent.data.roles)
      ? councilEvent.data.roles.filter((item): item is string => typeof item === "string")
      : [];
  const roles = eventRoles.length
    ? eventRoles
    : [
        ...new Set(
          (details?.stages ?? [])
            .map((stage) => stage.role)
            .filter((role): role is string => Boolean(role)),
        ),
      ];
  const systemEvents = details?.events.filter((item) => SYSTEM_EVENTS.has(item.type)) ?? [];
  const activeRun =
    details?.run.currentAttempt === attempt &&
    (details.run.status === "queued" ||
      details.run.status === "running" ||
      details.run.status === "waiting_for_input");

  return (
    <div className="run-page flex min-h-svh flex-col">
      <header className="run-toolbar sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b bg-background/95 px-4 py-2.5 backdrop-blur">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft /> {backLabel}
        </Button>
        <div className="min-w-0 flex-1">
          <span className="block text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
            Live-Worklog
          </span>
          <strong className="block truncate font-heading text-sm">
            {details?.run.documentName ?? "Lauf wird geladen …"}
          </strong>
        </div>
        <div className="run-toolbar__actions flex flex-wrap items-center gap-2">
          {details && details.attempts.length > 1 && (
            <Select
              value={String(attempt)}
              onValueChange={(value) => {
                if (!value) return;
                setAttempt(Number(value));
                setActivity([]);
              }}
            >
              <SelectTrigger size="sm" aria-label="Versuch wählen">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {details.attempts.map((item) => (
                  <SelectItem key={item.attempt} value={String(item.attempt)}>
                    Versuch {item.attempt} · {ATTEMPT_STATUS_NAMES[item.status] ?? item.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {details?.run.status === "failed" && !details.run.archivedAt && (
            <Button size="sm" disabled={restarting} onClick={() => void restartFailedRun()}>
              {restarting ? <Spinner /> : <Play />}
              {restarting ? "Startet neu …" : "Lauf neu starten"}
            </Button>
          )}
          {activeRun && (
            <Button variant="destructive" size="sm" disabled={cancelling} onClick={cancelActiveRun}>
              <Square fill="currentColor" />
              {cancelling ? "Wird abgebrochen …" : "Lauf abbrechen"}
            </Button>
          )}
          {details && ["completed", "failed", "cancelled"].includes(details.run.status) && (
            <Button variant="outline" size="sm" onClick={() => void toggleArchive()}>
              {details.run.archivedAt ? <ArchiveRestore /> : <Archive />}
              {details.run.archivedAt ? "Wiederherstellen" : "Archivieren"}
            </Button>
          )}
          {details && ["failed", "cancelled"].includes(details.run.status) && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={removeStoppedRun}
            >
              <Trash2 /> Löschen
            </Button>
          )}
          {details?.presentations[0] && (
            <Button
              size="sm"
              onClick={() =>
                onResult(
                  details.presentations.find((item) => item.kind === "text")?.id ??
                    details.presentations[0].id,
                )
              }
            >
              {details.run.status === "completed" ? "Resultat öffnen" : "Text-Ergebnis öffnen"}
            </Button>
          )}
        </div>
      </header>

      <div className="flex flex-col gap-4 p-4 lg:p-6">
        {error && (
          <Alert variant="destructive">
            <CircleX />
            <AlertTitle>Fehler</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {details && (
          <>
            {details.question && (
              <Alert className="border-amber-600/40 bg-amber-500/10">
                <CircleAlert className="text-amber-700 dark:text-amber-400" />
                <AlertTitle>Der Council benötigt eine Angabe</AlertTitle>
                <AlertDescription className="w-full">
                  <p className="mb-3">{details.question.prompt}</p>
                  <form className="run-question flex flex-col gap-2" onSubmit={submitAnswer}>
                    <Textarea
                      value={answer}
                      onChange={(event) => setAnswer(event.target.value)}
                      rows={3}
                      required
                      placeholder="Antwort für den laufenden Council"
                      className="bg-background"
                    />
                    <Button type="submit" className="self-end">
                      Antwort senden
                    </Button>
                  </form>
                </AlertDescription>
              </Alert>
            )}

            {details.run.status === "failed" && details.run.error && (
              <Alert variant="destructive">
                <CircleX />
                <AlertTitle>Lauf fehlgeschlagen</AlertTitle>
                <AlertDescription className="flex w-full flex-wrap items-center justify-between gap-3">
                  <span className="min-w-0 break-words">{details.run.error}</span>
                  {!details.run.archivedAt && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={restarting}
                      onClick={() => void restartFailedRun()}
                    >
                      {restarting ? <Spinner /> : <Play />} Lauf neu starten
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <Card className="run-overview gap-3 py-4">
              <CardContent className="flex flex-col gap-3 px-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Status run={details.run} />
                  <div className="min-w-0 flex-1">
                    <strong className="block truncate text-sm">
                      {details.run.currentStage ?? "Initialisierung"}
                    </strong>
                    <span className="block truncate text-xs text-muted-foreground">
                      {PROVIDER_NAMES[details.run.provider]} · {details.run.model} ·{" "}
                      {details.run.resolvedMode ?? details.run.mode}
                      {details.run.imageProvider
                        ? ` · Bild: ${
                            details.run.imageProvider === "openai"
                              ? "OpenAI"
                              : details.run.imageProvider === "openrouter"
                                ? "OpenRouter"
                                : "ComfyUI"
                          }`
                        : ""}
                    </span>
                  </div>
                  <Badge variant="outline" className="gap-1.5">
                    <Users /> {roles.length ? `${roles.length} Rollen` : "Rollen folgen"}
                  </Badge>
                  <b className="font-mono text-sm">{details.run.progress}%</b>
                </div>
                <Progress value={details.run.progress} />
              </CardContent>
            </Card>

            <RunWorkflowGraph
              stages={details.stages}
              roles={roles}
              selectedStageId={selectedStageId}
              onSelectStage={setSelectedStageId}
            />

            <div className="run-layout grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <Card className="live-console gap-0 overflow-hidden py-0">
                <CardHeader className="flex flex-row items-center justify-between gap-3 border-b px-4 py-3!">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Terminal className="size-4 shrink-0 text-muted-foreground" />
                    <strong className="truncate font-heading text-sm">
                      {selectedStage
                        ? `Protokoll · ${selectedStage.name}`
                        : "Gesamtes Modellprotokoll"}
                    </strong>
                    {activeRun && (
                      <Badge className="live-indicator animate-pulse" variant="destructive">
                        live
                      </Badge>
                    )}
                  </div>
                  <Label className="flex shrink-0 items-center gap-2 text-xs">
                    <Switch checked={liveFollow} onCheckedChange={setLiveFollow} />
                    Live folgen
                  </Label>
                </CardHeader>
                <CardContent className="relative p-0">
                  <div
                    className="live-console__stream"
                    ref={logRef}
                    role="log"
                    aria-live={activeRun && liveFollow ? "polite" : "off"}
                    onScroll={handleStreamScroll}
                  >
                    {visibleActivity.length === 0 && (
                      <div className="console-empty">
                        <Spinner className={activeRun ? "" : "hidden"} />
                        {selectedStage
                          ? "Für diesen Agenten liegt noch keine Aktivität vor."
                          : "Aktivität wird geladen …"}
                      </div>
                    )}
                    {visibleActivity.map((item) => {
                      const data =
                        item.data && typeof item.data === "object"
                          ? (item.data as Record<string, unknown>)
                          : {};
                      if (
                        item.type === "assistant_message" &&
                        typeof data.markdownHtml === "string"
                      ) {
                        return (
                          <article
                            className="stage-transcript stage-transcript--completed"
                            key={item.id}
                          >
                            <header>
                              <span>AI</span>
                              <div>
                                <strong>{item.message}</strong>
                                <small>
                                  {new Date(item.createdAt).toLocaleTimeString("de-DE")}
                                </small>
                              </div>
                            </header>
                            <SanitizedMarkdown html={data.markdownHtml} />
                          </article>
                        );
                      }
                      if (item.type === "council_tool_call") {
                        return (
                          <article className="tool-call-entry" key={item.id}>
                            <header>
                              <Terminal size={15} />
                              <strong>{String(data.name ?? item.message)}</strong>
                              <time>{new Date(item.createdAt).toLocaleTimeString("de-DE")}</time>
                            </header>
                            <pre>{JSON.stringify(data.args ?? {}, null, 2)}</pre>
                          </article>
                        );
                      }
                      return (
                        <div className={`activity-line activity-line--${item.level}`} key={item.id}>
                          <time>{new Date(item.createdAt).toLocaleTimeString("de-DE")}</time>
                          <span>{item.message}</span>
                        </div>
                      );
                    })}
                  </div>
                  {!liveFollow && activeRun && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-md"
                      onClick={() => setLiveFollow(true)}
                    >
                      <ArrowDownToLine /> Zum Live-Ende
                    </Button>
                  )}
                </CardContent>
              </Card>

              <aside className="run-rail flex min-w-0 flex-col gap-4">
                <Card className="gap-0 py-0">
                  <CardHeader className="border-b px-4 py-3!">
                    <h2 className="font-heading text-sm font-semibold">Systemprotokoll</h2>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-64">
                      <div className="flex flex-col gap-1 p-3">
                        {systemEvents.map((item) => (
                          <div
                            className={cn(
                              "grid grid-cols-[52px_minmax(0,1fr)] gap-2 font-mono text-[11px] leading-snug",
                              item.level === "error"
                                ? "text-destructive"
                                : item.level === "warning"
                                  ? "text-amber-700 dark:text-amber-400"
                                  : "text-muted-foreground",
                            )}
                            key={item.id}
                          >
                            <time className="opacity-70">
                              {new Date(item.createdAt).toLocaleTimeString("de-DE")}
                            </time>
                            <span className="break-words">{item.message}</span>
                          </div>
                        ))}
                        {systemEvents.length === 0 && (
                          <p className="text-xs text-muted-foreground">Noch keine Systemmeldung.</p>
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
                <Card className="run-files gap-0 py-0">
                  <CardHeader className="border-b px-4 py-3!">
                    <h2 className="font-heading text-sm font-semibold">Audit-Dateien</h2>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[420px]">
                      <div className="flex flex-col divide-y">
                        {details.artifacts.map((item) => (
                          <div className="flex flex-col gap-1.5 px-3 py-2.5" key={item.id}>
                            <div className="flex items-start gap-2">
                              <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <strong className="block truncate text-xs font-medium">
                                  {item.title}
                                </strong>
                                <small className="block text-[11px] text-muted-foreground">
                                  {item.phase} · {formatSize(item.size ?? 0)}
                                </small>
                              </div>
                            </div>
                            <div className="flex items-center justify-between gap-2 pl-5.5">
                              <code className="font-mono text-[10px] text-muted-foreground">
                                {item.sha256.slice(0, 12)}
                              </code>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onFile(item.id, attempt)}
                              >
                                Groß öffnen
                              </Button>
                            </div>
                          </div>
                        ))}
                        {details.artifacts.length === 0 && (
                          <p className="p-3 text-xs text-muted-foreground">
                            Noch keine Audit-Datei.
                          </p>
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </aside>
            </div>
          </>
        )}
      </div>
      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
    </div>
  );
}
