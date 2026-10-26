import { PrismaService } from '../../src/infrastructure/persistence/prisma/prisma.service';

export async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.outboxMessage.deleteMany();
  await prisma.stockReservation.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.statusHistory.deleteMany();
  await prisma.quoteService.deleteMany();
  await prisma.quotePartSupply.deleteMany();
  await prisma.quote.deleteMany();
  await prisma.workOrderPartSupply.deleteMany();
  await prisma.workOrderService.deleteMany();
  await prisma.workOrder.deleteMany();
  await prisma.address.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.partSupply.deleteMany();
  await prisma.service.deleteMany();
  await prisma.user.deleteMany();
}
