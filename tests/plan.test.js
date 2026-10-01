import test from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import {
  assertImportAllowed,
  clearPlanCache,
  getPlan,
  PRO_PLAN,
} from "../app/services/plan.server.js";
import { deleteShopData } from "../app/services/shopData.server.js";
import { runImport } from "../app/lib/importer/importer.js";

const fakeBilling = (hasActivePayment) => {
  const calls = [];
  return {
    calls,
    check: async (opts) => {
      calls.push(opts);
      return {
        hasActivePayment,
        appSubscriptions: hasActivePayment
          ? [{ id: "gid://shopify/AppSubscription/1" }]
          : [],
      };
    },
  };
};

test("Free plan is blocked from importing with a 402", async () => {
  clearPlanCache();
  const billing = fakeBilling(false);
  let thrown;
  try {
    await assertImportAllowed(billing, "free.myshopify.com");
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof Response);
  assert.equal(thrown.status, 402);
  assert.equal((await thrown.json()).code, "PLAN_REQUIRED");
  assert.deepEqual(billing.calls[0].plans, [PRO_PLAN]);
});

test("Pro plan is allowed and cached; Free is never cached", async () => {
  clearPlanCache();
  const pro = fakeBilling(true);
  await assertImportAllowed(pro, "pro.myshopify.com");
  await assertImportAllowed(pro, "pro.myshopify.com");
  assert.equal(pro.calls.length, 1);
  assert.equal(
    (await getPlan(pro, "pro.myshopify.com")).subscriptionId,
    "gid://shopify/AppSubscription/1",
  );

  const free = fakeBilling(false);
  await getPlan(free, "new.myshopify.com");
  await getPlan(free, "new.myshopify.com");
  assert.equal(free.calls.length, 2); // so a just-approved upgrade shows up immediately
});

test("cache expires after its TTL and can be cleared", async () => {
  clearPlanCache();
  const pro = fakeBilling(true);
  const t0 = Date.now();
  await getPlan(pro, "s.myshopify.com", t0);
  await getPlan(pro, "s.myshopify.com", t0 + 30_000);
  assert.equal(pro.calls.length, 1);
  await getPlan(pro, "s.myshopify.com", t0 + 61_000);
  assert.equal(pro.calls.length, 2);
  clearPlanCache("s.myshopify.com");
  await getPlan(pro, "s.myshopify.com", t0 + 62_000);
  assert.equal(pro.calls.length, 3);
});

test("a 402 from the server stops the whole import instead of failing every batch", async () => {
  const { createPlanner } = await import("../app/lib/exporter/plan.js");
  const { exportItems } = await import("../app/lib/exporter/zipExporter.js");
  const { createArchiveSet } = await import("../app/lib/importer/zipReader.js");
  const planner = createPlanner();
  const files = Array.from({ length: 60 }, (_, i) => ({
    id: `gid://x/${i}`,
    kind: "MediaImage",
    url: `https://cdn.shopify.com/${i}.jpg`,
    filename: `${i}.jpg`,
    size: 10,
    mimeType: "image/jpeg",
  }));
  const parts = [];
  await exportItems({
    items: planner.fileItems(files),
    maxPartBytes: 1e9,
    fetchFn: async () => new Response(new Uint8Array(10)),
    onPart: async (p) => parts.push(new File([p.blob], "p.zip")),
  });
  let calls = 0;
  const api = async () => {
    calls++;
    throw Object.assign(new Error("Importing requires the Pro plan."), {
      planRequired: true,
      retriable: false,
    });
  };
  await assert.rejects(
    runImport({
      archives: createArchiveSet(parts),
      settings: {
        importFiles: true,
        importProductMedia: true,
        importBlogPosts: true,
        importPages: true,
        importMenus: true,
        replaceExisting: false,
      },
      api,
      upload: async () => {},
    }),
    /Pro plan/,
  );
  assert.ok(calls <= 2, `made ${calls} calls`);
});

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
