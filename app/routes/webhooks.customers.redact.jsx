import { authenticate } from "../shopify.server";

// No customer personal data is stored by this app, so there is nothing to erase.
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}: no customer data stored`);
  return new Response();
};
