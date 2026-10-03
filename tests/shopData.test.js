import test from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { deleteShopData } from "../app/services/shopData.server.js";

test("shop/redact removes all data for that shop and leaves other shops alone", async () => {
  const db = new PrismaClient();
  const shop = `test-redact-${Date.now()}.myshopify.com`;
  const other = `test-keep-${Date.now()}.myshopify.com`;
  try {
    for (const s of [shop, other]) {
      await db.exportSettings.create({ data: { shop: s } });
      await db.importSettings.create({ data: { shop: s } });
      await db.exportRun.create({
        data: { shop: s, type: "files", itemCount: 3 },
      });
      await db.session.create({
        data: { id: `sess-${s}`, shop: s, state: "x", accessToken: "t" },
      });
    }
    const deleted = await deleteShopData(db, shop);
    assert.deepEqual(deleted, {
      exportSettings: 1,
      importSettings: 1,
      exportRuns: 1,
      sessions: 1,
    });
    assert.equal(await db.exportSettings.count({ where: { shop } }), 0);
    assert.equal(await db.session.count({ where: { shop } }), 0);
    assert.equal(await db.exportRun.count({ where: { shop: other } }), 1);
    // idempotent: webhooks can be delivered more than once
    assert.deepEqual(await deleteShopData(db, shop), {
      exportSettings: 0,
      importSettings: 0,
      exportRuns: 0,
      sessions: 0,
    });
  } finally {
    await deleteShopData(db, other);
    await deleteShopData(db, shop);
    await db.$disconnect();
  }
});
