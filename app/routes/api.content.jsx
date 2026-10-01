import { authenticate } from "../shopify.server";
import { listProductMediaPage } from "../services/products.server";
import {
  listArticlesPage,
  listBlogsPage,
  listMenusPage,
  listPagesPage,
} from "../services/content.server";

// GET /api/content?type=productMedia|blogs|articles|pages|menus[&cursor=][&blogId=]
export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const params = new URL(request.url).searchParams;
  const cursor = params.get("cursor") || null;
  const blogId = params.get("blogId");

  try {
    switch (params.get("type")) {
      case "productMedia":
        return Response.json(await listProductMediaPage(admin, cursor));
      case "blogs":
        return Response.json(await listBlogsPage(admin, cursor));
      case "articles":
        if (!blogId?.startsWith("gid://shopify/Blog/"))
          return Response.json({ error: "blogId required" }, { status: 400 });
        return Response.json(await listArticlesPage(admin, blogId, cursor));
      case "pages":
        return Response.json(await listPagesPage(admin, cursor));
      case "menus":
        return Response.json(await listMenusPage(admin, cursor));
      default:
        return Response.json({ error: "Unknown type" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof Response) throw error;
    return Response.json({ error: error.message }, { status: 502 });
  }
};
