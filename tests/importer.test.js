import test from "node:test";
import assert from "node:assert/strict";
import { createPlanner, normalizeMenuItem } from "../app/lib/exporter/plan.js";
import { exportItems } from "../app/lib/exporter/zipExporter.js";
import { createArchiveSet } from "../app/lib/importer/zipReader.js";
import { runImport } from "../app/lib/importer/importer.js";

const settings = {
  replaceExisting: false,
  importFiles: true,
  importProductMedia: true,
  importBlogPosts: true,
  importPages: true,
  importMenus: true,
};

const fileRec = (i) => ({
  id: `gid://shopify/MediaImage/${i}`,
  kind: "MediaImage",
  url: `https://cdn.shopify.com/f/img-${i}.jpg`,
  alt: `alt ${i}`,
  filename: `img-${i}.jpg`,
  size: 50,
  mimeType: "image/jpeg",
});
const mediaRec = (handle, i, position) => ({
  ...fileRec(1000 + i),
  productHandle: handle,
  position,
  filename: `${handle}-${i}.jpg`,
});
const content = {
  blogs: [
    {
      id: "b",
      handle: "news",
      title: "News",
      commentPolicy: "MODERATED",
      templateSuffix: null,
    },
  ],
  articles: [
    {
      id: "a",
      handle: "hello",
      title: "Hello",
      bodyHtml: "<p>x</p>",
      summary: "",
      author: "Ann",
      tags: ["t"],
      isPublished: true,
      publishedAt: "2024-01-01T00:00:00Z",
      blogHandle: "news",
      image: { url: "https://cdn.shopify.com/s/hero.png", altText: "Hero" },
    },
  ],
  pages: [
    {
      id: "p",
      handle: "about",
      title: "About",
      bodyHtml: "<p>a</p>",
      isPublished: true,
      publishedAt: null,
    },
  ],
  menus: [
    {
      id: "m",
      handle: "main-menu",
      title: "Main",
      isDefault: true,
      items: [
        {
          title: "About",
          type: "PAGE",
          url: "https://s.myshopify.com/pages/about",
          tags: [],
          items: [],
        },
      ].map(normalizeMenuItem),
    },
  ],
};

// Builds real ZIP parts with the real exporter so the importer is tested against its output.
async function makeArchives({ nFiles = 45, maxPartBytes = 1e9 } = {}) {
  const planner = createPlanner();
  const items = [
    ...planner.contentItems(content),
    ...planner.fileItems(
      Array.from({ length: nFiles }, (_, i) => fileRec(i + 1)),
    ),
    ...planner.productMediaItems([
      mediaRec("shirt", 1, 0),
      mediaRec("shirt", 2, 1),
      mediaRec("hat", 3, 0),
    ]),
  ];
  const parts = [];
  await exportItems({
    items,
    maxPartBytes,
    fetchFn: async () => new Response(new Uint8Array(50).fill(9)),
    onPart: async (p) => parts.push(p.blob),
  });
  return createArchiveSet(
    parts.map((b, i) => new File([b], `part-${i + 1}.zip`)),
  );
}

function fakeServer({
  failUpload = new Set(),
  existing = new Set(),
  flaky = 0,
  missing = new Set(),
  have = new Set(),
  cannotCreate = new Set(),
} = {}) {
  const calls = [];
  let failures = flaky;
  const api = async (intent, payload) => {
    if (failures-- > 0) throw new Error("HTTP 503");
    calls.push({ intent, payload });
    switch (intent) {
      case "stage":
        return {
          targets: payload.files.map((f) => ({
            url: "https://up",
            resourceUrl: `staged://${f.filename}`,
            parameters: [],
            filename: f.filename,
          })),
        };
      case "createFiles":
        return {
          results: payload.files.map((f) =>
            existing.has(f.filename) && !payload.replace
              ? {
                  status: "skipped",
                  error: "A file with this name already exists",
                }
              : { status: payload.replace ? "replaced" : "created" },
          ),
        };
      case "checkProductMedia":
        return {
          results: payload.items.map((p) => ({
            found: !missing.has(p.handle),
            present: p.filenames.map((f) => have.has(f)),
          })),
        };
      case "createProducts":
        return {
          results: payload.items.map((p) =>
            cannotCreate.has(p.handle)
              ? { status: "failed", error: "Handle is taken" }
              : { status: "created" },
          ),
        };
      case "attachProductMedia":
        return { results: payload.media.map(() => ({ status: "created" })) };
      default:
        return { results: payload.items.map(() => ({ status: "created" })) };
    }
  };
  const uploads = [];
  const upload = async (target, bytes, filename) => {
    if (failUpload.has(filename)) throw new Error("Upload failed (HTTP 500)");
    uploads.push(filename);
  };
  return { api, upload, calls, uploads };
}

