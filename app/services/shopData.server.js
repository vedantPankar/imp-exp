// Everything this app stores about a shop. Used by the shop/redact webhook.
// `db` is injected so this can be tested without the app's Prisma singleton.
export async function deleteShopData(db, shop) {
  const [settings, importSettings, runs, sessions] = await db.$transaction([
    db.exportSettings.deleteMany({ where: { shop } }),
    db.importSettings.deleteMany({ where: { shop } }),
    db.exportRun.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
  ]);
  return {
    exportSettings: settings.count,
    importSettings: importSettings.count,
    exportRuns: runs.count,
    sessions: sessions.count,
  };
}
