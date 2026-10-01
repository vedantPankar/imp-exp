import { authenticate } from "../shopify.server";
import { listFilesPage } from "../services/files.server";

// GET /api/files[?cursor=...] -> one page of files
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const cursor = new URL(request.url).searchParams.get("cursor") || null;
  try {
    return Response.json(await listFilesPage(admin, cursor));
  } catch (error) {
    if (error instanceof Response) throw error;
    return Response.json({ error: error.message }, { status: 502 });
  }
};
