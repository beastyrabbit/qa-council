export type ProviderId = "codex" | "openrouter" | "aibox";
export type CouncilMode = "auto" | "quick" | "standard" | "deep";
export type PresentationKind = "text" | "newspaper" | "onepaper";
export type RunStatus = "queued" | "running" | "waiting_for_input" | "completed" | "failed";

export interface DocumentRecord {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  status: "extracting" | "ready" | "failed";
  createdAt: string;
  error?: string | null;
}

export interface RunRecord {
  id: string;
  documentId: string;
  documentName: string;
  provider: ProviderId;
  model: string;
  mode: CouncilMode;
  resolvedMode?: Exclude<CouncilMode, "auto"> | null;
  presentation: PresentationKind;
  focus?: string | null;
  status: RunStatus;
  progress: number;
  currentStage?: string | null;
  error?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

export interface RunEvent {
  id: number;
  runId: string;
  stageId?: string | null;
  type: string;
  level: "info" | "warning" | "error";
  message: string;
  data?: unknown;
  createdAt: string;
}

export interface ArtifactRecord {
  id: string;
  runId: string;
  kind: string;
  title: string;
  contentType: string;
  content: string;
  sha256: string;
  metadata?: unknown;
  createdAt: string;
}

export interface PresentationRecord {
  id: string;
  runId: string;
  kind: PresentationKind;
  title: string;
  html: string;
  createdAt: string;
}

export interface RunDetails {
  run: RunRecord;
  events: RunEvent[];
  artifacts: ArtifactRecord[];
  presentations: PresentationRecord[];
  question?: { id: string; prompt: string } | null;
}

export interface ProviderModel {
  id: string;
  name: string;
  provider: ProviderId;
  contextWindow?: number;
}

export interface AppSettings {
  providers: Record<ProviderId, { model: string; configured: boolean; baseUrl?: string }>;
  automaticLanguage: boolean;
}