test("imports everything in order, in batches of at most 20 uploads", async () => {
  const archives = await makeArchives();
  const s = fakeServer();
  const result = await runImport({
    archives,
    settings,
    api: s.api,
    upload: s.upload,
  });
  assert.equal(result.status, "done");
  assert.equal(result.errors.length, 0);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(result.summary).map(([k, v]) => [k, v.created]),
    ),
    { files: 45, productMedia: 3, blogs: 1, articles: 1, pages: 1, menus: 1 },
  );
  const stageSizes = s.calls
    .filter((c) => c.intent === "stage")
    .map((c) => c.payload.files.length);
  assert.ok(
    stageSizes.every((n) => n <= 20),
    stageSizes.join(),
  );
  const order = s.calls
    .map((c) => c.intent)
    .filter((v, i, a) => a.indexOf(v) === i);
  assert.deepEqual(order, [
    "stage",
    "createFiles",
    "checkProductMedia",
    "attachProductMedia",
    "blogs",
    "articles",
    "pages",
    "menus",
  ]);
});

test("product media is re-attached by handle in position order", async () => {
  const s = fakeServer();
  await runImport({
    archives: await makeArchives(),
    settings,
    api: s.api,
    upload: s.upload,
  });
  const attach = s.calls
    .filter((c) => c.intent === "attachProductMedia")
    .map((c) => c.payload);
  const shirt = attach.find((a) => a.handle === "shirt");
  assert.deepEqual(
    shirt.media.map((m) => m.filename),
    ["shirt-1.jpg", "shirt-2.jpg"],
  );
  assert.equal(shirt.media[0].mediaContentType, "IMAGE");
  assert.ok(attach.find((a) => a.handle === "hat"));
});

