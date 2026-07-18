import { createDatabase, setDefaultDatabase, withDatabase } from "./db/index.js";
import { buildApp } from "./index.js";
import { recoverInterruptedRuns, runScheduler } from "./orchestrator.js";
import { cleanupOrphanedReportWorkspaces } from "./report-workspace.js";

const database = createDatabase();
setDefaultDatabase(database);

await withDatabase(database, async () => {
  await cleanupOrphanedReportWorkspaces();
  const queue = runScheduler();
  const app = await buildApp({ db: database, queue, logger: true });
  const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3001);
  await app.listen({ host: "0.0.0.0", port });

  const recovered = recoverInterruptedRuns();
  if (recovered.interrupted || recovered.resumedQueued) {
    app.log.warn(recovered, "Läufe nach Prozessstart abgeglichen");
  }
});
