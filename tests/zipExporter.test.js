import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync } from "fflate";
import { exportFiles, collectFiles } from "../app/lib/exporter/zipExporter.js";
import { createNameRegistry, fileNameFrom } from "../app/lib/exporter/names.js";

const makeFiles = (n, size = 1000) =>
  Array.from({ length: n }, (_, i) => ({
    id: `gid://shopify/MediaImage/${i + 1}`,
    kind: "MediaImage",
    url: `https://cdn.shopify.com/s/files/img-${i + 1}.jpg?v=${i}`,
    alt: `alt ${i + 1}`,
    filename: `img-${i + 1}.jpg`,
    size,
    mimeType: "image/jpeg",
  }));

// Mock fetch: body of `size` bytes; supports failing URLs and tracking concurrency.
function mockFetch({
  size = 1000,
  failUrls = new Set(),
  flaky = new Map(),
  delay = 1,
} = {}) {
  const stats = { calls: 0, active: 0, maxActive: 0, byUrl: new Map() };
  const fn = async (url, { signal } = {}) => {
    stats.calls++;
    stats.byUrl.set(url, (stats.byUrl.get(url) ?? 0) + 1);
    stats.active++;
    stats.maxActive = Math.max(stats.maxActive, stats.active);
    try {
      await new Promise((r) => setTimeout(r, delay));
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const attempt = stats.byUrl.get(url);
      if (failUrls.has(url)) return new Response("nope", { status: 404 });
      if (attempt <= (flaky.get(url) ?? 0))
        return new Response("err", { status: 503 });
      return new Response(new Uint8Array(size).fill(7));
    } finally {
      stats.active--;
    }
  };
  return { fn, stats };
}

async function run(opts) {
  const parts = [];
  const progress = [];
  const result = await exportFiles({
    retryDelayMs: 1,
    ...opts,
    onPart: async (p) => parts.push(p),
    onProgress: (p) => {
      progress.push(p);
      opts.onProgress?.(p);
    },
  });
  return { result, parts, progress };
}

const readManifest = async (blob) => {
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  return {
    entries,
    manifest: JSON.parse(new TextDecoder().decode(entries["manifest.json"])),
  };
};

test("20 files fit in a single part with a manifest", async () => {
  const { fn } = mockFetch();
  const { result, parts } = await run({
    files: makeFiles(20),
    fetchFn: fn,
    maxPartBytes: 1e9,
  });
  assert.equal(result.status, "completed");
  assert.equal(parts.length, 1);
  assert.equal(result.done, 20);
  assert.equal(result.failed.length, 0);
  const { entries, manifest } = await readManifest(parts[0].blob);
  assert.equal(Object.keys(entries).length, 21);
  assert.equal(manifest.files.length, 20);
  assert.equal(manifest.files[0].alt, "alt 1");
  assert.equal(manifest.files[0].path, "files/img-1.jpg");
});

test("600 files split across parts, none lost, none over the limit", async () => {
  const { fn, stats } = mockFetch({ size: 1000 });
  const { result, parts, progress } = await run({
    files: makeFiles(600),
    fetchFn: fn,
    maxPartBytes: 100_000, // 100 files per part
  });
  assert.equal(result.status, "completed");
  assert.equal(parts.length, 6);
  assert.equal(result.done, 600);
  let seen = 0;
  for (const p of parts) {
    assert.ok(p.bytes <= 100_000, `part ${p.index} is ${p.bytes}`);
    seen += (await readManifest(p.blob)).manifest.files.length;
  }
  assert.equal(seen, 600);
  assert.ok(
    stats.maxActive <= 4 && stats.maxActive > 1,
    `concurrency ${stats.maxActive}`,
  );
  const last = progress.at(-1);
  assert.equal(last.done, 600);
  assert.equal(last.total, 600);
  assert.ok(progress.some((p) => p.part === 6));
});

test("a file larger than the limit gets its own part", async () => {
  const files = makeFiles(3, 5000);
  const { fn } = mockFetch({ size: 5000 });
  const { parts } = await run({ files, fetchFn: fn, maxPartBytes: 1000 });
  assert.equal(parts.length, 3);
});

