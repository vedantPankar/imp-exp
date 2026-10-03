import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import { createPlanner, normalizeMenuItem } from "../app/lib/exporter/plan.js";
import { exportItems } from "../app/lib/exporter/zipExporter.js";
import { createDownloader } from "../app/lib/exporter/fetchWithProxy.js";
import { isAllowedProxyUrl } from "../app/services/proxyUrl.server.js";

const media = (productHandle, name, id) => ({
  id: `gid://shopify/MediaImage/${id}`,
  kind: "MediaImage",
  url: `https://cdn.shopify.com/s/files/${name}?v=1`,
  alt: `alt ${name}`,
  filename: null,
  size: 100,
  mimeType: "image/jpeg",
  productHandle,
  position: 0,
});

test("product media goes in products/<handle>/ with collision-safe names", () => {
  const planner = createPlanner();
  const items = planner.productMediaItems([
    media("shirt", "a.jpg", 1),
    media("shirt", "a.jpg", 2), // same name, same product
    media("hat", "a.jpg", 3), // same name, different product
    media("we/ird..", "b.jpg", 4), // unsafe handle can't escape its folder
    media("Weird", "c.jpg", 5),
    media("weird", "d.jpg", 6), // handles differing only by case share no folder
  ]);
  const paths = items.map((i) => i.path);
  assert.deepEqual(paths.slice(0, 3), [
    "products/shirt/a.jpg",
    "products/shirt/a-2.jpg",
    "products/hat/a.jpg",
  ]);
  assert.ok(
    paths.every((p) => !p.includes("..") && p.split("/").length === 3),
    paths.join(),
  );
  assert.equal(new Set(paths.map((p) => p.toLowerCase())).size, paths.length);
  assert.equal(
    new Set(paths.slice(4).map((p) => p.split("/")[1].toLowerCase())).size,
    2,
  );
  assert.equal(items[0].entry.productHandle, "shirt");
});

test("files do not collide with product media paths", () => {
  const planner = createPlanner();
  const [f] = planner.fileItems([
    {
      id: "gid://x/1",
      url: "https://cdn.shopify.com/a.jpg",
      kind: "GenericFile",
    },
  ]);
  const [p] = planner.productMediaItems([media("a", "a.jpg", 2)]);
  assert.notEqual(f.path, p.path);
});

const content = {
  blogs: [
    {
      id: "b1",
      handle: "news",
      title: "News",
      commentPolicy: "MODERATED",
      templateSuffix: null,
    },
  ],
  articles: [
    {
      id: "a1",
      handle: "hello",
      title: "Hello",
      bodyHtml: "<p>Hi</p>",
      summary: "s",
      author: "Ann",
      tags: ["x", "y"],
      isPublished: true,
      publishedAt: "2024-01-01T00:00:00Z",
      templateSuffix: null,
      blogHandle: "news",
      image: {
        url: "https://cdn.shopify.com/s/files/hero.png?v=3",
        altText: "Hero",
      },
    },
    {
      id: "a2",
      handle: "draft",
      title: "Draft",
      bodyHtml: "",
      summary: "",
      author: "",
      tags: [],
      isPublished: false,
      publishedAt: null,
      blogHandle: "news",
      image: null,
    },
  ],
  pages: [
    {
      id: "p1",
      handle: "about",
      title: "About",
      bodyHtml: "<h1>x</h1>",
      isPublished: true,
      publishedAt: null,
    },
  ],
  menus: [
    {
      id: "m1",
      handle: "main-menu",
      title: "Main menu",
      isDefault: true,
      items: [
        {
          title: "Shop",
          type: "COLLECTION",
          url: "https://s.myshopify.com/collections/all",
          tags: [],
          items: [
            {
              title: "Tee",
              type: "PRODUCT",
              url: "https://s.myshopify.com/products/tee",
              tags: [],
              items: [],
            },
          ],
        },
        {
          title: "Blog post",
          type: "ARTICLE",
          url: "/blogs/news/hello",
          tags: [],
          items: [],
        },
        {
          title: "Ext",
          type: "HTTP",
          url: "https://example.com/pages/x",
          tags: [],
          items: [],
        },
      ].map(normalizeMenuItem),
    },
  ],
};

test("menu items keep type, title, url and resource handle, nested", () => {
  const [shop, post, ext] = content.menus[0].items;
  assert.equal(shop.type, "COLLECTION");
  assert.equal(shop.resourceHandle, "all");
  assert.equal(shop.url, "/collections/all");
  assert.equal(shop.items[0].resourceHandle, "tee");
  assert.equal(post.resourceHandle, "hello");
  assert.equal(post.resourceBlogHandle, "news");
  assert.equal(ext.resourceHandle, null); // external link stays untouched
  assert.equal(ext.url, "https://example.com/pages/x");
});

