/* eslint-disable no-console */
import { PrismaClient } from '../generated/client';
import { SEED_IDS } from './seed-ids';

interface UserCustomerSeed {
  userEmail: string; // the user lives in the Identity; only its id is stored here
  customerDocument: string;
}

const links: UserCustomerSeed[] = [
  { userEmail: 'joao.silva@email.com', customerDocument: '12345678909' },
  { userEmail: 'maria.souza@email.com', customerDocument: '12345678000195' },
];

export async function seedUserCustomers(
  prisma: PrismaClient,
  customerIds: Record<string, string>,
): Promise<void> {
  console.log('🌱 Seeding customer access links...');

  for (const link of links) {
    const userId = SEED_IDS.users[link.userEmail];
    const customerId = customerIds[link.customerDocument];

    if (!userId || !customerId) {
      console.log(`  ⚠ Skipping link ${link.userEmail} → ${link.customerDocument} (not found)`);
      continue;
    }

    await prisma.userCustomer.upsert({
      where: { userId_customerId: { userId, customerId } },
      update: {},
      create: { userId, customerId },
    });

    console.log(`  ✔ ${link.userEmail} → ${link.customerDocument}`);
  }

  console.log(`✅ ${links.length} customer access links seeded`);
}
