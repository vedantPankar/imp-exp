import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import {
  BILLING_TEST,
  PRO_PLAN,
  clearPlanCache,
  getPlan,
} from "../services/plan.server";

// POST intent=upgrade -> sends the merchant to Shopify's charge approval page (7-day trial applies)
// POST intent=cancel  -> cancels the active Pro subscription
export const action = async ({ request }) => {
  const { billing, session } = await authenticate.admin(request);
  const form = await request.formData();

  if (form.get("intent") === "cancel") {
    const plan = await getPlan(billing, session.shop);
    if (plan.subscriptionId) {
      await billing.cancel({
        subscriptionId: plan.subscriptionId,
        isTest: BILLING_TEST,
        prorate: true,
      });
    }
    clearPlanCache(session.shop);
    return redirect("/app");
  }

  // Throws a redirect out of the iframe to Shopify's approval page; returns here on approval.
  await billing.request({ plan: PRO_PLAN, isTest: BILLING_TEST });
  return null;
};
