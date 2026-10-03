import { normalizeMenuItem, splitDownloadable } from "./plan.js";

async function getJson(url, signal) {
  const response = await fetch(url, { signal });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
  return json;
}

// Follows cursors for one /api/content or /api/files query and returns every record.
async function pageAll(baseUrl, signal, onCount) {
  const all = [];
  let cursor = null;
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const sep = baseUrl.includes("?") ? "&" : "?";
    const page = await getJson(
      cursor ? `${baseUrl}${sep}cursor=${encodeURIComponent(cursor)}` : baseUrl,
      signal,
    );
    all.push(...page.files);
    onCount?.(page.files.length);
    if (!page.hasNextPage) return all;
    cursor = page.cursor;
  }
}

/**
 * Loads the metadata (never file contents) for everything the settings ask for.
 * Product media wins over the Files list if the same media id shows up in both.
 */
export async function collectExportData({ settings, signal, onProgress }) {
  let listed = 0;
  const count = (n) => {
    listed += n;
    onProgress?.({ phase: "listing", listed });
  };
  const data = {
    files: [],
    productMedia: [],
    blogs: [],
    articles: [],
    pages: [],
    menus: [],
    skipped: [],
  };

  if (settings.includeProductMedia) {
    data.productMedia = await pageAll(
      "/api/content?type=productMedia",
      signal,
      count,
    );
  }
  if (settings.includeFiles) {
    const files = await pageAll("/api/files", signal, count);
    const productMediaIds = new Set(data.productMedia.map((m) => m.id));
    const { downloadable, skipped } = splitDownloadable(
      files.filter((f) => !productMediaIds.has(f.id)),
    );
    data.files = downloadable;
    data.skipped = skipped;
  }
  if (settings.includeBlogPosts) {
    data.blogs = await pageAll("/api/content?type=blogs", signal, count);
    for (const blog of data.blogs) {
      const articles = await pageAll(
        `/api/content?type=articles&blogId=${encodeURIComponent(blog.id)}`,
        signal,
        count,
      );
      data.articles.push(
        ...articles.map((a) => ({ ...a, blogHandle: blog.handle })),
      );
    }
  }
  if (settings.includePages) {
    data.pages = await pageAll("/api/content?type=pages", signal, count);
  }
  if (settings.includeMenus) {
    const menus = await pageAll("/api/content?type=menus", signal, count);
    data.menus = menus.map((m) => ({
      ...m,
      items: m.items.map(normalizeMenuItem),
    }));
  }
  return data;
}
