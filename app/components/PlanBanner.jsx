/* eslint-disable react/prop-types */
import { useFetcher } from "react-router";
import { PRO_PRICE_AMOUNT, PRO_TRIAL_DAYS } from "../services/plan-info";

// Posts to /app/upgrade, whose action starts the Billing API approval flow.
export function useUpgrade() {
  const fetcher = useFetcher();
  return {
    upgrade: () =>
      fetcher.submit(
        { intent: "upgrade" },
        { method: "POST", action: "/app/upgrade" },
      ),
    cancel: () =>
      fetcher.submit(
        { intent: "cancel" },
        { method: "POST", action: "/app/upgrade" },
      ),
    busy: fetcher.state !== "idle",
  };
}

export function UpgradeBanner({ heading = "Importing is a Pro feature" }) {
  const { upgrade, busy } = useUpgrade();
  return (
    <s-banner tone="info" heading={heading}>
      <s-stack gap="small-200">
        <s-text>
          You’re on the Free plan, which includes exporting. Upgrade to Pro to
          import your ZIP archives into this or another store — $
          {PRO_PRICE_AMOUNT}/month with a {PRO_TRIAL_DAYS}-day free trial.
        </s-text>
        <s-stack direction="inline">
          <s-button
            variant="primary"
            onClick={upgrade}
            {...(busy ? { loading: true } : {})}
          >
            Go Pro
          </s-button>
        </s-stack>
      </s-stack>
    </s-banner>
  );
}
