import { authenticate } from "../shopify.server";
import { recordRun } from "../services/settings.server";

const TYPES = new Set([
  "files",
  "productMedia",
  "articles",
  "blogs",
  "pages",
  "menus",
]);

// POST { runs: [{ type, itemCount, totalBytes }] } after an export finishes successfully.
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const { runs } = await request.json();
  for (const run of runs ?? []) {
    if (!TYPES.has(run.type)) continue;
    await recordRun(
      session.shop,
      run.type,
      Math.max(0, Math.floor(Number(run.itemCount) || 0)),
      Math.max(0, Math.floor(Number(run.totalBytes) || 0)),
    );
  }
  return Response.json({ ok: true });
};
