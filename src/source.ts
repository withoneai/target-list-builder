import { getDatasetItems, runActorTaskSynchronouslyGetDatasetItems } from "@withone/sdk/apify";
import { DEMO, connections, limits, loadFixture, oneClient, source } from "./config.js";
import type { SourceRow } from "./types.js";

/**
 * The live source. Both paths are typed actions from the One SDK's Apify
 * module, so the endpoint, the auth and the pagination are the SDK's problem.
 *
 * Deliberately nothing here knows what a job board row looks like. The whole
 * point of the design is that the shape of the source is not this repo's
 * business: rows arrive as whatever the actor emitted, and extract.ts reads
 * them. Point it at a directory, a conference attendee list or a job board and
 * no code below changes.
 */

function apify() {
  return oneClient().connection(connections.apify());
}

function rows(data: unknown): SourceRow[] {
  if (Array.isArray(data)) return data as SourceRow[];
  // Some actors wrap their output; take the first array-valued property.
  if (data && typeof data === "object") {
    for (const value of Object.values(data)) {
      if (Array.isArray(value)) return value as SourceRow[];
    }
  }
  return [];
}

export interface Source {
  rows: SourceRow[];
  origin: string;
}

/**
 * Replaying a dataset costs nothing on the Apify side, so it is tried first
 * when both are set. Tuning config/targets.md means running the qualifier ten
 * times against one scrape, not scraping ten times.
 */
export async function readSource(): Promise<Source> {
  if (DEMO) {
    const items = rows(loadFixture("source.json")).slice(0, limits.maxSourceRows);
    return { rows: items, origin: "fixtures/source.json (recorded scrape)" };
  }

  const datasetId = source.datasetId();
  if (datasetId) {
    const res = await apify().run(
      getDatasetItems({
        path: { datasetId },
        query: { clean: true, format: "json", limit: limits.maxSourceRows },
      }),
    );
    return { rows: rows(res.data), origin: `apify dataset ${datasetId}` };
  }

  const taskId = source.taskId();
  if (!taskId) {
    throw new Error(
      "No source. Set APIFY_TASK_ID to run your saved scrape, or APIFY_DATASET_ID to replay one.",
    );
  }

  // An empty body keeps the input you configured on the task in the Apify
  // console. maxItems caps what the run is allowed to cost.
  const res = await apify().run(
    runActorTaskSynchronouslyGetDatasetItems({
      path: { actorTaskId: taskId },
      body: {},
      query: { clean: true, format: "json", maxItems: limits.maxSourceRows },
    }),
  );
  return { rows: rows(res.data), origin: `apify task ${taskId} (fresh run)` };
}

/** A cheap liveness probe for `npm run check`: does the source answer at all. */
export async function probeApify(): Promise<string> {
  const datasetId = source.datasetId();
  if (datasetId) {
    const res = await apify().run(
      getDatasetItems({ path: { datasetId }, query: { format: "json", limit: 1 } }),
    );
    return `dataset ${datasetId} holds items (read ${rows(res.data).length})`;
  }
  const taskId = source.taskId();
  if (!taskId) throw new Error("Neither APIFY_TASK_ID nor APIFY_DATASET_ID is set.");
  // Not run here on purpose: starting the task would spend credits during a check.
  return `task ${taskId} configured (not run, a check should not spend credits)`;
}
