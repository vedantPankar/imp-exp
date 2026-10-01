import { unzipSync } from "fflate";

const MAX_ARCHIVE_BYTES = 1_500_000_000; // a Uint8Array copy of the file must fit in memory
const decoder = new TextDecoder();

/**
 * Opens ZIPs produced by this app. Only the manifest is read up front; file contents are
 * inflated on demand, one batch at a time, so a part is never fully decompressed in memory.
 * Only one archive's raw bytes are kept at once.
 */
export function createArchiveSet(files) {
  let cached = { index: -1, data: null };

  async function load(index) {
    if (cached.index !== index) {
      cached = { index: -1, data: null }; // release the previous archive first
      cached = {
        index,
        data: new Uint8Array(await files[index].arrayBuffer()),
      };
    }
    return cached.data;
  }

  return {
    count: files.length,
    name: (index) => files[index].name,

    async readManifest(index) {
      if (files[index].size > MAX_ARCHIVE_BYTES) {
        throw new Error(
          "File is too large to import in the browser (max ~1.5 GB per ZIP)",
        );
      }
      const data = await load(index);
      let found;
      try {
        found = unzipSync(data, { filter: (f) => f.name === "manifest.json" });
      } catch {
        throw new Error("Not a valid ZIP file");
      }
      if (!found["manifest.json"])
        throw new Error(
          "manifest.json is missing — not an export from this app",
        );
      let manifest;
      try {
        manifest = JSON.parse(decoder.decode(found["manifest.json"]));
      } catch {
        throw new Error("manifest.json is not valid JSON");
      }
      if (manifest.app !== "imp-exp" || !Array.isArray(manifest.files)) {
        throw new Error("This ZIP wasn't created by this app");
      }
      return manifest;
    },

    /** Returns { path: Uint8Array } for the requested paths (missing ones are absent). */
    async readEntries(index, paths) {
      const wanted = new Set(paths);
      return unzipSync(await load(index), {
        filter: (f) => wanted.has(f.name),
      });
    },
  };
}
