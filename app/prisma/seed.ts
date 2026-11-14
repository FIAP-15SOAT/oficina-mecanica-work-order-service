/* eslint-disable no-console */
import 'dotenv/config';
import { PrismaClient } from './generated/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { seedCustomers } from './seeds/customer.seed';
import { seedVehicles } from './seeds/vehicle.seed';
import { seedWorkOrders } from './seeds/work-order.seed';
import { seedWorkOrderStatusInfos } from './seeds/work-order-status-info.seed';
import { seedUserCustomers } from './seeds/user-customer.seed';

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  console.log('🚀 Starting database seed...\n');

  await seedWorkOrderStatusInfos(prisma);
  const customerIds = await seedCustomers(prisma);
  await seedUserCustomers(prisma, customerIds);
  const vehicleIds = await seedVehicles(prisma, customerIds);
  await seedWorkOrders(prisma, customerIds, vehicleIds);

  console.log('\n🎉 Seed completed successfully!');
}

main()
  .catch((e: Error) => {
    console.error('❌ Seed failed:', e.message);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
