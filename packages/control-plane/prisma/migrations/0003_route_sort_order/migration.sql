-- AlterTable (idempotent: column may already exist in initial migration)
ALTER TABLE "Route" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;
