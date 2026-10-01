import { authenticate } from "../shopify.server";
import db from "../db.server";
import { deleteShopData } from "../services/shopData.server";

// Sent 48 hours after uninstall: delete everything stored for the shop.
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);
  const deleted = await deleteShopData(db, shop);
  console.log(`Received ${topic} webhook for ${shop}; deleted`, deleted);
  return new Response();
};
