import { adminGraphql } from "./shopifyAdmin.server";
import { normalize } from "./files.server";

// Same aliasing as the files query: originalSource.url has a different type per media kind.
const MEDIA_FIELDS = `
  __typename
  id
  alt
  ... on MediaImage { mimeType image { url } imgSrc: originalSource { fileSize url } }
  ... on Video { filename vidSrc: originalSource { url fileSize mimeType } }
  ... on Model3d { filename modelSrc: originalSource { url filesize mimeType } }
`;

// Kept small on purpose: products x media multiplies query cost against the 1000-point limit.
const PRODUCTS_QUERY = `#graphql
  query ProductMedia($cursor: String) {
    products(first: 20, after: $cursor) {
      nodes {
        id
        handle
        media(first: 25) {
          nodes { ${MEDIA_FIELDS} }
          pageInfo { hasNextPage endCursor }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const MORE_MEDIA_QUERY = `#graphql
  query MoreMedia($id: ID!, $cursor: String) {
    product(id: $id) {
      media(first: 50, after: $cursor) {
        nodes { ${MEDIA_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;

// ExternalVideo and other kinds have no downloadable file; they come back without a url.
const isDownloadable = (m) =>
  ["MediaImage", "Video", "Model3d"].includes(m.__typename);

export async function listProductMediaPage(admin, cursor) {
  const data = await adminGraphql(admin, PRODUCTS_QUERY, { cursor });
  const items = [];
  for (const product of data.products.nodes) {
    let nodes = product.media.nodes;
    let pageInfo = product.media.pageInfo;
    // Products with more than 25 media need follow-up pages.
    while (pageInfo.hasNextPage) {
      const more = await adminGraphql(admin, MORE_MEDIA_QUERY, {
        id: product.id,
        cursor: pageInfo.endCursor,
      });
      nodes = nodes.concat(more.product.media.nodes);
      pageInfo = more.product.media.pageInfo;
    }
    nodes.filter(isDownloadable).forEach((node, position) => {
      items.push({
        ...normalize(node),
        productId: product.id,
        productHandle: product.handle,
        position,
      });
    });
  }
  return {
    files: items,
    hasNextPage: data.products.pageInfo.hasNextPage,
    cursor: data.products.pageInfo.endCursor,
  };
}
