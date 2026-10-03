import { authenticate } from "../shopify.server";
import {
  attachProductMedia,
  checkProductMedia,
  createDraftProducts,
  createFiles,
  createStagedUploads,
  upsertArticles,
  upsertBlogs,
  upsertMenus,
  upsertPages,
} from "../services/import.server";

const MAX_BATCH = 50;

// POST { intent, ... } — thin dispatcher; the Admin API work lives in services/import.server.js
export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const list = body.items ?? body.files;
  if (Array.isArray(list) && list.length > MAX_BATCH) {
    return Response.json(
      { error: `Batch too large (max ${MAX_BATCH})` },
      { status: 400 },
    );
  }

  try {
    switch (body.intent) {
      case "stage":
        return Response.json({
          targets: await createStagedUploads(admin, body.files),
        });
      case "createFiles":
        return Response.json({
          results: await createFiles(admin, body.files, !!body.replace),
        });
      case "checkProductMedia":
        return Response.json({
          results: await checkProductMedia(admin, body.items),
        });
      case "createProducts":
        return Response.json({
          results: await createDraftProducts(admin, body.items),
        });
      case "attachProductMedia":
        return Response.json({
          results: await attachProductMedia(admin, body, !!body.replace),
        });
      case "blogs":
        return Response.json({ results: await upsertBlogs(admin, body.items) });
      case "articles":
        return Response.json({
          results: await upsertArticles(admin, body.items),
        });
      case "pages":
        return Response.json({ results: await upsertPages(admin, body.items) });
      case "menus":
        return Response.json({ results: await upsertMenus(admin, body.items) });
      default:
        return Response.json({ error: "Unknown intent" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof Response) throw error;
    return Response.json({ error: error.message }, { status: 502 });
  }
};
