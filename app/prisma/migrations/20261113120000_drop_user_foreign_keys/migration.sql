-- DropForeignKey
ALTER TABLE "status_history" DROP CONSTRAINT "status_history_changed_by_id_fkey";

-- DropForeignKey
ALTER TABLE "user_customers" DROP CONSTRAINT "user_customers_user_id_fkey";

-- DropForeignKey
ALTER TABLE "work_orders" DROP CONSTRAINT "work_orders_assigned_user_id_fkey";
