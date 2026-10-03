/* global globalThis */
import test from "node:test";
import assert from "node:assert/strict";
import { uploadToTarget } from "../app/lib/importer/importer.js";
import {
  prepareArticleImages,
  upsertArticles,
} from "../app/services/import.server.js";

test("staged upload sends parameters in Shopify's order with `file` last", async () => {
  const parameters = [
    "key",
    "x-goog-signature",
    "Content-Type",
    "acl",
    "policy",
    "x-goog-date",
    "success_action_status",
  ].map((name, i) => ({ name, value: `v${i}` }));
  let sent;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent = { url, init };
    return new Response(null, { status: 201 });
  };
  try {
    await uploadToTarget(
      { url: "https://storage.example/upload", parameters },
      new Uint8Array([1, 2, 3]),
      "a.png",
      "image/png",
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  const keys = [...sent.init.body.keys()];
  assert.deepEqual(keys, [...parameters.map((p) => p.name), "file"]);
  assert.equal(sent.init.method, "POST");
  const file = sent.init.body.get("file");
  assert.equal(file.name, "a.png");
  assert.equal(file.type, "image/png");
  assert.equal(file.size, 3);
});

test("a failed staged upload is an error", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("denied", { status: 403 });
  try {
    await assert.rejects(
      uploadToTarget(
        { url: "https://x", parameters: [] },
        new Uint8Array(1),
        "a",
        "image/png",
      ),
      /403/,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

// Minimal fake Admin API routed by operation name.
function fakeAdmin({ statuses = ["READY"], fileCreateErrors = [] } = {}) {
  const log = [];
  let poll = 0;
  const reply = (data) => ({ json: async () => ({ data }) });
  return {
    log,
    graphql: async (query, { variables }) => {
      if (query.includes("CreateArticleImages")) {
        log.push({ op: "fileCreate", variables });
        return reply({
          fileCreate: {
            files: fileCreateErrors.length
              ? []
              : variables.files.map((_, i) => ({
                  id: `gid://shopify/MediaImage/${i + 1}`,
                  fileStatus: "UPLOADED",
                })),
            userErrors: fileCreateErrors,
          },
        });
      }
      if (query.includes("ArticleImageStatus")) {
        const status = statuses[Math.min(poll++, statuses.length - 1)];
        log.push({ op: "poll", status });
        return reply({
          nodes: variables.ids.map((id) => ({
            id,
            fileStatus: status,
            image:
              status === "READY"
                ? {
                    url: `https://cdn.shopify.com/s/files/${id.split("/").pop()}.png`,
                  }
                : null,
          })),
        });
      }
      if (query.includes("FindBlog"))
        return reply({ blogs: { nodes: [{ id: "gid://shopify/Blog/9" }] } });
      if (query.includes("FindArticle"))
        return reply({ articles: { nodes: [] } });
      if (query.includes("CreateArticle(")) {
        log.push({ op: "articleCreate", variables });
        return reply({
          articleCreate: { article: { id: "a" }, userErrors: [] },
        });
      }
      throw new Error(`unexpected query ${query.slice(0, 60)}`);
    },
  };
}

const article = (over = {}) => ({
  handle: "hello",
  title: "Hello",
  bodyHtml: "<p>x</p>",
  author: "Ann",
  tags: [],
  isPublished: true,
  publishedAt: "2024-01-01T00:00:00Z",
  blogHandle: "news",
  imageResourceUrl: "https://staged.example/hero",
  imageFilename: "hello-hero.png",
  imageAlt: "Hero",
  ...over,
});
const noSleep = { sleep: async () => {}, delayMs: 0 };

test("article image: fileCreate first, waits for READY, then uses the CDN url", async () => {
  const admin = fakeAdmin({ statuses: ["PROCESSING", "PROCESSING", "READY"] });
  const a = article();
  const out = await prepareArticleImages(admin, [a], noSleep);
  assert.equal(out.get(a).url, "https://cdn.shopify.com/s/files/1.png");
  const create = admin.log.find((l) => l.op === "fileCreate").variables
    .files[0];
  assert.equal(create.originalSource, "https://staged.example/hero");
  assert.equal(create.contentType, "IMAGE");
  assert.equal(create.duplicateResolutionMode, "APPEND_UUID");
  assert.deepEqual(
    admin.log.filter((l) => l.op === "poll").map((l) => l.status),
    ["PROCESSING", "PROCESSING", "READY"],
  );
});

test("article is created with the CDN url, never the staged url", async () => {
  const admin = fakeAdmin();
  const [result] = await upsertArticles(admin, [article()]);
  assert.equal(result.status, "created");
  assert.deepEqual(result.warnings, []);
  const input = admin.log.find((l) => l.op === "articleCreate").variables
    .article;
  assert.equal(input.image.url, "https://cdn.shopify.com/s/files/1.png");
  assert.equal(input.image.altText, "Hero");
});

test("image that never becomes ready: article still imports, with a warning", async () => {
  const admin = fakeAdmin({ statuses: ["PROCESSING"] });
  const out = await prepareArticleImages(admin, [article()], {
    ...noSleep,
    maxAttempts: 3,
  });
  assert.match([...out.values()][0].warning, /still processing/);
});

test("FAILED image and fileCreate errors become warnings, not article failures", async () => {
  const failed = await prepareArticleImages(
    fakeAdmin({ statuses: ["FAILED"] }),
    [article()],
    noSleep,
  );
  assert.match([...failed.values()][0].warning, /could not process/);
  const rejected = await prepareArticleImages(
    fakeAdmin({ fileCreateErrors: [{ message: "Bad image" }] }),
    [article()],
    noSleep,
  );
  assert.match([...rejected.values()][0].warning, /Bad image/);
});

test("articles without an image skip fileCreate entirely", async () => {
  const admin = fakeAdmin();
  const [result] = await upsertArticles(admin, [
    article({ imageResourceUrl: null }),
  ]);
  assert.equal(result.status, "created");
  assert.ok(!admin.log.some((l) => l.op === "fileCreate"));
  assert.equal(
    admin.log.find((l) => l.op === "articleCreate").variables.article.image,
    undefined,
  );
});

import { upsertMenus } from "../app/services/import.server.js";

test("menu with a store-specific link is retried without it and keeps the rest", async () => {
  const saved = [];
  let attempt = 0;
  const reply = (data) => ({ json: async () => ({ data }) });
  const admin = {
    graphql: async (query, { variables }) => {
      if (query.includes("ExistingMenus"))
        return reply({
          menus: {
            nodes: [
              {
                id: "gid://shopify/Menu/1",
                handle: "customer-account-main-menu",
              },
            ],
          },
        });
      if (query.includes("UpdateMenu")) {
        saved.push(variables.items);
        const failing = attempt++ === 0;
        return reply({
          menuUpdate: {
            menu: { id: "m" },
            userErrors: failing
              ? [
                  {
                    message:
                      'Couldn\'t create link "Orders", customer_account_page not found',
                  },
                ]
              : [],
          },
        });
      }
      throw new Error("unexpected");
    },
  };
  const menu = {
    handle: "customer-account-main-menu",
    title: "Customer account menu",
    items: [
      {
        title: "Orders",
        type: "CUSTOMER_ACCOUNT_PAGE",
        url: "/account/orders",
        sourceResourceId: null,
        tags: [],
        items: [],
      },
      {
        title: "Help",
        type: "HTTP",
        url: "https://example.com/help",
        tags: [],
        items: [],
      },
    ],
  };
  const [result] = await upsertMenus(admin, [menu]);
  assert.equal(result.status, "updated");
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Orders.*skipped/);
  assert.deepEqual(
    saved.at(-1).map((i) => i.title),
    ["Help"],
  );
});
