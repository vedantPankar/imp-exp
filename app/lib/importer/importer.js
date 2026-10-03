const TYPES = ["files", "productMedia", "blogs", "articles", "pages", "menus"];
const UPLOAD_BATCH = 20; // staged targets + uploads per round
const UPLOAD_CONCURRENCY = 4;
const CONTENT_BATCH = 10;
const CHECK_BATCH = 10; // products per pre-check request

const MIME_BY_EXT = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  pdf: "application/pdf",
  glb: "model/gltf-binary",
  usdz: "model/vnd.usdz+zip",
  json: "application/json",
  txt: "text/plain",
  csv: "text/csv",
  zip: "application/zip",
};

// "the-complete-snowboard" -> "The Complete Snowboard" (used when the export has no title)
const titleFromHandle = (handle) =>
  handle.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const baseName = (path) => path.split("/").pop();
const mimeFor = (entry) =>
  entry.mimeType ||
  MIME_BY_EXT[baseName(entry.path).split(".").pop().toLowerCase()] ||
  "application/octet-stream";

// Shopify wants different resource/content types per media kind.
function mediaKind(entry) {
  const mime = mimeFor(entry);
  if (entry.kind === "MediaImage" || mime.startsWith("image/")) return "IMAGE";
  if (entry.kind === "Video" || mime.startsWith("video/")) return "VIDEO";
  if (entry.kind === "Model3d" || mime.startsWith("model/")) return "MODEL_3D";
  return "FILE";
}

/** Plain-DOM multipart POST to a staged upload target. Parameters must precede the file. */
export async function uploadToTarget(
  target,
  bytes,
  filename,
  mimeType,
  signal,
) {
  const form = new FormData();
  for (const { name, value } of target.parameters) form.append(name, value);
  form.append("file", new Blob([bytes], { type: mimeType }), filename);
  const response = await fetch(target.url, {
    method: "POST",
    body: form,
    signal,
  });
  if (!response.ok) throw new Error(`Upload failed (HTTP ${response.status})`);
}

const newCounts = () => ({
  total: 0,
  created: 0,
  updated: 0,
  replaced: 0,
  skipped: 0,
  failed: 0,
});

/**
 * Imports archives created by this app.
 *
 * `api(intent, payload)` calls the server (/api/import) and returns its JSON.
 * Work runs in order: files, product media, blogs, articles, pages, menus (menus last since
 * they link to the other resources). Item failures are collected, never thrown.
 */
