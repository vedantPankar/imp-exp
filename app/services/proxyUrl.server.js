// The download proxy may only fetch from the Shopify CDN: https, exact host, no port or
// credentials. Anything else would turn the route into an open proxy / SSRF vector.
const ALLOWED_HOST = "cdn.shopify.com";

export function isAllowedProxyUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname === ALLOWED_HOST &&
    !url.port &&
    !url.username &&
    !url.password
  );
}
