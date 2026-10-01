import db from "../db.server";

export const EXPORT_BOOLEANS = [
  "includeFiles",
  "includeProductMedia",
  "includeBlogPosts",
  "includePages",
  "includeMenus",
  "keepOriginalNames",
];

export async function getExportSettings(shop) {
  const row = await db.exportSettings.findUnique({ where: { shop } });
  return row ?? (await db.exportSettings.create({ data: { shop } }));
}

export async function saveExportSettings(shop, form) {
  const data = Object.fromEntries(
    EXPORT_BOOLEANS.map((key) => [key, form.get(key) === "true"]),
  );
  const size = Math.round(Number(form.get("maxPartSizeMb")));
  // Clamp to a sane range so a typo can't produce a 0-byte or multi-TB part
  data.maxPartSizeMb = Number.isFinite(size)
    ? Math.min(Math.max(size, 50), 4000)
    : 500;
  return db.exportSettings.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });
}

export async function getLastRuns(shop) {
  const rows = await db.exportRun.findMany({ where: { shop } });
  return Object.fromEntries(
    rows.map((r) => [r.type, { lastRunAt: r.lastRunAt.toISOString() }]),
  );
}

// Called by the export flow (Phase 2+) when a run of `type` finishes.
export async function recordRun(shop, type, itemCount, totalBytes = 0) {
  const data = {
    itemCount,
    // eslint-disable-next-line no-undef
    totalBytes: BigInt(totalBytes),
    lastRunAt: new Date(),
  };
  return db.exportRun.upsert({
    where: { shop_type: { shop, type } },
    create: { shop, type, ...data },
    update: data,
  });
}
