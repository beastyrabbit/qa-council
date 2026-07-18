import { ArrowLeft, Copy, Download, FileText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ArtifactRecord, RunDetails } from "../../shared/types";
import { api } from "../lib/api";
import { SanitizedMarkdown } from "./SanitizedMarkdown";

export function FileReader({
  runId,
  artifactId,
  initialAttempt,
  onBack,
  onFileChange,
}: {
  runId: string;
  artifactId: string;
  initialAttempt?: number;
  onBack: () => void;
  onFileChange: (artifactId: string, attempt: number) => void;
}) {
  const [details, setDetails] = useState<RunDetails | null>(null);
  const [attempt, setAttempt] = useState(initialAttempt ?? 0);
  const [files, setFiles] = useState<ArtifactRecord[]>([]);
  const [content, setContent] = useState<ArtifactRecord | null>(null);
  const [error, setError] = useState("");

  const loadIndex = useCallback(async () => {
    const run = await api<RunDetails>(`/api/runs/${runId}${attempt ? `?attempt=${attempt}` : ""}`);
    const selected = attempt || run.run.currentAttempt;
    const items = await api<ArtifactRecord[]>(`/api/runs/${runId}/files?attempt=${selected}`);
    setDetails(run);
    setAttempt(selected);
    setFiles(items);
  }, [attempt, runId]);

  useEffect(() => {
    void loadIndex().catch((reason) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  }, [loadIndex]);

  useEffect(() => {
    setContent(null);
    void api<ArtifactRecord>(`/api/runs/${runId}/files/${artifactId}`)
      .then(setContent)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [artifactId, runId]);

  return (
    <div className="file-reader">
      <header className="file-reader__toolbar">
        <button className="button button--quiet" type="button" onClick={onBack}>
          <ArrowLeft size={17} /> Lauf
        </button>
        <div>
          <strong>{details?.run.documentName ?? "Datei"}</strong>
          <span>Audit-Dateien · Versuch {attempt || "…"}</span>
        </div>
        <label>
          Versuch
          <select
            value={attempt}
            onChange={(event) => {
              const nextAttempt = Number(event.target.value);
              setAttempt(nextAttempt);
              setContent(null);
              void api<ArtifactRecord[]>(`/api/runs/${runId}/files?attempt=${nextAttempt}`)
                .then((items) => {
                  setFiles(items);
                  const nextArtifactId =
                    items.find((item) => item.id === artifactId)?.id ?? items[0]?.id;
                  if (nextArtifactId) onFileChange(nextArtifactId, nextAttempt);
                })
                .catch((reason) =>
                  setError(reason instanceof Error ? reason.message : String(reason)),
                );
            }}
          >
            {details?.attempts.map((item) => (
              <option key={item.attempt} value={item.attempt}>
                {item.attempt} · {item.status}
              </option>
            ))}
          </select>
        </label>
      </header>
      {error && <p className="notice notice--error">{error}</p>}
      <div className="file-reader__layout">
        <nav className="file-reader__nav" aria-label="Audit-Dateien">
          {files.map((file) => (
            <button
              className={file.id === artifactId ? "active" : ""}
              type="button"
              key={file.id}
              onClick={() => onFileChange(file.id, attempt)}
            >
              <FileText size={16} />
              <span>
                <strong>{file.title}</strong>
                <small>
                  {file.phase} · {file.role ?? file.kind}
                </small>
              </span>
            </button>
          ))}
        </nav>
        <main className="file-reader__content">
          {content ? (
            <>
              <header>
                <div>
                  <span>{content.phase}</span>
                  <h1>{content.title}</h1>
                  <p>
                    Versuch {content.originAttempt} · {content.sha256.slice(0, 12)}
                  </p>
                </div>
                <div>
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(content.content ?? "")}
                  >
                    <Copy size={16} /> Kopieren
                  </button>
                  <a
                    className="button button--quiet"
                    href={`/api/runs/${runId}/files/${content.id}?download=1`}
                  >
                    <Download size={16} /> Download
                  </a>
                </div>
              </header>
              {content.contentHtml ? (
                <SanitizedMarkdown html={content.contentHtml} />
              ) : (
                <pre>{content.content}</pre>
              )}
            </>
          ) : (
            <p className="muted">Datei wird geladen …</p>
          )}
        </main>
      </div>
    </div>
  );
}
