-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ExportSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "includeFiles" BOOLEAN NOT NULL DEFAULT true,
    "includeProductMedia" BOOLEAN NOT NULL DEFAULT true,
    "includeBlogPosts" BOOLEAN NOT NULL DEFAULT true,
    "includePages" BOOLEAN NOT NULL DEFAULT true,
    "includeMenus" BOOLEAN NOT NULL DEFAULT true,
    "maxPartSizeMb" INTEGER NOT NULL DEFAULT 200,
    "keepOriginalNames" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ExportSettings" ("includeBlogPosts", "includeFiles", "includeMenus", "includePages", "includeProductMedia", "keepOriginalNames", "maxPartSizeMb", "shop", "updatedAt") SELECT "includeBlogPosts", "includeFiles", "includeMenus", "includePages", "includeProductMedia", "keepOriginalNames", "maxPartSizeMb", "shop", "updatedAt" FROM "ExportSettings";
DROP TABLE "ExportSettings";
ALTER TABLE "new_ExportSettings" RENAME TO "ExportSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
