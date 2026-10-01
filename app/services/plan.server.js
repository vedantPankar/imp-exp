// Plan helpers. `billing` is the object returned by authenticate.admin(request).
export const PRO_PLAN = "Pro";
export { PRO_PRICE_AMOUNT, PRO_TRIAL_DAYS } from "./plan-info.js";

// Dev stores can only accept test charges, so real billing is opt-out outside production.
export const BILLING_TEST =
  // eslint-disable-next-line no-undef
  process.env.NODE_ENV !== "production" ||
  process.env.BILLING_TEST_MODE === "true";

// import and the dashboard both ask on every request; keep the answer for a short time
// so a big import doesn't run one billing query per batch.
const TTL_MS = 60_000;
const cache = new Map();

export function clearPlanCache(shop) {
  if (shop) cache.delete(shop);
  else cache.clear();
}

export async function getPlan(billing, shop, now = Date.now()) {
  const hit = cache.get(shop);
  if (hit && now - hit.at < TTL_MS) return hit.plan;

  const { hasActivePayment, appSubscriptions } = await billing.check({
    plans: [PRO_PLAN],
    isTest: BILLING_TEST,
  });
  const plan = {
    isPro: hasActivePayment,
    subscriptionId: appSubscriptions?.[0]?.id ?? null,
  };
  // Only cache "Pro": a merchant who just approved the charge must see Pro right away.
  if (plan.isPro) cache.set(shop, { plan, at: now });
  return plan;
}

// Server-side gate for import. Throws a 402 the client can recognise.
export async function assertImportAllowed(billing, shop) {
  const plan = await getPlan(billing, shop);
  if (!plan.isPro) {
    throw Response.json(
      { error: "Importing requires the Pro plan.", code: "PLAN_REQUIRED" },
      { status: 402 },
    );
  }
  return plan;
}
