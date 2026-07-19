import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { Check, Circle, GitBranch, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { RunStageRecord } from "../../shared/types";
import "@xyflow/react/dist/style.css";

type WorkflowPhaseId =
  | "extraction"
  | "evidence"
  | "routing"
  | "role-reviews"
  | "peer-reviews"
  | "joint-review"
  | "debate"
  | "council-rounds"
  | "synthesis"
  | "reports";

const WORKFLOW_PHASES: Array<{
  id: WorkflowPhaseId;
  title: string;
  description: string;
  parallel?: boolean;
}> = [
  {
    id: "extraction",
    title: "Dokument erschließen",
    description: "Originaldatei extrahieren und verlässlich lokalisieren",
  },
  {
    id: "evidence",
    title: "Dokumentweit voranalysieren",
    description: "Chunks zusammenfassen und entfernte Zusammenhänge verknüpfen",
  },
  {
    id: "routing",
    title: "RACI festlegen",
    description: "Betroffene Aktivitäten und Fachrollen bestimmen",
  },
  {
    id: "role-reviews",
    title: "Rollenreviews",
    description: "Ein dokumentweites Review je Rolle",
    parallel: true,
  },
  {
    id: "peer-reviews",
    title: "Cross-Reviews",
    description: "Anonyme Gegenprüfung und Rangfolge",
    parallel: true,
  },
  {
    id: "joint-review",
    title: "Gemeinsamer Stand",
    description: "Befunde zusammenführen, ohne Dissens zu verlieren",
  },
  {
    id: "debate",
    title: "Pro und Contra",
    description: "Ankläger und Verteidiger prüfen nacheinander",
  },
  {
    id: "council-rounds",
    title: "Council-Runden",
    description: "Rollen beraten parallel, danach folgt die Zusammenführung",
    parallel: true,
  },
  {
    id: "synthesis",
    title: "Synthese und Dissens",
    description: "Finale Aussage und unabhängiger Verlustcheck",
  },
  {
    id: "reports",
    title: "Ausgaben bauen",
    description: "Text, Newspaper und One-Paper veröffentlichen",
    parallel: true,
  },
];

export function workflowPhaseForStage(name: string): WorkflowPhaseId | null {
  if (name === "Dokumentextraktion") return "extraction";
  if (name === "Dokumentweite Voranalyse" || name.startsWith("Belegkarte ")) return "evidence";
  if (name.startsWith("QA-Architekt · RACI-Routing")) return "routing";
  if (name.startsWith("Einzelreview · ")) return "role-reviews";
  if (name.startsWith("Cross-Review · ") || name.startsWith("Cross-Ranking · ")) {
    return "peer-reviews";
  }
  if (name === "Council · gemeinsames Review") return "joint-review";
  if (name.startsWith("Council-Debatte · ")) return "debate";
  if (name.startsWith("Council-Runde ")) return "council-rounds";
  if (name === "Finale Council-Synthese" || name === "Dissens-Audit") return "synthesis";
  if (name.startsWith("Report-")) return "reports";
  return null;
}

function statusLabel(status: RunStageRecord["status"]) {
  if (status === "running") return "läuft";
  if (status === "completed") return "fertig";
  if (status === "failed") return "fehlgeschlagen";
  return "abgebrochen";
}

function StageStatusIcon({ status }: { status: string }) {
  if (status === "running") return <Spinner className="size-3.5 text-primary" />;
  if (status === "completed") return <Check className="size-3.5 text-primary" aria-hidden="true" />;
  if (status === "failed") return <X className="size-3.5 text-destructive" aria-hidden="true" />;
  return <Circle className="size-3.5 text-muted-foreground" aria-hidden="true" />;
}

function shortStageName(stage: RunStageRecord) {
  const [, detail] = stage.name.split(" · ", 2);
  return detail ?? stage.name;
}

type PhaseState = "running" | "completed" | "failed" | "future";

function stateClasses(state: string, selected = false) {
  return cn(
    "rounded-lg border bg-card text-card-foreground shadow-sm transition-colors",
    state === "running" && "border-primary ring-2 ring-primary/25",
    state === "completed" && "border-primary/35 bg-primary/5",
    state === "failed" && "border-destructive/50 bg-destructive/5",
    (state === "future" || state === "queued" || state === "cancelled") &&
      "border-dashed opacity-75",
    selected && "ring-2 ring-ring",
  );
}

type PhaseNodeType = Node<
  {
    index: number;
    title: string;
    description: string;
    parallel: boolean;
    state: PhaseState;
    done: number;
    total: number;
  },
  "phase"
>;

type StageNodeType = Node<
  {
    label: string;
    sublabel: string;
    status: string;
    stageId: string | null;
    selected: boolean;
  },
  "stage"
>;

const HIDDEN_HANDLE = "pointer-events-none !size-1 !min-h-0 !min-w-0 opacity-0";

function PhaseNode({ data }: NodeProps<PhaseNodeType>) {
  return (
    <div className={cn(stateClasses(data.state), "w-52 px-3 py-2")}>
      <Handle type="target" position={Position.Left} className={HIDDEN_HANDLE} />
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-bold",
            data.state === "completed" && "border-primary/40 bg-primary/10 text-primary",
            data.state === "running" && "border-primary bg-primary text-primary-foreground",
            data.state === "failed" && "border-destructive/50 bg-destructive/10 text-destructive",
            data.state === "future" && "text-muted-foreground",
          )}
        >
          {String(data.index + 1).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <strong className="truncate text-xs">{data.title}</strong>
            <StageStatusIcon
              status={
                data.state === "future" && data.done === 0
                  ? "queued"
                  : data.state === "completed"
                    ? "completed"
                    : data.state
              }
            />
          </div>
          <p className="truncate text-[10px] text-muted-foreground">
            {data.parallel ? "parallel" : "sequenziell"}
            {data.total > 0 ? ` · ${data.done}/${data.total}` : ""}
          </p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className={HIDDEN_HANDLE} />
      <Handle type="source" position={Position.Bottom} id="stages" className={HIDDEN_HANDLE} />
    </div>
  );
}