test("failed downloads are retried twice, then listed", async () => {
  const files = makeFiles(5);
  const bad = files[2].url;
  const flakyUrl = files[3].url;
  const { fn, stats } = mockFetch({
    failUrls: new Set([bad]),
    flaky: new Map([[flakyUrl, 2]]),
  });
  const { result, parts } = await run({
    files,
    fetchFn: fn,
    maxPartBytes: 1e9,
  });
  assert.equal(stats.byUrl.get(bad), 3); // 1 try + 2 retries
  assert.equal(stats.byUrl.get(flakyUrl), 3); // succeeded on the last retry
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].url, bad);
  assert.match(result.failed[0].error, /404/);
  assert.equal(result.done, 5);
  assert.equal((await readManifest(parts[0].blob)).manifest.files.length, 4);
});

test("cancel stops mid-run and emits no partial part", async () => {
  const controller = new AbortController();
  const { fn, stats } = mockFetch({ delay: 5 });
  const { result, parts } = await run({
    files: makeFiles(500),
    fetchFn: fn,
    maxPartBytes: 50_000,
    signal: controller.signal,
    onProgress: (p) => p.done >= 60 && controller.abort(),
  });
  assert.equal(result.status, "cancelled");
  assert.ok(stats.calls < 500);
  assert.ok(parts.length >= 1 && parts.length < 10);
});

test("empty store resolves as empty without producing a ZIP", async () => {
  const { result, parts } = await run({ files: [], maxPartBytes: 1e9 });
  assert.equal(result.status, "empty");
  assert.equal(parts.length, 0);
});

test("name collisions get suffixes, CDN query strings are dropped", async () => {
  const files = [
    {
      id: "gid://x/1",
      url: "https://cdn.shopify.com/a/photo.jpg?v=1",
      filename: null,
    },
    {
      id: "gid://x/2",
      url: "https://cdn.shopify.com/b/photo.jpg?v=2",
      filename: null,
    },
    {
      id: "gid://x/3",
      url: "https://cdn.shopify.com/c/PHOTO.jpg",
      filename: null,
    },
  ].map((f) => ({ ...f, kind: "MediaImage", alt: "", size: 10 }));
  const { fn } = mockFetch({ size: 10 });
  const { parts } = await run({ files, fetchFn: fn, maxPartBytes: 1e9 });
  const { manifest } = await readManifest(parts[0].blob);
  assert.deepEqual(manifest.files.map((f) => f.path).sort(), [
    "files/PHOTO-3.jpg",
    "files/photo-2.jpg",
    "files/photo.jpg",
  ]);
});

test("keepOriginalNames=false uses ids and hides original names", async () => {
  const { fn } = mockFetch();
  const { parts } = await run({
    files: makeFiles(2),
    fetchFn: fn,
    maxPartBytes: 1e9,
    keepOriginalNames: false,
  });
  const { manifest } = await readManifest(parts[0].blob);
  assert.equal(manifest.files[0].path, "files/1.jpg");
  assert.equal(manifest.files[0].originalName, null);
});

test("name helpers", () => {
  assert.equal(
    fileNameFrom({ url: "https://cdn.x.com/a/b%20c.png?v=9&w=2" }),
    "b c.png",
  );
  assert.equal(
    fileNameFrom({ filename: "../../etc/pa:ss*wd" }),
    "_.._etc_pa_ss_wd",
  );
  assert.equal(fileNameFrom({ id: "gid://shopify/GenericFile/77" }), "file-77");
  const u = createNameRegistry();
  assert.deepEqual([u("a"), u("a"), u("a")], ["a", "a-2", "a-3"]);
});

test("collectFiles follows cursors and honours abort", async () => {
  const pages = [
    { files: [1, 2], hasNextPage: true, cursor: "c1" },
    { files: [3], hasNextPage: false, cursor: null },
  ];
  const seen = [];
  const all = await collectFiles(
    async (c) => (seen.push(c), pages[seen.length - 1]),
  );
  assert.deepEqual(all, [1, 2, 3]);
  assert.deepEqual(seen, [null, "c1"]);
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    collectFiles(async () => pages[0], { signal: ac.signal }),
    /Abort/,
  );
});
