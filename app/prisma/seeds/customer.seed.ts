/* eslint-disable no-console */
import { PrismaClient, CustomerType } from '../generated/client';
import { SEED_IDS } from './seed-ids';

interface CustomerSeed {
  name: string;
  document: string;
  type: CustomerType;
  email: string;
  phone: string;
}

const customers: CustomerSeed[] = [
  {
    name: 'João da Silva',
    document: '12345678909',
    type: CustomerType.INDIVIDUAL,
    email: 'joao.silva@email.com',
    phone: '11999990001',
  },
  {
    name: 'Maria Souza',
    document: '98765432100',
    type: CustomerType.INDIVIDUAL,
    email: 'maria.souza@email.com',
    phone: '11999990002',
  },
  {
    name: 'Oficina Parceira LTDA',
    document: '12345678000195',
    type: CustomerType.COMPANY,
    email: 'contato@oficinarceira.com.br',
    phone: '1133330001',
  },
];

export async function seedCustomers(prisma: PrismaClient): Promise<Record<string, string>> {
  console.log('🌱 Seeding customers...');

  const ids: Record<string, string> = {};

  for (const customer of customers) {
    const record = await prisma.customer.upsert({
      where: { document: customer.document },
      update: {
        name: customer.name,
        type: customer.type,
        email: customer.email,
        phone: customer.phone,
      },
      create: {
        id: SEED_IDS.customers[customer.document],
        name: customer.name,
        document: customer.document,
        type: customer.type,
        email: customer.email,
        phone: customer.phone,
      },
    });

    ids[customer.document] = record.id;
    console.log(`  ✓ Customer: ${customer.name}`);
  }

  return ids;
}
