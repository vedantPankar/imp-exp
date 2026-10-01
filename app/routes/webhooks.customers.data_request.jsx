import { authenticate } from "../shopify.server";

// This app never stores customer personal data (only shop-level settings and run times),
// so there is nothing to return. We still verify the request and acknowledge it.
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}: no customer data stored`);
  return new Response();
};
