import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import type { RunRecord } from "../../shared/types";

export function RunStatus({ run }: { run: RunRecord }) {
  if (run.status === "completed")
    return (
      <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">
        Fertig
      </Badge>
    );
  if (run.status === "failed") return <Badge variant="destructive">Fehler</Badge>;
  if (run.status === "cancelling")
    return (
      <Badge variant="outline">
        <Spinner /> Wird abgebrochen …
      </Badge>
    );
  if (run.status === "cancelled") return <Badge variant="outline">Abgebrochen</Badge>;
  if (run.status === "waiting_for_input")
    return (
      <Badge
        variant="outline"
        className="animate-pulse border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      >
        Rückfrage
      </Badge>
    );
  if (run.status === "queued") return <Badge variant="secondary">Wartet</Badge>;
  return (
    <Badge variant="secondary">
      <Spinner /> {run.progress} %
    </Badge>
  );
}
