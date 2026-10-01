import { authenticate } from "../shopify.server";
import { isAllowedProxyUrl } from "../services/proxyUrl.server";

// Fallback for browsers that can't fetch a file directly (CORS). See proxyUrl.server.js for the
// SSRF allow-list. The body is streamed through, never buffered.

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const target = new URL(request.url).searchParams.get("url");
  if (!target || !isAllowedProxyUrl(target)) {
    return new Response("URL not allowed", { status: 400 });
  }

  // redirect: "manual" so a redirect can't send us to a host we didn't validate.
  const upstream = await fetch(target, { redirect: "manual" });
  if (!upstream.ok) {
    return new Response(`Upstream responded ${upstream.status}`, {
      status:
        upstream.status >= 300 && upstream.status < 400 ? 502 : upstream.status,
    });
  }

  const headers = new Headers();
  for (const name of ["content-type", "content-length"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("cache-control", "private, no-store");
  return new Response(upstream.body, { status: 200, headers }); // streamed, never buffered
};
