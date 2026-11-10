/*
  Warnings:

  - You are about to drop the `parts_supplies` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `services` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `stock_movements` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `stock_reservations` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_part_supply_id_fkey";

-- DropForeignKey
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_work_order_id_fkey";

-- DropForeignKey
ALTER TABLE "stock_reservations" DROP CONSTRAINT "stock_reservations_part_supply_id_fkey";

-- DropForeignKey
ALTER TABLE "stock_reservations" DROP CONSTRAINT "stock_reservations_work_order_id_fkey";

-- DropTable
DROP TABLE "parts_supplies";

-- DropTable
DROP TABLE "services";

-- DropTable
DROP TABLE "stock_movements";

-- DropTable
DROP TABLE "stock_reservations";

-- DropEnum
DROP TYPE "PartSupplyCategory";

-- DropEnum
DROP TYPE "StockMovementType";

-- DropEnum
DROP TYPE "Unit";