function StageNode({ data }: NodeProps<StageNodeType>) {
  return (
    <div
      className={cn(
        stateClasses(data.status, data.selected),
        "w-52 cursor-pointer px-2.5 py-1.5 hover:border-ring",
      )}
    >
      <Handle type="target" position={Position.Top} className={HIDDEN_HANDLE} />
      <div className="flex items-center gap-2">
        <StageStatusIcon status={data.status} />
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-[11px] leading-tight">{data.label}</strong>
          <small className="block truncate text-[10px] text-muted-foreground">
            {data.sublabel}
          </small>
        </div>
      </div>
    </div>
  );
}

const NODE_TYPES = { phase: PhaseNode, stage: StageNode };

const PHASE_WIDTH = 240;
const STAGE_TOP = 92;
const STAGE_STEP = 56;

function GraphCanvas({
  stages,
  roles,
  selectedStageId,
  onSelectStage,
}: {
  stages: RunStageRecord[];
  roles: string[];
  selectedStageId: string | null;
  onSelectStage: (stageId: string | null) => void;
}) {
  const { fitView } = useReactFlow();

  const { nodes, edges } = useMemo(() => {
    const stagesByPhase = new Map<WorkflowPhaseId, RunStageRecord[]>();
    for (const phase of WORKFLOW_PHASES) stagesByPhase.set(phase.id, []);
    for (const stage of stages) {
      const phaseId = workflowPhaseForStage(stage.name);
      if (phaseId) stagesByPhase.get(phaseId)?.push(stage);
    }
    const startedPhaseIndexes = WORKFLOW_PHASES.map((phase, index) =>
      (stagesByPhase.get(phase.id)?.length ?? 0) > 0 ? index : -1,
    ).filter((index) => index >= 0);
    const latestStartedPhase = Math.max(-1, ...startedPhaseIndexes);

    const nodes: Node[] = [];
    const edges: Edge[] = [];

    WORKFLOW_PHASES.forEach((phase, phaseIndex) => {
      const phaseStages = stagesByPhase.get(phase.id) ?? [];
      const expectedRoles = phase.id === "role-reviews" && phaseStages.length === 0 ? roles : [];
      const state: PhaseState = phaseStages.some((stage) => stage.status === "running")
        ? "running"
        : phaseStages.some((stage) => stage.status === "failed")
          ? "failed"
          : phaseStages.length > 0 && phaseStages.every((stage) => stage.status === "completed")
            ? "completed"
            : phaseIndex < latestStartedPhase
              ? "completed"
              : "future";

      const x = phaseIndex * PHASE_WIDTH;
      nodes.push({
        id: `phase-${phase.id}`,
        type: "phase",
        position: { x, y: 0 },
        draggable: false,
        selectable: false,
        data: {
          index: phaseIndex,
          title: phase.title,
          description: phase.description,
          parallel: Boolean(phase.parallel),
          state,
          done: phaseStages.filter((stage) => stage.status === "completed").length,
          total: phaseStages.length,
        },
      });

      if (phaseIndex > 0) {
        const previous = WORKFLOW_PHASES[phaseIndex - 1];
        edges.push({
          id: `flow-${previous.id}-${phase.id}`,
          source: `phase-${previous.id}`,
          target: `phase-${phase.id}`,
          animated: state === "running",
          style:
            state === "future"
              ? { stroke: "var(--border)", strokeDasharray: 4 }
              : { stroke: "var(--primary)", opacity: 0.55 },
        });
      }

      const stageEntries: Array<{
        id: string;
        stageId: string | null;
        label: string;
        sublabel: string;
        status: string;
      }> = [
        ...phaseStages.map((stage) => ({
          id: `stage-${stage.id}`,
          stageId: stage.id,
          label: shortStageName(stage),
          sublabel: `${stage.role ? `${stage.role} · ` : ""}${statusLabel(stage.status)}`,
          status: stage.status,
        })),
        ...expectedRoles.map((role) => ({
          id: `expected-${role}`,
          stageId: null,
          label: role,
          sublabel: "wartet auf RACI-Abschluss",
          status: "queued",
        })),
      ];

      stageEntries.forEach((entry, stageIndex) => {
        nodes.push({
          id: entry.id,
          type: "stage",
          position: { x: x + 14, y: STAGE_TOP + stageIndex * STAGE_STEP },
          draggable: false,
          selectable: false,
          data: {
            label: entry.label,
            sublabel: entry.sublabel,
            status: entry.status,
            stageId: entry.stageId,
            selected: Boolean(entry.stageId && entry.stageId === selectedStageId),
          },
        });
        edges.push({
          id: `link-${entry.id}`,
          source: `phase-${phase.id}`,
          sourceHandle: "stages",
          target: entry.id,
          animated: entry.status === "running",
          style: { stroke: "var(--border)" },
        });
      });
    });

    return { nodes, edges };
  }, [stages, roles, selectedStageId]);

  const nodeCount = nodes.length;
  useEffect(() => {
    void nodeCount;
    const frame = window.requestAnimationFrame(() => {
      void fitView({ padding: 0.15, duration: 300 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitView, nodeCount]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      colorMode={
        typeof document !== "undefined" && document.documentElement.classList.contains("dark")
          ? "dark"
          : "light"
      }
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.25}
      maxZoom={1.6}
      nodesConnectable={false}
      onNodeClick={(_, node) => {
        if (node.type !== "stage") return;
        const stageId = (node.data as StageNodeType["data"]).stageId;
        if (stageId) onSelectStage(stageId === selectedStageId ? null : stageId);
      }}
      proOptions={{ hideAttribution: false }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  );
}

export function RunWorkflowGraph({
  stages,
  roles,
  selectedStageId,
  onSelectStage,
}: {
  stages: RunStageRecord[];
  roles: string[];
  selectedStageId: string | null;
  onSelectStage: (stageId: string | null) => void;
}) {
  return (
    <Card className="workflow-map gap-0 py-0">
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b px-4 py-3!">
        <div className="flex items-center gap-2.5">
          <GitBranch className="size-4 text-muted-foreground" aria-hidden="true" />
          <div>
            <h2 className="font-heading text-sm font-semibold">Ablaufgrafik</h2>
            <p className="text-xs text-muted-foreground">
              Ein Knoten öffnet unten das zugehörige echte Agentenprotokoll · ziehen und zoomen
              möglich.
            </p>
          </div>
        </div>
        {selectedStageId && (
          <Button variant="outline" size="sm" onClick={() => onSelectStage(null)}>
            Gesamten Log zeigen
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <div className="h-[400px] w-full">
          <ReactFlowProvider>
            <GraphCanvas
              stages={stages}
              roles={roles}
              selectedStageId={selectedStageId}
              onSelectStage={onSelectStage}
            />
          </ReactFlowProvider>
        </div>
      </CardContent>
    </Card>
  );
}
