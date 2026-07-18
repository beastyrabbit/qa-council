/* biome-ignore-all lint/security/noDangerouslySetInnerHtml: Presentation-HTML wird serverseitig per expliziter Allowlist sanitisiert. */
import {
  Archive,
  ArrowLeft,
  FileText,
  LoaderCircle,
  Play,
  Square,
  Terminal,
  Trash2,
  Users,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { RunDetails, RunEvent } from "../../shared/types";
import { api } from "../lib/api";
import { RunStatus as Status } from "./RunStatus";
import { SanitizedMarkdown } from "./SanitizedMarkdown";

import { formatSize, PROVIDER_NAMES } from "./ViewShared";

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
  const activityCursorRef = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!liveFollow || activity.length === 0) return;
    const frame = window.requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activity, liveFollow]);

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

  async function cancelActiveRun() {
    if (!activeRun) return;
    if (
      !window.confirm(
        "Diesen Lauf jetzt abbrechen? Bereits erzeugte Log-Ausgaben bleiben erhalten.",
      )
    )
      return;
    setCancelling(true);
    setError("");
    try {
      await api(`/api/runs/${id}/cancel`, { method: "POST" });
      load();
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCancelling(false);
    }
  }

  async function removeStoppedRun() {
    if (!details || !["failed", "cancelled"].includes(details.run.status)) return;
    const label = details.run.status === "failed" ? "fehlgeschlagenen" : "abgebrochenen";
    if (!window.confirm(`Diesen ${label} Lauf dauerhaft löschen?`)) return;
    await api(`/api/runs/${id}`, { method: "DELETE" });
    onChanged();
    onBack();
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
    <div className="run-page">
      <header className="run-toolbar">
        <button className="button button--quiet" type="button" onClick={onBack}>
          <ArrowLeft size={17} /> {backLabel}
        </button>
        <div className="run-toolbar__title">
          <span>LIVE WORKLOG</span>
          <strong>{details?.run.documentName ?? "Lauf wird geladen …"}</strong>
        </div>
        <div className="run-toolbar__actions">
          {details && (
            <label className="attempt-select">
              Versuch
              <select
                value={attempt}
                onChange={(event) => {
                  setAttempt(Number(event.target.value));
                  setActivity([]);
                }}
              >
                {details.attempts.map((item) => (
                  <option key={item.attempt} value={item.attempt}>
                    {item.attempt} · {item.status}
                  </option>
                ))}
              </select>
            </label>
          )}
          {details?.run.status === "failed" && !details.run.archivedAt && (
            <button
              className="button button--primary"
              type="button"
              disabled={restarting}
              onClick={() => void restartFailedRun()}
            >
              <Play size={15} />
              {restarting ? "Wird beansprucht …" : "Lauf neu starten"}
            </button>
          )}
          {activeRun && (
            <button
              className="button button--danger"
              type="button"
              disabled={cancelling}
              onClick={() => void cancelActiveRun()}
            >
              <Square size={15} fill="currentColor" />
              {cancelling ? "Wird abgebrochen …" : "Lauf abbrechen"}
            </button>
          )}
          {details && ["completed", "failed", "cancelled"].includes(details.run.status) && (
            <button className="button button--quiet" type="button" onClick={toggleArchive}>
              <Archive size={16} />
              {details.run.archivedAt ? "Wiederherstellen" : "Archivieren"}
            </button>
          )}
          {details && ["failed", "cancelled"].includes(details.run.status) && (
            <button className="button button--danger" type="button" onClick={removeStoppedRun}>
              <Trash2 size={16} /> Löschen
            </button>
          )}
          {details?.presentations[0] && (
            <button
              className="button button--primary"
              type="button"
              onClick={() =>
                onResult(
                  details.presentations.find((item) => item.kind === "text")?.id ??
                    details.presentations[0].id,
                )
              }
            >
              {details.run.status === "completed" ? "Resultat öffnen" : "Text-Ergebnis öffnen"}
            </button>
          )}
        </div>
      </header>
      {error && <p className="notice notice--error">{error}</p>}
      {details && (
        <>
          <section className="run-overview">
            <div className="run-overview__summary">
              <Status run={details.run} />
              <div>
                <strong>{details.run.currentStage ?? "Initialisierung"}</strong>
                <span>
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
              <b>{details.run.progress}%</b>
            </div>
            <progress max="100" value={details.run.progress} />
            <div className="agent-heading">
              <div>
                <Users size={17} />
                <strong>Council-Agenten</strong>
                <span>isolierte Fachrollen</span>
              </div>
              <small>{roles.length ? `${roles.length} Rollen` : "wird zusammengestellt"}</small>
            </div>
            <div className="agent-strip">
              {roles.map((role, index) => {
                const stage = [...details.stages].reverse().find((item) => item.role === role);
                const status = stage?.status ?? "queued";
                return (
                  <div className={`agent-card agent-card--${status}`} key={role}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{role}</strong>
                      <small>
                        {status === "running"
                          ? "arbeitet jetzt"
                          : status === "completed"
                            ? "Antwort vollständig"
                            : status === "failed"
                              ? "fehlgeschlagen"
                              : status === "cancelled"
                                ? "abgebrochen"
                                : "wartet"}
                      </small>
                    </div>
                  </div>
                );
              })}
              {roles.length === 0 && (
                <div className="agent-card agent-card--queued">
                  <span>··</span>
                  <div>
                    <strong>Triage läuft</strong>
                    <small>Rollen folgen nach der Risikoeinordnung</small>
                  </div>
                </div>
              )}
            </div>
          </section>

          {details.question && (
            <form className="run-question" onSubmit={submitAnswer}>
              <div>
                <strong>Der Council benötigt eine Angabe</strong>
                <p>{details.question.prompt}</p>
              </div>
              <textarea
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                rows={3}
                required
                placeholder="Antwort für den laufenden Council"
              />
              <button className="button button--primary" type="submit">
                Antwort senden
              </button>
            </form>
          )}

          <div className="run-layout">
            <section className="live-console">
              <header>
                <div>
                  <Terminal size={17} />
                  <strong>Modellprotokoll</strong>
                  {activeRun && <span className="live-indicator">live</span>}
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={liveFollow}
                    onChange={(event) => setLiveFollow(event.target.checked)}
                  />
                  Live folgen
                </label>
              </header>
              <div className="live-console__stream" ref={logRef}>
                {activity.length === 0 && (
                  <div className="console-empty">
                    <LoaderCircle className={activeRun ? "spin" : ""} size={18} />
                    Aktivität wird geladen …
                  </div>
                )}
                {activity.map((item) => {
                  const data =
                    item.data && typeof item.data === "object"
                      ? (item.data as Record<string, unknown>)
                      : {};
                  if (item.type === "assistant_message" && typeof data.markdownHtml === "string") {
                    return (
                      <article
                        className="stage-transcript stage-transcript--completed"
                        key={item.id}
                      >
                        <header>
                          <span>AI</span>
                          <div>
                            <strong>{item.message}</strong>
                            <small>{new Date(item.createdAt).toLocaleTimeString("de-DE")}</small>
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
            </section>

            <aside className="run-rail">
              <section>
                <h2>Systemprotokoll</h2>
                <div className="system-log">
                  {systemEvents.map((item) => (
                    <div
                      className={`system-log__item system-log__item--${item.level}`}
                      key={item.id}
                    >
                      <time>{new Date(item.createdAt).toLocaleTimeString("de-DE")}</time>
                      <span>{item.message}</span>
                    </div>
                  ))}
                  {systemEvents.length === 0 && <p className="muted">Noch keine Systemmeldung.</p>}
                </div>
              </section>
              <section className="run-files">
                <h2>Audit-Dateien</h2>
                {details.artifacts.map((item) => (
                  <article key={item.id}>
                    <div>
                      <FileText size={15} />
                      <span>
                        <strong>{item.title}</strong>
                        <small>
                          {item.phase} · {formatSize(item.size ?? 0)}
                        </small>
                      </span>
                    </div>
                    <div className="file-meta">
                      <code>{item.sha256.slice(0, 12)}</code>
                      <button
                        className="button button--quiet"
                        type="button"
                        onClick={() => onFile(item.id, attempt)}
                      >
                        Groß öffnen
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
