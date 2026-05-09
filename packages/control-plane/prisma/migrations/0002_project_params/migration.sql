-- AlterTable (idempotent: column may already exist in initial migration)
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "params" JSONB;
