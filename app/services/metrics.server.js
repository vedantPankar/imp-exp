import { adminGraphql } from "./shopifyAdmin.server";

const PAGE = 250;

// Cheap counts that need one request, plus paginating blogs (few per shop) for the article total.
export async function getQuickCounts(admin) {
  const data = await adminGraphql(
    admin,
    `#graphql
    query QuickCounts {
      pagesCount { count }
      blogsCount { count }
    }`,
  );

  let menus = 0;
  let articles = 0;
  let cursor = null;
  for (;;) {
    const page = await adminGraphql(
      admin,
      `#graphql
      query MenusAndBlogs($cursor: String) {
        menus(first: ${PAGE}, after: $cursor) {
          nodes { id }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { cursor },
    );
    menus += page.menus.nodes.length;
    if (!page.menus.pageInfo.hasNextPage) break;
    cursor = page.menus.pageInfo.endCursor;
  }

  cursor = null;
  for (;;) {
    const page = await adminGraphql(
      admin,
      `#graphql
      query BlogArticleCounts($cursor: String) {
        blogs(first: ${PAGE}, after: $cursor) {
          nodes { articlesCount { count } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { cursor },
    );
    for (const blog of page.blogs.nodes) articles += blog.articlesCount.count;
    if (!page.blogs.pageInfo.hasNextPage) break;
    cursor = page.blogs.pageInfo.endCursor;
  }

  return {
    pages: data.pagesCount.count,
    blogs: data.blogsCount.count,
    menus,
    articles,
  };
}

/**
 * Scans up to `maxPages` pages of files from `cursor`. Shopify has no aggregate for
 * file count/size, so the client calls this repeatedly and sums the partial results.
 */
export async function scanFiles(admin, cursor, maxPages = 4) {
  let count = 0;
  let bytes = 0;
  let done = false;
  for (let i = 0; i < maxPages; i++) {
    const data = await adminGraphql(
      admin,
      `#graphql
      query FileSizes($cursor: String) {
        files(first: ${PAGE}, after: $cursor) {
          nodes {
            __typename
            ... on MediaImage { originalSource { fileSize } }
            ... on Video { originalSource { fileSize } }
            ... on GenericFile { originalFileSize }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { cursor },
    );
    for (const f of data.files.nodes) {
      count++;
      bytes += f.originalSource?.fileSize ?? f.originalFileSize ?? 0;
    }
    cursor = data.files.pageInfo.endCursor;
    if (!data.files.pageInfo.hasNextPage) {
      done = true;
      break;
    }
  }
  return { count, bytes, cursor, done };
}

// Same chunked approach for products that have at least one media item.
export async function scanProductsWithMedia(admin, cursor, maxPages = 4) {
  let count = 0;
  let done = false;
  for (let i = 0; i < maxPages; i++) {
    const data = await adminGraphql(
      admin,
      `#graphql
      query ProductsWithMedia($cursor: String) {
        products(first: ${PAGE}, after: $cursor) {
          nodes { mediaCount { count } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { cursor },
    );
    count += data.products.nodes.filter((p) => p.mediaCount.count > 0).length;
    cursor = data.products.pageInfo.endCursor;
    if (!data.products.pageInfo.hasNextPage) {
      done = true;
      break;
    }
  }
  return { count, cursor, done };
}