test("mixed export: JSON content + downloads, manifest has recreate fields", async () => {
  const planner = createPlanner();
  const items = [
    ...planner.contentItems(content),
    ...planner.productMediaItems([media("shirt", "a.jpg", 1)]),
  ];
  const parts = [];
  const result = await exportItems({
    items,
    maxPartBytes: 1e9,
    fetchFn: async () => new Response(new Uint8Array(100).fill(1)),
    onPart: async (p) => parts.push(p),
  });
  assert.equal(result.failed.length, 0);
  assert.equal(parts.length, 1);
  const zip = unzipSync(new Uint8Array(await parts[0].blob.arrayBuffer()));
  const manifest = JSON.parse(new TextDecoder().decode(zip["manifest.json"]));
  const byType = (t) => manifest.files.filter((f) => f.type === t);

  const article = byType("article").find((a) => a.handle === "hello");
  assert.equal(article.blogHandle, "news");
  assert.equal(article.bodyHtml, "<p>Hi</p>");
  assert.equal(article.author, "Ann");
  assert.deepEqual(article.tags, ["x", "y"]);
  assert.equal(article.isPublished, true);
  assert.equal(article.publishedAt, "2024-01-01T00:00:00Z");
  assert.equal(article.image.alt, "Hero");
  assert.ok(zip[article.image.path], "featured image bundled");
  assert.equal(
    byType("article").find((a) => a.handle === "draft").isPublished,
    false,
  );
  assert.equal(byType("page")[0].bodyHtml, "<h1>x</h1>");
  assert.equal(byType("menu")[0].items[0].items[0].title, "Tee");
  assert.equal(byType("blog")[0].handle, "news");
  assert.equal(byType("productMedia")[0].productHandle, "shirt");
  // every manifest path exists in the zip, and JSON files parse
  for (const f of manifest.files) assert.ok(zip[f.path], f.path);
  assert.equal(
    JSON.parse(new TextDecoder().decode(zip["content/pages/about.json"])).title,
    "About",
  );
});

test("empty content types produce no items", () => {
  assert.deepEqual(createPlanner().contentItems({}), []);
});

test("proxy allow-list only accepts https cdn.shopify.com", () => {
  assert.equal(
    isAllowedProxyUrl("https://cdn.shopify.com/s/files/a.png?v=1"),
    true,
  );
  for (const bad of [
    "http://cdn.shopify.com/a.png",
    "https://cdn.shopify.com.evil.com/a.png",
    "https://evil.com/cdn.shopify.com",
    "https://cdn.shopify.com@evil.com/a",
    "https://user:pw@cdn.shopify.com/a",
    "https://cdn.shopify.com:8443/a",
    "https://127.0.0.1/a",
    "https://169.254.169.254/latest/meta-data",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "not a url",
    "",
  ]) {
    assert.equal(isAllowedProxyUrl(bad), false, bad);
  }
});

test("downloader falls back to the proxy on a CORS-style TypeError and sticks to it", async () => {
  const calls = [];
  const dl = createDownloader(async (url) => {
    calls.push(url);
    if (!url.startsWith("/api/download-proxy"))
      throw new TypeError("Failed to fetch");
    return new Response("ok");
  });
  await dl("https://cdn.shopify.com/a.png");
  await dl("https://cdn.shopify.com/b.png");
  assert.equal(calls.length, 3); // direct, proxy, then proxy only
  assert.match(
    calls[1],
    /^\/api\/download-proxy\?url=https%3A%2F%2Fcdn\.shopify\.com%2Fa\.png$/,
  );
  // non-CDN hosts are never proxied
  const other = createDownloader(async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(other("https://example.com/a.png"), TypeError);
});

test("external videos are skipped, not failed; not-ready files explain why", async () => {
  const { splitDownloadable } = await import("../app/lib/exporter/plan.js");
  const files = [
    {
      id: "gid://shopify/ExternalVideo/1",
      kind: "ExternalVideo",
      url: null,
      embedUrl: "https://youtu.be/x",
    },
    {
      id: "gid://shopify/MediaImage/2",
      kind: "MediaImage",
      url: "https://cdn.shopify.com/a.jpg",
    },
    {
      id: "gid://shopify/MediaImage/3",
      kind: "MediaImage",
      url: null,
      status: "PROCESSING",
    },
    {
      id: "gid://shopify/GenericFile/4",
      kind: "GenericFile",
      url: null,
      status: "READY",
    },
  ];
  const { downloadable, skipped } = splitDownloadable(files);
  assert.equal(downloadable.length, 3);
  assert.deepEqual(skipped, [
    {
      name: "https://youtu.be/x",
      reason: "External video: nothing to download",
    },
  ]);
  const items = createPlanner().fileItems(downloadable);
  assert.match(items[1].noUrlReason, /not ready \(status processing\)/);
  assert.match(items[2].noUrlReason, /no download URL/);
  const failed = [];
  await exportItems({
    items: items.slice(1),
    maxPartBytes: 1e9,
    onPart: async () => {},
    fetchFn: async () => new Response("x"),
    onProgress: () => {},
  }).then((r) => failed.push(...r.failed));
  assert.match(failed[0].error, /not ready/);
});
