-- CreateTable
CREATE TABLE "ExportSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "includeFiles" BOOLEAN NOT NULL DEFAULT true,
    "includeProductMedia" BOOLEAN NOT NULL DEFAULT true,
    "includeBlogPosts" BOOLEAN NOT NULL DEFAULT true,
    "includePages" BOOLEAN NOT NULL DEFAULT true,
    "includeMenus" BOOLEAN NOT NULL DEFAULT true,
    "maxPartSizeMb" INTEGER NOT NULL DEFAULT 500,
    "keepOriginalNames" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ImportSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "replaceExisting" BOOLEAN NOT NULL DEFAULT false,
    "importFiles" BOOLEAN NOT NULL DEFAULT true,
    "importProductMedia" BOOLEAN NOT NULL DEFAULT true,
    "importBlogPosts" BOOLEAN NOT NULL DEFAULT true,
    "importPages" BOOLEAN NOT NULL DEFAULT true,
    "importMenus" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ExportRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "totalBytes" BIGINT NOT NULL DEFAULT 0,
    "lastRunAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ExportRun_shop_type_key" ON "ExportRun"("shop", "type");
