-- CreateEnum
CREATE TYPE "SagaType" AS ENUM ('QUOTE_APPROVAL');

-- CreateEnum
CREATE TYPE "SagaStatus" AS ENUM ('RESERVING_STOCK', 'COMPLETED', 'COMPENSATED');

-- CreateEnum
CREATE TYPE "SagaFailureReason" AS ENUM ('INSUFFICIENT_STOCK');

-- DropForeignKey
ALTER TABLE "quote_part_supplies" DROP CONSTRAINT "quote_part_supplies_part_supply_id_fkey";

-- DropForeignKey
ALTER TABLE "quote_services" DROP CONSTRAINT "quote_services_service_id_fkey";

-- DropForeignKey
ALTER TABLE "work_order_part_supplies" DROP CONSTRAINT "work_order_part_supplies_part_supply_id_fkey";

-- DropForeignKey
ALTER TABLE "work_order_services" DROP CONSTRAINT "work_order_services_service_id_fkey";

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "decided_by" UUID,
ADD COLUMN     "replaced_by_quote_id" UUID;

-- CreateTable
CREATE TABLE "saga_instances" (
    "id" UUID NOT NULL,
    "type" "SagaType" NOT NULL,
    "correlation_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "status" "SagaStatus" NOT NULL,
    "failure_reason" "SagaFailureReason",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saga_instances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saga_instances_work_order_id_idx" ON "saga_instances"("work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "saga_instances_type_correlation_id_key" ON "saga_instances"("type", "correlation_id");

-- AddForeignKey
ALTER TABLE "saga_instances" ADD CONSTRAINT "saga_instances_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
