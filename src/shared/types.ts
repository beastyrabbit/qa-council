export type ProviderId = "codex" | "openrouter" | "aibox";
export type CouncilMode = "auto" | "quick" | "standard" | "deep";
export type PresentationKind = "text" | "newspaper" | "onepaper";
export type RunStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "cancelled";
export type ImageProvider = "comfyui" | "openai" | "openrouter";
export type OpenRouterRoutingMode = "balanced" | "lowest" | "fastest";

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

export interface DocumentDetails extends DocumentRecord {
  extractedText: string;
}

export interface RunRecord {
  id: string;
  documentId: string;
  documentName: string;
  comparisonId?: string | null;
  provider: ProviderId;
  model: string;
  mode: CouncilMode;
  resolvedMode?: Exclude<CouncilMode, "auto"> | null;
  presentation: PresentationKind;
  imageProvider?: ImageProvider | null;
  focus?: string | null;
  status: RunStatus;
  progress: number;
  currentStage?: string | null;
  error?: string | null;
  createdAt: string;
  completedAt?: string | null;
  archivedAt?: string | null;
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
  stageId?: string | null;
  kind: string;
  title: string;
  contentType: string;
  content: string;
  contentHtml?: string;
  sha256: string;
  metadata?: unknown;
  createdAt: string;
}

export interface RunStageRecord {
  id: string;
  runId: string;
  name: string;
  role?: string | null;
  status: "running" | "completed" | "failed" | "cancelled";
  thinkingText: string;
  outputText: string;
  outputHtml: string;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  startedAt: string;
  completedAt?: string | null;
}

export interface PresentationRecord {
  id: string;
  runId: string;
  kind: PresentationKind;
  title: string;
  html: string;
  pages: PresentationPage[];
  createdAt: string;
}

export interface PresentationPage {
  slug: string;
  title: string;
  html: string;
}

export interface RunDetails {
  run: RunRecord;
  stages: RunStageRecord[];
  events: RunEvent[];
  artifacts: ArtifactRecord[];
  presentations: PresentationRecord[];
  question?: { id: string; prompt: string } | null;
}

export interface ReviewRecord {
  id: string;
  role: string;
  title: string;
  sha256: string;
  content: string;
  contentHtml: string;
  createdAt: string;
}

export interface DerivedAnalysisRecord {
  id: string;
  runId: string;
  kind: "top10_next_steps";
  status: "queued" | "running" | "ready" | "failed" | "cancelled";
  provider: ProviderId;
  model: string;
  sourceArtifactId: string;
  sourceRefs: Array<{ id: string; sha256: string; role?: string }>;
  thinkingText: string;
  outputText: string;
  outputHtml: string;
  error?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface ProviderModel {
  id: string;
  name: string;
  provider: ProviderId;
  available?: boolean;
  contextWindow?: number;
  maximumContextWindow?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  supportsReasoning?: boolean;
  supportsVision?: boolean;
}

export interface ComparisonRecord {
  id: string;
  documentId: string;
  documentName: string;
  mode: CouncilMode;
  presentation: PresentationKind;
  focus?: string | null;
  createdAt: string;
  runs: RunRecord[];
}

export interface AppSettings {
  providers: Record<
    ProviderId,
    { model: string; configured: boolean; imageConfigured?: boolean; baseUrl?: string }
  >;
  automaticLanguage: boolean;
  openRouterRouting: OpenRouterRoutingMode;
  comfyui: {
    enabled: boolean;
    configured: boolean;
    baseUrl: string;
    checkpoint: string;
  };
}
