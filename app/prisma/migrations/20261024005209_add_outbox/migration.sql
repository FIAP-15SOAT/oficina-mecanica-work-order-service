-- CreateTable
CREATE TABLE "outbox" (
    "id" BIGSERIAL NOT NULL,
    "message_id" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "work_order_id" UUID,
    "payload" JSONB NOT NULL,
    "trace_context" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outbox_message_id_key" ON "outbox"("message_id");

-- AddForeignKey
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
