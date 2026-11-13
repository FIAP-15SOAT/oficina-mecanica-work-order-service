-- The unique priority index is checked row by row, so the shift goes through a free range first.
UPDATE "work_order_statuses" SET "priority" = "priority" + 100 WHERE "priority" >= 6;
UPDATE "work_order_statuses" SET "priority" = "priority" - 99 WHERE "priority" >= 106;

INSERT INTO "work_order_statuses" ("code", "priority") VALUES ('AWAITING_PAYMENT', 6);
