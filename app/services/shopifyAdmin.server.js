const MAX_RETRIES = 5;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs an Admin GraphQL operation and retries on cost-based throttling
 * (THROTTLED error) and transient HTTP failures (429/5xx) with exponential backoff.
 * Throws on any other GraphQL error. Returns `data`.
 */
export async function adminGraphql(admin, query, variables = {}) {
  let attempt = 0;
  for (;;) {
    try {
      const response = await admin.graphql(query, { variables });
      const json = await response.json();

      const throttled = json.errors?.some(
        (e) => e.extensions?.code === "THROTTLED",
      );
      if (throttled && attempt < MAX_RETRIES) {
        await backoff(attempt++, json.extensions?.cost);
        continue;
      }
      if (json.errors?.length) {
        throw new Error(json.errors.map((e) => e.message).join("; "));
      }
      return json.data;
    } catch (error) {
      // admin.graphql throws a Response for non-2xx statuses
      const status = error instanceof Response ? error.status : 0;
      const transient = status === 429 || status >= 500;
      if (transient && attempt < MAX_RETRIES) {
        await backoff(attempt++);
        continue;
      }
      throw error;
    }
  }
}

// Waits long enough for the cost bucket to refill when we know the restore rate,
// otherwise falls back to exponential backoff with jitter.
async function backoff(attempt, cost) {
  const status = cost?.throttleStatus;
  let ms = 500 * 2 ** attempt + Math.random() * 250;
  if (status && cost.requestedQueryCost) {
    const deficit = cost.requestedQueryCost - status.currentlyAvailable;
    if (deficit > 0) ms = Math.max(ms, (deficit / status.restoreRate) * 1000);
  }
  await sleep(Math.min(ms, 15000));
}
