import { adminGraphql } from "./shopifyAdmin.server";

// Aliases are required: `originalSource.url` has a different type per file kind.
const FILES_QUERY = `#graphql
  query ExportFiles($cursor: String) {
    files(first: 100, after: $cursor) {
      nodes {
        __typename
        id
        alt
        fileStatus
        createdAt
        ... on ExternalVideo { embedUrl }
        ... on MediaImage { mimeType image { url } imgSrc: originalSource { fileSize url } }
        ... on Video { filename vidSrc: originalSource { url fileSize mimeType } }
        ... on GenericFile { mimeType url originalFileSize }
        ... on Model3d { filename modelSrc: originalSource { url filesize mimeType } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

// Flattens the per-type shapes into one record. `url` is null when the file isn't ready yet.
export function normalize(node) {
  const src = node.imgSrc ?? node.vidSrc ?? node.modelSrc;
  return {
    id: node.id,
    kind: node.__typename,
    status: node.fileStatus ?? null,
    embedUrl: node.embedUrl ?? null,
    url: node.url ?? src?.url ?? node.image?.url ?? null,
    alt: node.alt ?? "",
    filename: node.filename ?? null,
    size: node.originalFileSize ?? src?.fileSize ?? src?.filesize ?? null,
    mimeType: node.mimeType ?? src?.mimeType ?? null,
  };
}

export async function listFilesPage(admin, cursor) {
  const data = await adminGraphql(admin, FILES_QUERY, { cursor });
  const { nodes, pageInfo } = data.files;
  return {
    files: nodes.map(normalize),
    hasNextPage: pageInfo.hasNextPage,
    cursor: pageInfo.endCursor,
  };
}
