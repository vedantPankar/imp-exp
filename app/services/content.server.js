import { adminGraphql } from "./shopifyAdmin.server";

const BLOGS_QUERY = `#graphql
  query ExportBlogs($cursor: String) {
    blogs(first: 50, after: $cursor) {
      nodes { id handle title commentPolicy templateSuffix }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const ARTICLES_QUERY = `#graphql
  query ExportArticles($blogId: ID!, $cursor: String) {
    blog(id: $blogId) {
      articles(first: 50, after: $cursor) {
        nodes {
          id handle title body summary tags isPublished publishedAt templateSuffix
          author { name }
          image { url altText }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;

const PAGES_QUERY = `#graphql
  query ExportPages($cursor: String) {
    pages(first: 50, after: $cursor) {
      nodes { id handle title body isPublished publishedAt templateSuffix }
      pageInfo { hasNextPage endCursor }
    }
  }`;

// Shopify menus nest at most 3 levels deep.
const MENU_ITEM = "id title type url resourceId tags";
const MENUS_QUERY = `#graphql
  query ExportMenus($cursor: String) {
    menus(first: 50, after: $cursor) {
      nodes {
        id handle title isDefault
        items { ${MENU_ITEM} items { ${MENU_ITEM} items { ${MENU_ITEM} } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const page = (connection, files) => ({
  files,
  hasNextPage: connection.pageInfo.hasNextPage,
  cursor: connection.pageInfo.endCursor,
});

export async function listBlogsPage(admin, cursor) {
  const { blogs } = await adminGraphql(admin, BLOGS_QUERY, { cursor });
  return page(
    blogs,
    blogs.nodes.map((b) => ({
      id: b.id,
      handle: b.handle,
      title: b.title,
      commentPolicy: b.commentPolicy,
      templateSuffix: b.templateSuffix ?? null,
    })),
  );
}

// `blogHandle` is added by the client, which already knows it from the blog list.
export async function listArticlesPage(admin, blogId, cursor) {
  const data = await adminGraphql(admin, ARTICLES_QUERY, { blogId, cursor });
  if (!data.blog) return { files: [], hasNextPage: false, cursor: null };
  const { articles } = data.blog;
  return page(
    articles,
    articles.nodes.map((a) => ({
      id: a.id,
      handle: a.handle,
      title: a.title,
      bodyHtml: a.body,
      summary: a.summary ?? "",
      author: a.author?.name ?? "",
      tags: a.tags,
      isPublished: a.isPublished,
      publishedAt: a.publishedAt,
      templateSuffix: a.templateSuffix ?? null,
      image: a.image
        ? { url: a.image.url, altText: a.image.altText ?? "" }
        : null,
    })),
  );
}

export async function listPagesPage(admin, cursor) {
  const { pages } = await adminGraphql(admin, PAGES_QUERY, { cursor });
  return page(
    pages,
    pages.nodes.map((p) => ({
      id: p.id,
      handle: p.handle,
      title: p.title,
      bodyHtml: p.body,
      isPublished: p.isPublished,
      publishedAt: p.publishedAt,
      templateSuffix: p.templateSuffix ?? null,
    })),
  );
}

// Raw menu nodes; the client normalises items (resource handles) with normalizeMenuItem.
export async function listMenusPage(admin, cursor) {
  const { menus } = await adminGraphql(admin, MENUS_QUERY, { cursor });
  return page(
    menus,
    menus.nodes.map((m) => ({
      id: m.id,
      handle: m.handle,
      title: m.title,
      isDefault: m.isDefault,
      items: m.items,
    })),
  );
}
