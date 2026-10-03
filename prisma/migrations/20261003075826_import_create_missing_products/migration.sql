-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ImportSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "replaceExisting" BOOLEAN NOT NULL DEFAULT false,
    "importFiles" BOOLEAN NOT NULL DEFAULT true,
    "importProductMedia" BOOLEAN NOT NULL DEFAULT true,
    "importBlogPosts" BOOLEAN NOT NULL DEFAULT true,
    "importPages" BOOLEAN NOT NULL DEFAULT true,
    "importMenus" BOOLEAN NOT NULL DEFAULT true,
    "createMissingProducts" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ImportSettings" ("importBlogPosts", "importFiles", "importMenus", "importPages", "importProductMedia", "replaceExisting", "shop", "updatedAt") SELECT "importBlogPosts", "importFiles", "importMenus", "importPages", "importProductMedia", "replaceExisting", "shop", "updatedAt" FROM "ImportSettings";
DROP TABLE "ImportSettings";
ALTER TABLE "new_ImportSettings" RENAME TO "ImportSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
