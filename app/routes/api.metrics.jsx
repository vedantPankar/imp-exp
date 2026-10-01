import { authenticate } from "../shopify.server";
import {
  getQuickCounts,
  scanFiles,
  scanProductsWithMedia,
} from "../services/metrics.server";

// GET /api/metrics?metric=quick|files|productMedia[&cursor=...]
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const metric = url.searchParams.get("metric");
  const cursor = url.searchParams.get("cursor") || null;

  try {
    if (metric === "quick") return Response.json(await getQuickCounts(admin));
    if (metric === "files")
      return Response.json(await scanFiles(admin, cursor));
    if (metric === "productMedia")
      return Response.json(await scanProductsWithMedia(admin, cursor));
  } catch (error) {
    if (error instanceof Response) throw error;
    return Response.json({ error: error.message }, { status: 502 });
  }
  return Response.json({ error: "Unknown metric" }, { status: 400 });
};
