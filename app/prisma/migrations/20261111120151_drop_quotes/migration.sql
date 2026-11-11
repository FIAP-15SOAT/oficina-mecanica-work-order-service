/*
  Warnings:

  - You are about to drop the `quote_part_supplies` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `quote_services` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `quotes` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "quote_part_supplies" DROP CONSTRAINT "quote_part_supplies_quote_id_fkey";

-- DropForeignKey
ALTER TABLE "quote_services" DROP CONSTRAINT "quote_services_quote_id_fkey";

-- DropForeignKey
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_work_order_id_fkey";

-- DropTable
DROP TABLE "quote_part_supplies";

-- DropTable
DROP TABLE "quote_services";

-- DropTable
DROP TABLE "quotes";

-- DropEnum
DROP TYPE "QuoteStatus";
