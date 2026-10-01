// Derives a safe, ZIP-friendly file name from the API filename or, failing that, the URL path.
// CDN URLs carry query strings (?v=123) that must not end up in the name.
export function fileNameFrom({ filename, url, id }) {
  let name = filename;
  if (!name && url) {
    try {
      name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
    } catch {
      name = "";
    }
  }
  name = sanitize(name || "");
  if (!name)
    name = `file-${
      String(id ?? "")
        .split("/")
        .pop() || "unnamed"
    }`;
  return name;
}

function sanitize(name) {
  return (
    name
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\\/:*?"<>|]/g, "_")
      .replace(/^\.+/, "")
      .trim()
      .slice(0, 180)
  );
}

// Hands out unique names (case-insensitive, as ZIPs get extracted on Windows/macOS):
// "a.jpg" -> "a.jpg", "a-2.jpg", "a-3.jpg"
export function createNameRegistry() {
  const used = new Set();
  return (name) => {
    const dot = name.lastIndexOf(".");
    const [base, ext] =
      dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) {
      candidate = `${base}-${n}${ext}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  };
}
