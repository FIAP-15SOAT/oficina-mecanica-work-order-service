/* eslint-disable no-console */
import { PrismaClient, UserRole } from '../generated/client';
import { SEED_IDS } from './seed-ids';
import * as bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;
const DEFAULT_PASSWORD = 'Tech@2026';

interface UserSeed {
  name: string;
  email: string;
  role: UserRole | null;
  cpf?: string;
}

const users: UserSeed[] = [
  {
    name: 'Guilherme da Rocha Salvador',
    email: 'guilhermedarochasalvador@gmail.com',
    role: UserRole.ADMIN,
  },
  {
    name: 'Lucas Almeida da Silva',
    email: 'lucas.almeida-silva@hotmail.com',
    role: UserRole.ADMIN,
  },
  {
    name: 'Ramoon Lincoln Barros Camacho',
    email: 'ramooncamacho@hotmail.com',
    role: UserRole.ADMIN,
  },
  {
    name: 'Renan Santana Camacho',
    email: 'camacho.renan@gmail.com',
    role: UserRole.ADMIN,
  },
  {
    name: 'João da Silva',
    email: 'joao.silva@email.com',
    role: null,
    cpf: '12345678909',
  },
  {
    name: 'Maria Souza',
    email: 'maria.souza@email.com',
    role: null,
    cpf: '98765432100',
  },
];

export async function seedUsers(prisma: PrismaClient): Promise<void> {
  console.log('🌱 Seeding users...');

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, SALT_ROUNDS);

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        name: user.name,
        role: user.role,
        cpf: user.cpf ?? null,
      },
      create: {
        id: SEED_IDS.users[user.email],
        name: user.name,
        email: user.email,
        passwordHash,
        role: user.role,
        cpf: user.cpf ?? null,
        isActive: true,
      },
    });

    console.log(`  ✔ ${user.name} (${user.email})`);
  }

  console.log(`✅ ${users.length} users seeded (senha padrão: ${DEFAULT_PASSWORD})`);
}
