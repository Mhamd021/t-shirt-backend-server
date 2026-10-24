-- CreateIndex
CREATE INDEX "Order_status_sendAt_idx" ON "Order"("status", "sendAt");
