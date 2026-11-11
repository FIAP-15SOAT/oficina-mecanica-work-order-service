import { PrismaService } from '../../src/infrastructure/persistence/prisma/prisma.service';

export async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.outboxMessage.deleteMany();
  await prisma.sagaInstance.deleteMany();
  await prisma.statusHistory.deleteMany();
  await prisma.workOrderPartSupply.deleteMany();
  await prisma.workOrderService.deleteMany();
  await prisma.workOrder.deleteMany();
  await prisma.address.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.user.deleteMany();
}
