import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { createNameRegistry, fileNameFrom } from "./names.js";

const encoder = new TextEncoder();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pages through `fetchPage(cursor)` -> { files, hasNextPage, cursor } and returns all file
 * records. Only metadata is held in memory (a few hundred bytes per file), never content.
 */
export async function collectFiles(fetchPage, { signal, onProgress } = {}) {
  const files = [];
  let cursor = null;
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const page = await fetchPage(cursor);
    files.push(...page.files);
    onProgress?.({ phase: "listing", listed: files.length });
    if (!page.hasNextPage) return files;
    cursor = page.cursor;
  }
}

// Downloads one URL fully into memory. Buffered (rather than streamed straight into the
// ZIP) so a failed attempt can be retried without leaving a corrupt entry in the archive.
async function download(fetchFn, url, signal) {
  const response = await fetchFn(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const chunks = [];
  let bytes = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    bytes += value.length;
  }
  return { chunks, bytes };
}

async function downloadWithRetry(
  fetchFn,
  url,
  { signal, retries, retryDelayMs },
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await download(fetchFn, url, signal);
    } catch (error) {
      if (signal?.aborted || attempt >= retries) throw error;
      await sleep(retryDelayMs * 2 ** attempt);
    }
  }
}

// Builds one ZIP part in memory; the finished Blob is handed to `onPart` and released.
class PartWriter {
  constructor() {
    this.chunks = [];
    this.entries = [];
    this.bytes = 0;
    this.error = null;
    this.zip = new Zip((err, chunk) => {
      if (err) this.error = err;
      else this.chunks.push(chunk);
    });
  }

  addFile(entry, chunks, bytes) {
    // Media is already compressed, so store it without deflate.
    const file = new ZipPassThrough(entry.path);
    this.zip.add(file);
    for (const chunk of chunks) file.push(chunk);
    file.push(new Uint8Array(0), true);
    this.entries.push({ ...entry, size: bytes });
    this.bytes += bytes;
  }

  finish(manifest) {
    const file = new ZipDeflate("manifest.json", { level: 6 });
    this.zip.add(file);
    file.push(
      encoder.encode(
        JSON.stringify({ ...manifest, files: this.entries }, null, 2),
      ),
      true,
    );
    this.zip.end();
    if (this.error) throw this.error;
    return new Blob(this.chunks, { type: "application/zip" });
  }
}

/**
 * Downloads every file and packs them into one or more ZIP parts.
 *
 * Parts are closed once adding the next file would exceed `maxPartBytes` (a single file larger
 * than the limit gets a part of its own). Files with an unknown size count as 0 until their real
 * size is known, so a part can overshoot by at most `concurrency` such files.
 *
 * Resolves with { status: "completed" | "cancelled" | "empty", parts, done, failed, bytes }.
 * Individual file failures never reject; they are returned in `failed`.
 */
export async function exportFiles({
  files,
  fetchFn = (...args) => fetch(...args),
  maxPartBytes,
  keepOriginalNames = true,
  concurrency = 4,
  retries = 2,
  retryDelayMs = 500,
  signal,
  onProgress,
  onPart,
  manifestInfo = {},
}) {
  const total = files.length;
  const unique = createNameRegistry();
  const queue = files.map((file) => {
    const original = fileNameFrom(file);
    const generated = `${
      String(file.id ?? "")
        .split("/")
        .pop() || "file"
    }${extOf(original)}`;
    return {
      file,
      path: `files/${unique(keepOriginalNames ? original : generated)}`,
      originalName: keepOriginalNames ? original : null,
    };
  });

  const state = { total, done: 0, bytes: 0, part: 1, parts: 0 };
  const failed = [];
  const emit = (phase = "downloading") =>
    onProgress?.({ phase, ...state, failed: failed.length });

  if (total === 0)
    return { status: "empty", parts: 0, done: 0, failed, bytes: 0 };
  emit();

  let next = 0;
  while (next < queue.length && !signal?.aborted) {
    const part = new PartWriter();
    const inflight = new Set();
    let reserved = 0; // estimated bytes of downloads still running for this part

    const runOne = async (item, estimate) => {
      const { file } = item;
      try {
        if (!file.url) throw new Error("No download URL (file not ready)");
        const { chunks, bytes } = await downloadWithRetry(fetchFn, file.url, {
          signal,
          retries,
          retryDelayMs,
        });
        part.addFile(
          {
            type: "file",
            kind: file.kind,
            path: item.path,
            originalName: item.originalName,
            alt: file.alt ?? "",
            mimeType: file.mimeType ?? null,
            sourceId: file.id,
            productHandle: null,
          },
          chunks,
          bytes,
        );
        state.bytes += bytes;
      } catch (error) {
        if (signal?.aborted) return;
        failed.push({ name: item.path, url: file.url, error: error.message });
      } finally {
        reserved -= estimate;
        if (!signal?.aborted) {
          state.done++;
          emit();
        }
      }
    };

    for (;;) {
      while (
        next < queue.length &&
        inflight.size < concurrency &&
        !signal?.aborted
      ) {
        const item = queue[next];
        const estimate = item.file.size ?? 0;
        const partHasWork = part.entries.length > 0 || inflight.size > 0;
        if (partHasWork && part.bytes + reserved + estimate > maxPartBytes)
          break;
        next++;
        reserved += estimate;
        const task = runOne(item, estimate).finally(() =>
          inflight.delete(task),
        );
        inflight.add(task);
      }
      if (inflight.size === 0) break;
      await Promise.race(inflight);
    }

    if (signal?.aborted) break;
    if (part.entries.length > 0) {
      emit("finalizing");
      const blob = part.finish({
        ...manifestInfo,
        app: "imp-exp",
        version: 1,
        part: state.part,
        createdAt: new Date().toISOString(),
      });
      state.parts++;
      await onPart({
        index: state.part,
        blob,
        fileCount: part.entries.length,
        bytes: part.bytes,
      });
      state.part++;
    }
  }

  const status = signal?.aborted ? "cancelled" : "completed";
  emit(status);
  return {
    status,
    parts: state.parts,
    done: state.done,
    failed,
    bytes: state.bytes,
  };
}

function extOf(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}