export async function runImport({
  archives,
  settings,
  api,
  upload = uploadToTarget,
  signal,
  onProgress,
}) {
  const summary = Object.fromEntries(TYPES.map((t) => [t, newCounts()]));
  const errors = [];
  const warnings = [];
  const state = { phase: "reading", done: 0, total: 0, current: "" };
  const emit = () =>
    onProgress?.({ ...state, summary, errorCount: errors.length });
  const cancelled = () => signal?.aborted;

  // --- read manifests ---
  const items = Object.fromEntries(TYPES.map((t) => [t, []]));
  for (let i = 0; i < archives.count; i++) {
    let manifest;
    try {
      manifest = await archives.readManifest(i);
    } catch (error) {
      errors.push({
        type: "archive",
        name: archives.name(i),
        error: error.message,
      });
      continue;
    }
    for (const entry of manifest.files) {
      const item = { ...entry, archive: i };
      if (entry.type === "file") items.files.push(item);
      else if (entry.type === "productMedia") items.productMedia.push(item);
      else if (entry.type === "blog") items.blogs.push(item);
      else if (entry.type === "article") items.articles.push(item);
      else if (entry.type === "page") items.pages.push(item);
      else if (entry.type === "menu") items.menus.push(item);
    }
  }

  const enabled = {
    files: settings.importFiles,
    productMedia: settings.importProductMedia,
    blogs: settings.importBlogPosts,
    articles: settings.importBlogPosts,
    pages: settings.importPages,
    menus: settings.importMenus,
  };
  for (const t of TYPES) {
    if (!enabled[t]) items[t] = [];
    summary[t].total = items[t].length;
    state.total += items[t].length;
  }
  state.phase = "importing";
  emit();

  const record = (type, name, result) => {
    const status = result.status in summary[type] ? result.status : "failed";
    summary[type][status]++;
    if (status === "failed")
      errors.push({ type, name, error: result.error ?? "Unknown error" });
    if (status === "skipped" && result.error)
      warnings.push({ type, name, message: result.error });
    for (const w of result.warnings ?? [])
      warnings.push({ type, name, message: w });
    state.done++;
    emit();
  };
  const failAll = (type, list, error) =>
    list.forEach((it) =>
      record(type, it.path ?? it.handle, { status: "failed", error }),
    );

  // Server call with retries for transient failures (rate limit, 5xx, network).
  const call = async (intent, payload) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await api(intent, payload, signal);
        if (res.error)
          throw Object.assign(new Error(res.error), {
            retriable: res.retriable,
          });
        return res;
      } catch (error) {
        if (cancelled() || attempt >= 2 || error.retriable === false)
          throw error;
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      }
    }
  };

  // Reads + stages + uploads a batch of entries; returns [{ entry, resourceUrl } | { entry, error }].
  async function uploadEntries(batch, resourceOf) {
    const outcome = batch.map((entry) => ({ entry }));
    const byArchive = new Map();
    for (const o of outcome) {
      if (!byArchive.has(o.entry.archive)) byArchive.set(o.entry.archive, []);
      byArchive.get(o.entry.archive).push(o);
    }
    const bytesOf = new Map();
    for (const [archive, list] of byArchive) {
      const read = await archives.readEntries(
        archive,
        list.map((o) => o.entry.path),
      );
      for (const o of list) {
        if (read[o.entry.path]) bytesOf.set(o, read[o.entry.path]);
        else o.error = "File is missing from the ZIP";
      }
    }
    const ready = outcome.filter((o) => !o.error);
    if (ready.length === 0) return outcome;

    let targets;
    try {
      ({ targets } = await call("stage", {
        files: ready.map((o) => ({
          filename: o.entry.originalName || baseName(o.entry.path),
          mimeType: mimeFor(o.entry),
          fileSize: bytesOf.get(o).length,
          resource: resourceOf(o.entry),
        })),
      }));
    } catch (error) {
      ready.forEach(
        (o) => (o.error = `Could not prepare upload: ${error.message}`),
      );
      return outcome;
    }

    let next = 0;
    const worker = async () => {
      while (next < ready.length && !cancelled()) {
        const i = next++;
        const o = ready[i];
        try {
          await upload(
            targets[i],
            bytesOf.get(o),
            o.entry.originalName || baseName(o.entry.path),
            mimeFor(o.entry),
            signal,
          );
          o.resourceUrl = targets[i].resourceUrl;
        } catch (error) {
          o.error = error.message;
        }
        bytesOf.delete(o); // free the content as soon as it's uploaded
      }
    };
    await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));
    return outcome;
  }

  const chunks = (list, n) =>
    Array.from({ length: Math.ceil(list.length / n) }, (_, i) =>
      list.slice(i * n, i * n + n),
    );
  // Keep batches within one archive so each ZIP is read once per batch.
  const byArchiveOrder = (list) =>
    [...list].sort((a, b) => a.archive - b.archive);

  // --- 1. files ---
  state.current = "Files";
  for (const batch of chunks(byArchiveOrder(items.files), UPLOAD_BATCH)) {
    if (cancelled()) break;
    const up = await uploadEntries(batch, mediaKind);
    const ok = up.filter((o) => !o.error);
    up.filter((o) => o.error).forEach((o) =>
      record("files", o.entry.path, { status: "failed", error: o.error }),
    );
    if (ok.length === 0) continue;
    try {
      const { results } = await call("createFiles", {
        replace: settings.replaceExisting,
        files: ok.map((o) => ({
          resourceUrl: o.resourceUrl,
          filename: o.entry.originalName || baseName(o.entry.path),
          alt: o.entry.alt,
          contentType: mediaKind(o.entry),
        })),
      });
      ok.forEach((o, i) => record("files", o.entry.path, results[i]));
    } catch (error) {
      failAll(
        "files",
        ok.map((o) => o.entry),
        error.message,
      );
    }
  }

  // --- 2. product media, re-attached by product handle ---
  state.current = "Product media";
  const sortedMedia = [...items.productMedia].sort(
    (a, b) => a.archive - b.archive || (a.position ?? 0) - (b.position ?? 0),
  );
  const nameOf = (entry) => entry.originalName || baseName(entry.path);

  // Check products first so nothing is uploaded for products that don't exist or
  // already have the image.
  const byProduct = new Map();
  for (const entry of sortedMedia) {
    if (!byProduct.has(entry.productHandle))
      byProduct.set(entry.productHandle, []);
    byProduct.get(entry.productHandle).push(entry);
  }
  const pending = [];
  for (const group of chunks([...byProduct.entries()], CHECK_BATCH)) {
    if (cancelled()) break;
    let results;
    try {
      ({ results } = await call("checkProductMedia", {
        items: group.map(([handle, entries]) => ({
          handle,
          filenames: entries.map(nameOf),
        })),
      }));
    } catch (error) {
      group.forEach(([, entries]) =>
        failAll("productMedia", entries, error.message),
      );
      continue;
    }
    // Optionally recreate missing products as drafts so their media can be attached.
    if (settings.createMissingProducts) {
      const missing = group.filter(([, ,], g) => results[g].found === false);
      if (missing.length) {
        try {
          const created = await call("createProducts", {
            items: missing.map(([handle, entries]) => ({
              handle,
              title:
                entries.find((e) => e.productTitle)?.productTitle ??
                titleFromHandle(handle),
            })),
          });
          missing.forEach(([handle, entries], m) => {
            const outcome = created.results[m];
            const g = group.findIndex(([h]) => h === handle);
            if (outcome.status === "created") {
              results[g] = { found: true, present: entries.map(() => false) };
              warnings.push({
                type: "productMedia",
                name: handle,
                message:
                  "Product did not exist; created as a draft (title and handle only)",
              });
            } else {
              results[g] = {
                error: `Could not create product: ${outcome.error}`,
              };
            }
          });
        } catch (error) {
          missing.forEach(([handle]) => {
            results[group.findIndex(([h]) => h === handle)] = {
              error: `Could not create product: ${error.message}`,
            };
          });
        }
      }
    }
    group.forEach(([handle, entries], g) => {
      const r = results[g];
      entries.forEach((entry, i) => {
        if (r.error) {
          record("productMedia", entry.path, {
            status: "failed",
            error: r.error,
          });
        } else if (!r.found) {
          record("productMedia", entry.path, {
            status: "failed",
            error: `Product “${handle}” not found in this store; create it first`,
          });
        } else if (r.present[i] && !settings.replaceExisting) {
          record("productMedia", entry.path, {
            status: "skipped",
            error: "Already on this product",
          });
        } else {
          pending.push(entry);
        }
      });
    });
  }

  for (const batch of chunks(pending, UPLOAD_BATCH)) {
    if (cancelled()) break;
    const up = await uploadEntries(batch, mediaKind);
    up.filter((o) => o.error).forEach((o) =>
      record("productMedia", o.entry.path, {
        status: "failed",
        error: o.error,
      }),
    );
    const groups = new Map();
    for (const o of up.filter((x) => !x.error)) {
      const handle = o.entry.productHandle;
      if (!groups.has(handle)) groups.set(handle, []);
      groups.get(handle).push(o);
    }
    for (const [handle, list] of groups) {
      if (cancelled()) break;
      try {
        const { results } = await call("attachProductMedia", {
          handle,
          replace: settings.replaceExisting,
          media: list.map((o) => ({
            resourceUrl: o.resourceUrl,
            alt: o.entry.alt,
            filename: o.entry.originalName || baseName(o.entry.path),
            mediaContentType:
              mediaKind(o.entry) === "FILE" ? "IMAGE" : mediaKind(o.entry),
          })),
        });
        list.forEach((o, i) =>
          record("productMedia", o.entry.path, results[i]),
        );
      } catch (error) {
        failAll(
          "productMedia",
          list.map((o) => o.entry),
          error.message,
        );
      }
    }
  }

  // --- 3-5. blogs, articles, pages (JSON content) ---
  const contentBatches = async (type, label, intent, prepare) => {
    state.current = label;
    for (const batch of chunks(byArchiveOrder(items[type]), CONTENT_BATCH)) {
      if (cancelled()) break;
      let payload;
      try {
        payload = await prepare(batch);
      } catch (error) {
        failAll(
          type,
          batch.map((b) => ({ handle: b.handle })),
          error.message,
        );
        continue;
      }
      try {
        const { results } = await call(intent, { items: payload });
        batch.forEach((b, i) => record(type, b.handle, results[i]));
      } catch (error) {
        failAll(
          type,
          batch.map((b) => ({ handle: b.handle })),
          error.message,
        );
      }
    }
  };
  const passthrough = async (batch) => batch;

  await contentBatches("blogs", "Blogs", "blogs", passthrough);

  await contentBatches("articles", "Articles", "articles", async (batch) => {
    // Featured images are uploaded first; the staged resource URL is used as the image source.
    const withImage = batch.filter((a) => a.image?.path);
    const up = withImage.length
      ? await uploadEntries(
          withImage.map((a) => ({
            path: a.image.path,
            archive: a.archive,
            originalName: null,
            alt: a.image.alt,
          })),
          mediaKind,
        )
      : [];
    const urlByArticle = new Map();
    withImage.forEach((a, i) => {
      if (up[i].resourceUrl) urlByArticle.set(a, up[i].resourceUrl);
      else
        warnings.push({
          type: "articles",
          name: a.handle,
          message: `Featured image not imported: ${up[i].error}`,
        });
    });
    return batch.map((a) => ({
      ...a,
      imageResourceUrl: urlByArticle.get(a) ?? null,
      imageFilename: a.image?.path ? baseName(a.image.path) : null,
      imageAlt: a.image?.alt ?? "",
    }));
  });

  await contentBatches("pages", "Pages", "pages", passthrough);
  await contentBatches("menus", "Menus", "menus", passthrough);

  state.phase = cancelled() ? "cancelled" : "done";
  emit();
  return { status: state.phase, summary, errors, warnings };
}
