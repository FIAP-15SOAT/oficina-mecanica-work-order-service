/* eslint-disable no-console */
import { PrismaClient, WorkOrderStatus } from '../generated/client';
import { SEED_IDS } from './seed-ids';

export async function seedWorkOrders(
  prisma: PrismaClient,
  customerIds: Record<string, string>,
  vehicleIds: Record<string, string>,
): Promise<void> {
  console.log('🌱 Seeding work orders...');

  const customerId1 = customerIds['12345678909'];
  const customerId2 = customerIds['98765432100'];
  const vehicleId1 = vehicleIds['ABC-1234'];
  const vehicleId2 = vehicleIds['DEF-5678'];
  const vehicleId3 = vehicleIds['GHI-9012'];

  if (!customerId1 || !vehicleId1) {
    console.log('  ⚠ Skipping work-order seed: required customer/vehicle not found');
    return;
  }

  // WO 1 — DELIVERED (complete flow)
  const wo1 = await prisma.workOrder.upsert({
    where: { number: '000001' },
    update: {},
    create: {
      number: '000001',
      customerId: customerId1,
      vehicleId: vehicleId1,
      status: WorkOrderStatus.DELIVERED,
      problemDescription: 'Troca de óleo e revisão geral',
      mileageAtService: 45000,
      totalAmount: 580.0,
      approvedAt: new Date('2026-04-10T10:00:00Z'),
      startedAt: new Date('2026-04-10T14:00:00Z'),
      finishedAt: new Date('2026-04-11T12:00:00Z'),
      deliveredAt: new Date('2026-04-11T15:00:00Z'),
    },
  });

  const trocaOleoId = SEED_IDS.services['Troca de óleo'];
  const revisaoId = SEED_IDS.services['Revisão completa'];

  if (trocaOleoId) {
    await prisma.workOrderService.upsert({
      where: { workOrderId_serviceId: { workOrderId: wo1.id, serviceId: trocaOleoId } },
      update: {},
      create: {
        workOrderId: wo1.id,
        serviceId: trocaOleoId,
        quantity: 1,
        unitPrice: 150.0,
        totalPrice: 150.0,
        status: 'COMPLETED',
        startedAt: new Date('2026-04-10T14:00:00Z'),
        finishedAt: new Date('2026-04-10T15:00:00Z'),
      },
    });
  }

  if (revisaoId) {
    await prisma.workOrderService.upsert({
      where: { workOrderId_serviceId: { workOrderId: wo1.id, serviceId: revisaoId } },
      update: {},
      create: {
        workOrderId: wo1.id,
        serviceId: revisaoId,
        quantity: 1,
        unitPrice: 430.0,
        totalPrice: 430.0,
        status: 'COMPLETED',
        startedAt: new Date('2026-04-10T15:00:00Z'),
        finishedAt: new Date('2026-04-11T12:00:00Z'),
      },
    });
  }

  await prisma.statusHistory.createMany({
    skipDuplicates: true,
    data: [
      {
        workOrderId: wo1.id,
        previousStatus: null,
        newStatus: 'RECEIVED',
        createdAt: new Date('2026-04-08T09:00:00Z'),
      },
      {
        workOrderId: wo1.id,
        previousStatus: 'RECEIVED',
        newStatus: 'IN_DIAGNOSIS',
        createdAt: new Date('2026-04-08T09:30:00Z'),
      },
      {
        workOrderId: wo1.id,
        previousStatus: 'IN_DIAGNOSIS',
        newStatus: 'AWAITING_APPROVAL',
        createdAt: new Date('2026-04-09T10:00:00Z'),
      },
      {
        workOrderId: wo1.id,
        previousStatus: 'AWAITING_APPROVAL',
        newStatus: 'APPROVED',
        createdAt: new Date('2026-04-10T10:00:00Z'),
      },
      {
        workOrderId: wo1.id,
        previousStatus: 'APPROVED',
        newStatus: 'IN_PROGRESS',
        createdAt: new Date('2026-04-10T14:00:00Z'),
      },
      {
        workOrderId: wo1.id,
        previousStatus: 'IN_PROGRESS',
        newStatus: 'COMPLETED',
        createdAt: new Date('2026-04-11T12:00:00Z'),
      },
      {
        workOrderId: wo1.id,
        previousStatus: 'COMPLETED',
        newStatus: 'DELIVERED',
        createdAt: new Date('2026-04-11T15:00:00Z'),
      },
    ],
  });

  console.log('  ✓ WorkOrder: 000001 (DELIVERED)');

  // WO 2 — IN_DIAGNOSIS
  if (customerId2 && vehicleId3) {
    const wo2 = await prisma.workOrder.upsert({
      where: { number: '000002' },
      update: {},
      create: {
        number: '000002',
        customerId: customerId2,
        vehicleId: vehicleId3,
        status: WorkOrderStatus.IN_DIAGNOSIS,
        problemDescription: 'Veículo não está dando partida',
        mileageAtService: 15000,
        totalAmount: 0,
      },
    });

    await prisma.statusHistory.createMany({
      skipDuplicates: true,
      data: [
        {
          workOrderId: wo2.id,
          previousStatus: null,
          newStatus: 'RECEIVED',
          createdAt: new Date('2026-04-25T09:00:00Z'),
        },
        {
          workOrderId: wo2.id,
          previousStatus: 'RECEIVED',
          newStatus: 'IN_DIAGNOSIS',
          createdAt: new Date('2026-04-25T10:00:00Z'),
        },
      ],
    });

    console.log('  ✓ WorkOrder: 000002 (IN_DIAGNOSIS)');
  }

  // WO 3 — RECEIVED
  if (customerId1 && vehicleId2) {
    const wo3 = await prisma.workOrder.upsert({
      where: { number: '000003' },
      update: {},
      create: {
        number: '000003',
        customerId: customerId1,
        vehicleId: vehicleId2,
        status: WorkOrderStatus.RECEIVED,
        problemDescription: 'Revisão periódica de 70.000 km',
        mileageAtService: 72000,
        totalAmount: 0,
      },
    });

    await prisma.statusHistory.createMany({
      skipDuplicates: true,
      data: [{ workOrderId: wo3.id, previousStatus: null, newStatus: 'RECEIVED' }],
    });

    console.log('  ✓ WorkOrder: 000003 (RECEIVED)');
  }

  await prisma.$queryRaw`
    SELECT setval(
      'work_order_number_seq',
      GREATEST(COALESCE((SELECT MAX(CAST(number AS INTEGER)) FROM work_orders), 1), 1),
      (SELECT COUNT(*) FROM work_orders) > 0
    )
  `;
}