test("article payload carries the staged featured image and menu keeps resource handle", async () => {
  const s = fakeServer();
  await runImport({
    archives: await makeArchives(),
    settings,
    api: s.api,
    upload: s.upload,
  });
  const article = s.calls.find((c) => c.intent === "articles").payload.items[0];
  assert.equal(article.blogHandle, "news");
  assert.match(article.imageResourceUrl, /^staged:\/\//);
  assert.equal(article.imageFilename, "hello-hero.png");
  assert.equal(article.imageAlt, "Hero");
  const menu = s.calls.find((c) => c.intent === "menus").payload.items[0];
  assert.equal(menu.items[0].resourceHandle, "about");
});

test("replace setting is passed through; existing files are skipped when off", async () => {
  const off = fakeServer({ existing: new Set(["img-1.jpg", "img-2.jpg"]) });
  const r1 = await runImport({
    archives: await makeArchives(),
    settings,
    api: off.api,
    upload: off.upload,
  });
  assert.equal(r1.summary.files.skipped, 2);
  assert.equal(r1.summary.files.created, 43);
  assert.equal(r1.warnings.filter((w) => w.type === "files").length, 2);

  const on = fakeServer({ existing: new Set(["img-1.jpg"]) });
  const r2 = await runImport({
    archives: await makeArchives(),
    settings: { ...settings, replaceExisting: true },
    api: on.api,
    upload: on.upload,
  });
  assert.equal(r2.summary.files.replaced, 45);
  assert.ok(
    on.calls
      .filter((c) => c.intent === "createFiles")
      .every((c) => c.payload.replace === true),
  );
});

test("per-item errors are reported and do not stop the run", async () => {
  const s = fakeServer({ failUpload: new Set(["img-3.jpg", "img-30.jpg"]) });
  const r = await runImport({
    archives: await makeArchives(),
    settings,
    api: s.api,
    upload: s.upload,
  });
  assert.equal(r.summary.files.failed, 2);
  assert.equal(r.summary.files.created, 43);
  assert.deepEqual(r.errors.map((e) => e.name).sort(), [
    "files/img-3.jpg",
    "files/img-30.jpg",
  ]);
  assert.equal(r.summary.menus.created, 1);
});

test("transient API failures are retried", async () => {
  const s = fakeServer({ flaky: 2 });
  const r = await runImport({
    archives: await makeArchives({ nFiles: 3 }),
    settings,
    api: s.api,
    upload: s.upload,
  });
  assert.equal(r.errors.length, 0);
});

test("content type toggles are honoured", async () => {
  const s = fakeServer();
  const r = await runImport({
    archives: await makeArchives({ nFiles: 5 }),
    settings: {
      ...settings,
      importFiles: false,
      importProductMedia: false,
      importMenus: false,
      importPages: false,
    },
    api: s.api,
    upload: s.upload,
  });
  assert.deepEqual(
    [...new Set(s.calls.map((c) => c.intent))],
    ["blogs", "stage", "articles"],
  );
  assert.equal(r.summary.files.total, 0);
  assert.equal(r.summary.articles.created, 1);
});

test("splits across several ZIP parts and still imports all of them", async () => {
  const archives = await makeArchives({ nFiles: 60, maxPartBytes: 1000 });
  assert.ok(archives.count > 2);
  const s = fakeServer();
  const r = await runImport({
    archives,
    settings,
    api: s.api,
    upload: s.upload,
  });
  assert.equal(r.summary.files.created, 60);
  assert.equal(r.summary.articles.created, 1);
  assert.equal(r.errors.length, 0);
});

test("invalid ZIPs are reported, valid ones still import", async () => {
  const good = await makeArchives({ nFiles: 2 });
  const garbage = new File([new Uint8Array([1, 2, 3])], "bad.zip");
  const wrongApp = new File(["hello"], "notes.txt");
  const archives = createArchiveSet([garbage, wrongApp]);
  const s = fakeServer();
  const r = await runImport({
    archives,
    settings,
    api: s.api,
    upload: s.upload,
  });
  assert.equal(r.errors.length, 2);
  assert.ok(r.errors.every((e) => e.type === "archive"));
  assert.equal(s.calls.length, 0);
  assert.equal(good.count, 1);
});

test("cancel stops further batches", async () => {
  const controller = new AbortController();
  const s = fakeServer();
  const r = await runImport({
    archives: await makeArchives({ nFiles: 100 }),
    settings,
    api: s.api,
    upload: s.upload,
    signal: controller.signal,
    onProgress: (p) => p.done >= 20 && controller.abort(),
  });
  assert.equal(r.status, "cancelled");
  assert.ok(r.summary.files.created < 100);
  assert.equal(r.summary.menus.created, 0);
});

test("products that are missing or already have the image never trigger an upload", async () => {
  // shirt exists but already has shirt-1.jpg; hat doesn't exist at all
  const s = fakeServer({
    missing: new Set(["hat"]),
    have: new Set(["shirt-1.jpg"]),
  });
  const r = await runImport({
    archives: await makeArchives({ nFiles: 1 }),
    settings,
    api: s.api,
    upload: s.upload,
  });
  assert.equal(r.summary.productMedia.failed, 1); // hat-3.jpg
  assert.equal(r.summary.productMedia.skipped, 1); // shirt-1.jpg
  assert.equal(r.summary.productMedia.created, 1); // shirt-2.jpg
  assert.deepEqual(
    r.errors.map((e) => e.error),
    ["Product “hat” not found in this store; create it first"],
  );
  assert.ok(
    !s.uploads.includes("hat-3.jpg"),
    "no upload for a missing product",
  );
  assert.ok(
    !s.uploads.includes("shirt-1.jpg"),
    "no upload for an existing image",
  );
  assert.ok(s.uploads.includes("shirt-2.jpg"));
  const attach = s.calls.filter((c) => c.intent === "attachProductMedia");
  assert.deepEqual(
    attach.map((c) => c.payload.handle),
    ["shirt"],
  );
  assert.deepEqual(
    attach[0].payload.media.map((m) => m.filename),
    ["shirt-2.jpg"],
  );
});

test("replace on re-uploads images that are already on the product", async () => {
  const s = fakeServer({ have: new Set(["shirt-1.jpg"]) });
  const r = await runImport({
    archives: await makeArchives({ nFiles: 1 }),
    settings: { ...settings, replaceExisting: true },
    api: s.api,
    upload: s.upload,
  });
  assert.equal(r.summary.productMedia.skipped, 0);
  assert.ok(s.uploads.includes("shirt-1.jpg"));
});

test("createMissingProducts creates drafts for missing handles, then attaches media", async () => {
  const s = fakeServer({ missing: new Set(["hat"]) });
  const r = await runImport({
    archives: await makeArchives({ nFiles: 1 }),
    settings: { ...settings, createMissingProducts: true },
    api: s.api,
    upload: s.upload,
  });
  assert.equal(r.errors.length, 0);
  assert.equal(r.summary.productMedia.created, 3);
  const create = s.calls.find((c) => c.intent === "createProducts").payload
    .items;
  assert.deepEqual(create, [{ handle: "hat", title: "Hat" }]); // title derived from the handle
  assert.ok(
    r.warnings.some(
      (w) => w.name === "hat" && /created as a draft/.test(w.message),
    ),
  );
  // creation happens before any upload for that product
  const intents = s.calls.map((c) => c.intent);
  assert.ok(intents.indexOf("createProducts") < intents.lastIndexOf("stage"));
});

test("uses the exported product title when the manifest has one", async () => {
  const { createPlanner } = await import("../app/lib/exporter/plan.js");
  const { exportItems } = await import("../app/lib/exporter/zipExporter.js");
  const planner = createPlanner();
  const items = planner.productMediaItems([
    { ...mediaRec("hat", 3, 0), productTitle: "Fancy Hat™" },
  ]);
  const parts = [];
  await exportItems({
    items,
    maxPartBytes: 1e9,
    fetchFn: async () => new Response(new Uint8Array(5)),
    onPart: async (p) => parts.push(new File([p.blob], "p.zip")),
  });
  const s = fakeServer({ missing: new Set(["hat"]) });
  await runImport({
    archives: createArchiveSet(parts),
    settings: { ...settings, createMissingProducts: true },
    api: s.api,
    upload: s.upload,
  });
  assert.equal(
    s.calls.find((c) => c.intent === "createProducts").payload.items[0].title,
    "Fancy Hat™",
  );
});

test("a product that can't be created fails its media with the reason; others continue", async () => {
  const s = fakeServer({
    missing: new Set(["hat"]),
    cannotCreate: new Set(["hat"]),
  });
  const r = await runImport({
    archives: await makeArchives({ nFiles: 1 }),
    settings: { ...settings, createMissingProducts: true },
    api: s.api,
    upload: s.upload,
  });
  assert.equal(r.summary.productMedia.failed, 1);
  assert.equal(r.summary.productMedia.created, 2);
  assert.match(r.errors[0].error, /Could not create product: Handle is taken/);
  assert.ok(!s.uploads.includes("hat-3.jpg"));
});

test("without the option, missing products are still just reported", async () => {
  const s = fakeServer({ missing: new Set(["hat"]) });
  await runImport({
    archives: await makeArchives({ nFiles: 1 }),
    settings,
    api: s.api,
    upload: s.upload,
  });
  assert.ok(!s.calls.some((c) => c.intent === "createProducts"));
});
