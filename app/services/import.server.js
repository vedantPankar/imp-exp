import { adminGraphql } from "./shopifyAdmin.server.js";

const HANDLE = /^[\w-]+$/; // handles go into search queries, so only accept plain ones

const errorText = (userErrors) => userErrors.map((e) => e.message).join("; ");

// ---------- Staged uploads ----------

/** inputs: [{ filename, mimeType, fileSize, resource }] -> targets in the same order */
export async function createStagedUploads(admin, inputs) {
  const data = await adminGraphql(
    admin,
    `#graphql
    mutation StageUploads($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
    {
      input: inputs.map((i) => ({
        filename: i.filename,
        mimeType: i.mimeType || "application/octet-stream",
        resource: i.resource,
        httpMethod: "POST",
        // fileSize is mandatory for VIDEO and MODEL_3D targets
        ...(i.resource === "VIDEO" || i.resource === "MODEL_3D"
          ? { fileSize: String(i.fileSize) }
          : {}),
      })),
    },
  );
  const { stagedTargets, userErrors } = data.stagedUploadsCreate;
  if (userErrors.length) throw new Error(errorText(userErrors));
  return stagedTargets;
}

// ---------- Files ----------

const FILE_CREATE = `#graphql
  mutation ImportFiles($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id }
      userErrors { field message code }
    }
  }`;

const classify = (errors) => {
  const exists = errors.some(
    (e) =>
      e.code === "FILENAME_ALREADY_EXISTS" ||
      /already (exists|in use)/i.test(e.message),
  );
  return exists
    ? { status: "skipped", error: "A file with this name already exists" }
    : { status: "failed", error: errorText(errors) };
};

async function createOneFile(admin, file, replace) {
  const data = await adminGraphql(admin, FILE_CREATE, {
    files: [toFileInput(file, replace)],
  });
  const { userErrors } = data.fileCreate;
  return userErrors.length
    ? classify(userErrors)
    : { status: replace ? "replaced" : "created" };
}

const toFileInput = (f, replace) => ({
  originalSource: f.resourceUrl,
  filename: f.filename,
  alt: f.alt ?? "",
  contentType: f.contentType,
  // REPLACE swaps a file with the same name; RAISE_ERROR makes duplicates reportable as skipped
  duplicateResolutionMode: replace ? "REPLACE" : "RAISE_ERROR",
});

/**
 * Creates a batch of files. A batch call is fast but one bad item would hide the others'
 * outcome, so on any error we redo the batch item by item to get exact per-file results.
 */
export async function createFiles(admin, files, replace) {
  const data = await adminGraphql(admin, FILE_CREATE, {
    files: files.map((f) => toFileInput(f, replace)),
  });
  if (!data.fileCreate.userErrors.length) {
    return files.map(() => ({ status: replace ? "replaced" : "created" }));
  }
  const results = [];
  for (const file of files) {
    try {
      results.push(await createOneFile(admin, file, replace));
    } catch (error) {
      results.push({ status: "failed", error: error.message });
    }
  }
  return results;
}

// ---------- Product media ----------

const safeDecode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value; // malformed % sequences in a file name must not crash the import
  }
};
const normalizeName = (name) =>
  safeDecode(String(name || ""))
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "_");
const nameFromUrl = (url) => {
  try {
    return normalizeName(new URL(url).pathname.split("/").pop());
  } catch {
    return "";
  }
};

const PRODUCT_MEDIA_FIELDS = `
  id
  media(first: 250) {
    nodes { id ... on MediaImage { image { url } } ... on Video { originalSource { url } } }
  }`;

// Finds a product (with its media file names) by handle. `productByIdentifier` is the direct
// lookup; the search query is a fallback so one flaky lookup doesn't report a real product as missing.
async function findProductWithMedia(admin, handle) {
  const direct = await adminGraphql(
    admin,
    `#graphql
    query ProductForMedia($handle: String!) {
      productByIdentifier(identifier: { handle: $handle }) { ${PRODUCT_MEDIA_FIELDS} }
    }`,
    { handle },
  );
  let product = direct.productByIdentifier;
  if (!product) {
    const search = await adminGraphql(
      admin,
      `#graphql
      query ProductSearchForMedia($q: String!) {
        products(first: 1, query: $q) { nodes { handle ${PRODUCT_MEDIA_FIELDS} } }
      }`,
      { q: `handle:${handle}` },
    );
    const hit = search.products.nodes[0];
    product = hit?.handle === handle ? hit : null;
  }
  if (!product) return null;
  return {
    id: product.id,
    existing: new Map(
      product.media.nodes.map((n) => [
        nameFromUrl(n.image?.url ?? n.originalSource?.url),
        n.id,
      ]),
    ),
  };
}

/**
 * Cheap pre-check so the client doesn't upload images for products that don't exist or that
 * already have them. products: [{ handle, filenames }] -> [{ found, present: boolean[] }]
 */
export async function checkProductMedia(admin, products) {
  const out = [];
  for (const { handle, filenames } of products) {
    try {
      const product = HANDLE.test(handle || "")
        ? await findProductWithMedia(admin, handle)
        : null;
      out.push(
        product
          ? {
              found: true,
              present: filenames.map((f) =>
                product.existing.has(normalizeName(f)),
              ),
            }
          : { found: false, present: filenames.map(() => false) },
      );
    } catch (error) {
      out.push({ error: error.message });
    }
  }
  return out;
}

/**
 * Re-attaches media to the product with `handle`.
 * Without `replace`, media whose file name is already on the product is skipped, so
 * importing into the same store doesn't duplicate everything. With `replace`, the matching
 * existing media is deleted first.
 */
export async function attachProductMedia(admin, { handle, media }, replace) {
  if (!HANDLE.test(handle || "")) {
    return media.map(() => ({
      status: "failed",
      error: "Invalid product handle",
    }));
  }
  const product = await findProductWithMedia(admin, handle);
  if (!product) {
    return media.map(() => ({
      status: "failed",
      error: `Product “${handle}” not found in this store`,
    }));
  }
  const existing = product.existing;
  const results = media.map(() => null);
  const toAdd = [];
  const toDelete = [];
  media.forEach((m, i) => {
    const key = normalizeName(m.filename);
    if (existing.has(key)) {
      if (!replace) {
        results[i] = { status: "skipped", error: "Already on this product" };
        return;
      }
      toDelete.push(existing.get(key));
    }
    toAdd.push(i);
  });

  if (toAdd.length === 0) return results;
  try {
    if (toDelete.length) {
      const del = await adminGraphql(
        admin,
        `#graphql
        mutation RemoveOldMedia($ids: [ID!]!) {
          fileDelete(fileIds: $ids) { userErrors { message } }
        }`,
        { ids: toDelete },
      );
      if (del.fileDelete.userErrors.length)
        throw new Error(errorText(del.fileDelete.userErrors));
    }
    const res = await adminGraphql(
      admin,
      `#graphql
      mutation AttachMedia($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
        productUpdate(product: $product, media: $media) {
          product { id }
          userErrors { field message }
        }
      }`,
      {
        product: { id: product.id },
        media: toAdd.map((i) => ({
          originalSource: media[i].resourceUrl,
          alt: media[i].alt ?? "",
          mediaContentType: media[i].mediaContentType,
        })),
      },
    );
    const { userErrors } = res.productUpdate;
    for (const i of toAdd) {
      results[i] = userErrors.length
        ? { status: "failed", error: errorText(userErrors) }
        : { status: replace ? "replaced" : "created" };
    }
  } catch (error) {
    for (const i of toAdd)
      results[i] = { status: "failed", error: error.message };
  }
  return results;
}

// ---------- Content (upsert by handle) ----------

const FIND_QUERIES = {
  blogs: `#graphql
    query FindBlog($q: String!) { blogs(first: 1, query: $q) { nodes { id } } }`,
  pages: `#graphql
    query FindPage($q: String!) { pages(first: 1, query: $q) { nodes { id } } }`,
};

async function findByHandle(admin, root, handle) {
  if (!HANDLE.test(handle || "")) return null;
  const data = await adminGraphql(admin, FIND_QUERIES[root], {
    q: `handle:${handle}`,
  });
  return data[root].nodes[0]?.id ?? null;
}

const run = async (items, worker) => {
  const results = [];
  for (const item of items) {
    try {
      results.push(await worker(item));
    } catch (error) {
      results.push({ status: "failed", error: error.message });
    }
  }
  return results;
};

const published = (item) => ({
  isPublished: Boolean(item.isPublished),
  ...(item.isPublished && item.publishedAt
    ? { publishDate: item.publishedAt }
    : {}),
});

export function upsertBlogs(admin, blogs) {
  return run(blogs, async (b) => {
    const input = {
      title: b.title,
      commentPolicy: b.commentPolicy,
      templateSuffix: b.templateSuffix ?? null,
    };
    const id = await findByHandle(admin, "blogs", b.handle);
    const data = id
      ? await adminGraphql(
          admin,
          `#graphql
          mutation UpdateBlog($id: ID!, $blog: BlogUpdateInput!) {
            blogUpdate(id: $id, blog: $blog) { blog { id } userErrors { field message } }
          }`,
          { id, blog: input },
        )
      : await adminGraphql(
          admin,
          `#graphql
          mutation CreateBlog($blog: BlogCreateInput!) {
            blogCreate(blog: $blog) { blog { id } userErrors { field message } }
          }`,
          { blog: { ...input, handle: b.handle } },
        );
    const { userErrors } = data.blogUpdate ?? data.blogCreate;
    if (userErrors.length)
      return { status: "failed", error: errorText(userErrors) };
    return { status: id ? "updated" : "created" };
  });
}

// Article images can't take a staged upload URL directly. Each image is first turned into a
// real file with fileCreate, then we wait for it to become READY and use its CDN URL.
export async function prepareArticleImages(
  admin,
  articles,
  {
    maxAttempts = 20,
    delayMs = 1500,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = {},
) {
  const withImage = articles.filter((a) => a.imageResourceUrl);
  const outcome = new Map(); // article -> { url } | { warning }
  if (withImage.length === 0) return outcome;

  const created = await adminGraphql(
    admin,
    `#graphql
    mutation CreateArticleImages($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { id fileStatus }
        userErrors { field message code }
      }
    }`,
    {
      files: withImage.map((a) => ({
        originalSource: a.imageResourceUrl,
        filename: a.imageFilename || undefined,
        alt: a.imageAlt ?? "",
        contentType: "IMAGE",
        // never replace an existing file; a same-named image gets a unique suffix instead
        duplicateResolutionMode: "APPEND_UUID",
      })),
    },
  );
  const { files, userErrors } = created.fileCreate;
  if (userErrors.length || files.length !== withImage.length) {
    const warning = `Featured image not imported: ${errorText(userErrors) || "file could not be created"}`;
    withImage.forEach((a) => outcome.set(a, { warning }));
    return outcome;
  }

  const pending = new Map(withImage.map((a, i) => [files[i].id, a]));
  for (let attempt = 0; pending.size > 0 && attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(delayMs);
    const data = await adminGraphql(
      admin,
      `#graphql
      query ArticleImageStatus($ids: [ID!]!) {
        nodes(ids: $ids) { id ... on MediaImage { fileStatus image { url } } }
      }`,
      { ids: [...pending.keys()] },
    );
    for (const node of data.nodes) {
      if (!node || !pending.has(node.id)) continue;
      const article = pending.get(node.id);
      if (node.fileStatus === "READY" && node.image?.url) {
        outcome.set(article, { url: node.image.url });
        pending.delete(node.id);
      } else if (node.fileStatus === "FAILED") {
        outcome.set(article, {
          warning:
            "Featured image not imported: Shopify could not process the image",
        });
        pending.delete(node.id);
      }
    }
  }
  for (const article of pending.values()) {
    outcome.set(article, {
      warning:
        "Featured image not imported: it was still processing after waiting; add it manually",
    });
  }
  return outcome;
}

export async function upsertArticles(admin, articles) {
  const blogIds = new Map(); // one blog lookup per handle per request
  const blogId = async (handle) => {
    if (!blogIds.has(handle))
      blogIds.set(handle, await findByHandle(admin, "blogs", handle));
    return blogIds.get(handle);
  };

  const images = await prepareArticleImages(admin, articles);

  return run(articles, async (a) => {
    const image = images.get(a);
    const id = await blogId(a.blogHandle);
    if (!id)
      return {
        status: "failed",
        error: `Blog “${a.blogHandle}” not found; import blogs first`,
      };

    const found = await adminGraphql(
      admin,
      `#graphql
      query FindArticle($q: String!) {
        articles(first: 10, query: $q) { nodes { id blog { id } } }
      }`,
      { q: `handle:${HANDLE.test(a.handle) ? a.handle : "-"}` },
    );
    const existing = found.articles.nodes.find((n) => n.blog.id === id);
    const input = {
      title: a.title,
      body: a.bodyHtml,
      summary: a.summary || null,
      author: { name: a.author || "Unknown" },
      tags: a.tags ?? [],
      templateSuffix: a.templateSuffix ?? null,
      ...published(a),
      ...(image?.url
        ? { image: { url: image.url, altText: a.imageAlt ?? "" } }
        : {}),
    };
    const data = existing
      ? await adminGraphql(
          admin,
          `#graphql
          mutation UpdateArticle($id: ID!, $article: ArticleUpdateInput!) {
            articleUpdate(id: $id, article: $article) { article { id } userErrors { field message } }
          }`,
          { id: existing.id, article: input },
        )
      : await adminGraphql(
          admin,
          `#graphql
          mutation CreateArticle($article: ArticleCreateInput!) {
            articleCreate(article: $article) { article { id } userErrors { field message } }
          }`,
          { article: { ...input, blogId: id, handle: a.handle } },
        );
    const { userErrors } = data.articleUpdate ?? data.articleCreate;
    if (userErrors.length)
      return { status: "failed", error: errorText(userErrors) };
    return {
      status: existing ? "updated" : "created",
      warnings: image?.warning ? [image.warning] : [],
    };
  });
}

export function upsertPages(admin, pages) {
  return run(pages, async (p) => {
    const input = {
      title: p.title,
      body: p.bodyHtml,
      templateSuffix: p.templateSuffix ?? null,
      ...published(p),
    };
    const id = await findByHandle(admin, "pages", p.handle);
    const data = id
      ? await adminGraphql(
          admin,
          `#graphql
          mutation UpdatePage($id: ID!, $page: PageUpdateInput!) {
            pageUpdate(id: $id, page: $page) { page { id } userErrors { field message } }
          }`,
          { id, page: input },
        )
      : await adminGraphql(
          admin,
          `#graphql
          mutation CreatePage($page: PageCreateInput!) {
            pageCreate(page: $page) { page { id } userErrors { field message } }
          }`,
          { page: { ...input, handle: p.handle } },
        );
    const { userErrors } = data.pageUpdate ?? data.pageCreate;
    if (userErrors.length)
      return { status: "failed", error: errorText(userErrors) };
    return { status: id ? "updated" : "created" };
  });
}

// ---------- Menus ----------

const RESOURCE_TYPES = new Set([
  "COLLECTION",
  "PAGE",
  "PRODUCT",
  "BLOG",
  "ARTICLE",
]);

// Looks up the destination store's ID for a menu link's target, by handle.
async function resolveResourceId(admin, item) {
  const handle = item.resourceHandle;
  if (!HANDLE.test(handle || "")) return null;
  switch (item.type) {
    case "COLLECTION": {
      const d = await adminGraphql(
        admin,
        `#graphql
        query C($h: String!) { collectionByIdentifier(identifier: { handle: $h }) { id } }`,
        { h: handle },
      );
      return d.collectionByIdentifier?.id ?? null;
    }
    case "PRODUCT": {
      const d = await adminGraphql(
        admin,
        `#graphql
        query P($h: String!) { productByIdentifier(identifier: { handle: $h }) { id } }`,
        { h: handle },
      );
      return d.productByIdentifier?.id ?? null;
    }
    case "PAGE":
      return findByHandle(admin, "pages", handle);
    case "BLOG":
      return findByHandle(admin, "blogs", handle);
    case "ARTICLE": {
      const d = await adminGraphql(
        admin,
        `#graphql
        query A($q: String!) { articles(first: 10, query: $q) { nodes { id blog { handle } } } }`,
        { q: `handle:${handle}` },
      );
      const hit = d.articles.nodes.find(
        (n) =>
          !item.resourceBlogHandle || n.blog.handle === item.resourceBlogHandle,
      );
      return hit?.id ?? null;
    }
    default:
      return null;
  }
}

// Link types whose target can't be found by handle (e.g. the "Orders" link of the customer
// account menu). They keep the exported resource ID, which only works on the same store.
const STORE_SPECIFIC_TYPES = new Set([
  "CUSTOMER_ACCOUNT_PAGE",
  "METAOBJECT",
  "SHOP_POLICY",
]);

const hasStoreSpecific = (items) =>
  items.some(
    (i) => STORE_SPECIFIC_TYPES.has(i.type) || hasStoreSpecific(i.items ?? []),
  );

// Builds MenuItem inputs recursively; links whose target is missing degrade to plain URL links.
// With `dropStoreSpecific`, links that need a store-specific resource are left out.
async function buildMenuItems(
  admin,
  items,
  warnings,
  { dropStoreSpecific = false } = {},
) {
  const out = [];
  for (const item of items) {
    const base = { title: item.title, tags: item.tags ?? [] };
    let node;
    if (STORE_SPECIFIC_TYPES.has(item.type)) {
      if (dropStoreSpecific || !item.sourceResourceId) {
        warnings.push(
          `“${item.title}”: ${item.type.toLowerCase().replace(/_/g, " ")} link skipped (it points to a store-specific resource)`,
        );
        continue;
      }
      node = {
        ...base,
        type: item.type,
        resourceId: item.sourceResourceId,
        url: item.url ?? undefined,
      };
    } else if (RESOURCE_TYPES.has(item.type) && item.resourceHandle) {
      const resourceId = await resolveResourceId(admin, item);
      if (resourceId) {
        node = {
          ...base,
          type: item.type,
          resourceId,
          url: item.url ?? undefined,
        };
      } else {
        warnings.push(
          `“${item.title}”: ${item.type.toLowerCase()} “${item.resourceHandle}” not found, linked by URL`,
        );
        node = { ...base, type: "HTTP", url: item.url ?? "/" };
      }
    } else {
      node = { ...base, type: item.type, url: item.url ?? undefined };
    }
    const children = await buildMenuItems(admin, item.items ?? [], warnings, {
      dropStoreSpecific,
    });
    if (children.length) node.items = children;
    out.push(node);
  }
  return out;
}

export function upsertMenus(admin, menus) {
  return run(menus, async (m) => {
    const all = await adminGraphql(
      admin,
      `#graphql
      query ExistingMenus { menus(first: 250) { nodes { id handle } } }`,
    );
    const existing = all.menus.nodes.find((n) => n.handle === m.handle);
    const warnings = [];
    const save = async (items) => {
      const data = existing
        ? await adminGraphql(
            admin,
            `#graphql
            mutation UpdateMenu($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
              menuUpdate(id: $id, title: $title, items: $items) {
                menu { id }
                userErrors { field message }
              }
            }`,
            { id: existing.id, title: m.title, items },
          )
        : await adminGraphql(
            admin,
            `#graphql
            mutation CreateMenu($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
              menuCreate(title: $title, handle: $handle, items: $items) {
                menu { id }
                userErrors { field message }
              }
            }`,
            { title: m.title, handle: m.handle, items },
          );
      return (data.menuUpdate ?? data.menuCreate).userErrors;
    };

    let userErrors = await save(
      await buildMenuItems(admin, m.items ?? [], warnings),
    );
    // One unresolvable store-specific link shouldn't lose the whole menu: retry without them.
    if (userErrors.length && hasStoreSpecific(m.items ?? [])) {
      warnings.length = 0;
      userErrors = await save(
        await buildMenuItems(admin, m.items ?? [], warnings, {
          dropStoreSpecific: true,
        }),
      );
    }
    if (userErrors.length)
      return { status: "failed", error: errorText(userErrors) };
    return { status: existing ? "updated" : "created", warnings };
  });
}
