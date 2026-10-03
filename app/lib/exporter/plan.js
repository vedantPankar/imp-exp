import { createNameRegistry, fileNameFrom } from "./names.js";

const encoder = new TextEncoder();
const noUrlReason = (file) =>
  file.status && file.status !== "READY"
    ? `File is not ready (status ${file.status.toLowerCase()}); try again later`
    : "Shopify returned no download URL for this file";
const idOf = (gid) =>
  String(gid ?? "")
    .split("/")
    .pop() || "item";
const extOf = (name) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
};

// Handles are normally already URL-safe, but never trust them as path segments.
const safeSegment = (value) =>
  String(value || "untitled")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\\/:*?"<>|]/g, "_")
    .replace(/^\.+/, "_")
    .replace(/[. ]+$/, "")
    .slice(0, 100) || "untitled";

/**
 * Items are the unit the ZIP exporter works on:
 *   download item: { path, url, size, entry }   -> fetched and stored as-is
 *   json item:     { path, bytes, entry }       -> written inline (deflated)
 * `entry` is what ends up in manifest.json for the item.
 */
// External videos (YouTube/Vimeo links) have no file to download; that is not a failure.
// Files that are still processing have no URL yet and are reported as failed with the reason.
export function splitDownloadable(files) {
  const external = files.filter((f) => f.kind === "ExternalVideo");
  return {
    downloadable: files.filter((f) => f.kind !== "ExternalVideo"),
    skipped: external.map((f) => ({
      name: f.embedUrl || f.id,
      reason: "External video: nothing to download",
    })),
  };
}

export function createPlanner({ keepOriginalNames = true } = {}) {
  const unique = createNameRegistry();
  const folderNames = createNameRegistry();
  const folders = new Map(); // product handle -> folder (stable, collision-safe)

  const downloadName = (file) => {
    const original = fileNameFrom(file);
    const name = keepOriginalNames
      ? original
      : `${idOf(file.id)}${extOf(original)}`;
    return { original, name };
  };

  return {
    fileItems(files) {
      return files.map((file) => {
        const { original, name } = downloadName(file);
        const path = unique(`files/${name}`);
        return {
          path,
          url: file.url,
          noUrlReason: noUrlReason(file),
          size: file.size ?? 0,
          entry: {
            type: "file",
            kind: file.kind,
            originalName: keepOriginalNames ? original : null,
            alt: file.alt ?? "",
            mimeType: file.mimeType ?? null,
            sourceId: file.id,
            productHandle: null,
          },
        };
      });
    },

    // Two different handles can only share a folder if sanitising made them equal,
    // so folders go through the same case-insensitive registry as file names.
    productMediaItems(media) {
      return media.map((m) => {
        if (!folders.has(m.productHandle)) {
          folders.set(
            m.productHandle,
            folderNames(safeSegment(m.productHandle)),
          );
        }
        const { original, name } = downloadName(m);
        const path = unique(`products/${folders.get(m.productHandle)}/${name}`);
        return {
          path,
          url: m.url,
          noUrlReason: noUrlReason(m),
          size: m.size ?? 0,
          entry: {
            type: "productMedia",
            kind: m.kind,
            originalName: keepOriginalNames ? original : null,
            alt: m.alt ?? "",
            mimeType: m.mimeType ?? null,
            sourceId: m.id,
            productHandle: m.productHandle,
            position: m.position,
          },
        };
      });
    },

    // Article images are bundled so the backup doesn't depend on the source store's CDN.
    articleImageItem(article) {
      if (!article.image?.url) return null;
      const original = fileNameFrom({ url: article.image.url });
      const path = unique(
        `content/article-images/${safeSegment(article.blogHandle)}/${safeSegment(article.handle)}-${original}`,
      );
      return {
        path,
        url: article.image.url,
        size: 0,
        entry: {
          type: "articleImage",
          originalName: original,
          alt: article.image.altText ?? "",
        },
      };
    },

    jsonItem(type, relativePath, record) {
      const path = unique(`content/${relativePath}`);
      return {
        path,
        bytes: encoder.encode(JSON.stringify(record, null, 2)),
        entry: { type, ...record },
      };
    },

    contentItems({ blogs = [], articles = [], pages = [], menus = [] }) {
      const items = [];
      for (const blog of blogs) {
        items.push(
          this.jsonItem("blog", `blogs/${safeSegment(blog.handle)}.json`, blog),
        );
      }
      for (const article of articles) {
        const image = this.articleImageItem(article);
        if (image) items.push(image);
        const record = {
          ...article,
          image: image
            ? { path: image.path, alt: article.image.altText ?? "" }
            : null,
        };
        items.push(
          this.jsonItem(
            "article",
            `articles/${safeSegment(article.blogHandle)}/${safeSegment(article.handle)}.json`,
            record,
          ),
        );
      }
      for (const page of pages) {
        items.push(
          this.jsonItem("page", `pages/${safeSegment(page.handle)}.json`, page),
        );
      }
      for (const menu of menus) {
        items.push(
          this.jsonItem("menu", `menus/${safeSegment(menu.handle)}.json`, menu),
        );
      }
      return items;
    },
  };
}

// Menu links point at store resources by URL; keep the handle so they can be re-linked
// on a store where the resource IDs are different.
const RESOURCE_URL =
  /\/(pages|collections|products|blogs)\/([^/?#]+)(?:\/([^/?#]+))?/;

export function normalizeMenuItem(item) {
  const match = RESOURCE_URL.exec(item.url ?? "");
  const internal = item.type !== "HTTP" && match;
  return {
    title: item.title,
    type: item.type,
    url: internal ? match[0] : (item.url ?? null),
    resourceHandle: internal ? (match[3] ?? match[2]) : null,
    resourceBlogHandle:
      internal && match[1] === "blogs" && match[3] ? match[2] : null,
    // Only meaningful on the same store; used for links with no handle (customer account pages)
    sourceResourceId: item.resourceId ?? null,
    tags: item.tags ?? [],
    items: (item.items ?? []).map(normalizeMenuItem),
  };
}
