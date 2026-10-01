const PROXY_HOST = "cdn.shopify.com";

/**
 * Fetches directly from the CDN; if the browser blocks it (CORS surfaces as a TypeError),
 * retries through the authenticated /api/download-proxy route. Once the proxy was needed
 * it is used for the rest of the export so we don't pay a failed request per file.
 */
export function createDownloader(baseFetch = (...a) => fetch(...a)) {
  let useProxy = false;
  const viaProxy = (url, options) =>
    baseFetch(`/api/download-proxy?url=${encodeURIComponent(url)}`, options);
  const proxiable = (url) => {
    try {
      const u = new URL(url);
      return u.protocol === "https:" && u.hostname === PROXY_HOST;
    } catch {
      return false;
    }
  };

  return async (url, options) => {
    if (useProxy && proxiable(url)) return viaProxy(url, options);
    try {
      return await baseFetch(url, options);
    } catch (error) {
      if (
        options?.signal?.aborted ||
        !(error instanceof TypeError) ||
        !proxiable(url)
      ) {
        throw error;
      }
      useProxy = true;
      return viaProxy(url, options);
    }
  };
}
