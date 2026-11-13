/* eslint-disable no-console */
import { PrismaClient, WorkOrderStatus } from '../generated/client';

const WORK_ORDER_STATUS_PRIORITY: Record<WorkOrderStatus, number> = {
  [WorkOrderStatus.RECEIVED]: 1,
  [WorkOrderStatus.IN_DIAGNOSIS]: 2,
  [WorkOrderStatus.AWAITING_APPROVAL]: 3,
  [WorkOrderStatus.REJECTED]: 4,
  [WorkOrderStatus.APPROVED]: 5,
  [WorkOrderStatus.AWAITING_PAYMENT]: 6,
  [WorkOrderStatus.IN_PROGRESS]: 7,
  [WorkOrderStatus.COMPLETED]: 8,
  [WorkOrderStatus.DELIVERED]: 9,
  [WorkOrderStatus.CANCELLED]: 10,
};

export async function seedWorkOrderStatusInfos(prisma: PrismaClient): Promise<void> {
  const rows = Object.entries(WORK_ORDER_STATUS_PRIORITY).map(([code, priority]) => ({
    code: code as WorkOrderStatus,
    priority,
  }));

  for (const row of rows) {
    await prisma.workOrderStatusInfo.upsert({
      where: { code: row.code },
      update: { priority: row.priority },
      create: row,
    });
  }

  console.log(`✅ WorkOrderStatusInfo: ${rows.length} rows seeded`);
}
