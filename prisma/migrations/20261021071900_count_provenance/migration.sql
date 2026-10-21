-- AlterTable
ALTER TABLE "stock_counts" ADD COLUMN     "actorType" "ActorType" NOT NULL DEFAULT 'HUMAN',
ADD COLUMN     "sourceMetadata" JSONB;
