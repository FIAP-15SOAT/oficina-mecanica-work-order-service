-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SagaFailureReason" ADD VALUE 'WORK_ORDER_NOT_PAYABLE';
ALTER TYPE "SagaFailureReason" ADD VALUE 'PAYMENT_EXPIRED';
ALTER TYPE "SagaFailureReason" ADD VALUE 'PAYMENT_REJECTED';
ALTER TYPE "SagaFailureReason" ADD VALUE 'PAYMENT_CANCELLED';

-- AlterEnum
ALTER TYPE "SagaStatus" ADD VALUE 'AWAITING_PAYMENT';

-- AlterEnum
ALTER TYPE "SagaType" ADD VALUE 'PAYMENT';

-- AlterEnum
ALTER TYPE "WorkOrderStatus" ADD VALUE 'AWAITING_PAYMENT';

-- AlterTable
ALTER TABLE "saga_instances" ADD COLUMN     "origin_status" "WorkOrderStatus";
