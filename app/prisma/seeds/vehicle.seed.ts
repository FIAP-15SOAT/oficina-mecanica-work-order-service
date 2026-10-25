/* eslint-disable no-console */
import { PrismaClient } from '../generated/client';
import { SEED_IDS } from './seed-ids';

interface VehicleSeed {
  customerId: string;
  plate: string;
  brand: string;
  model: string;
  year: number;
  color?: string;
  mileage?: number;
}

function buildVehicles(customerIds: Record<string, string>): VehicleSeed[] {
  return [
    {
      customerId: customerIds['12345678909'],
      plate: 'ABC-1234',
      brand: 'Toyota',
      model: 'Corolla',
      year: 2020,
      color: 'Prata',
      mileage: 45000,
    },
    {
      customerId: customerIds['12345678909'],
      plate: 'DEF-5678',
      brand: 'Volkswagen',
      model: 'Gol',
      year: 2018,
      color: 'Branco',
      mileage: 72000,
    },
    {
      customerId: customerIds['98765432100'],
      plate: 'GHI-9012',
      brand: 'Honda',
      model: 'Civic',
      year: 2022,
      color: 'Preto',
      mileage: 15000,
    },
  ];
}

export async function seedVehicles(
  prisma: PrismaClient,
  customerIds: Record<string, string>,
): Promise<Record<string, string>> {
  console.log('🌱 Seeding vehicles...');

  const ids: Record<string, string> = {};

  const vehicles = buildVehicles(customerIds);

  for (const vehicle of vehicles) {
    if (!vehicle.customerId) {
      console.log(`  ⚠ Customer ID not found for vehicle: ${vehicle.plate}`);
      continue;
    }

    const record = await prisma.vehicle.upsert({
      where: { plate: vehicle.plate },
      update: {
        customerId: vehicle.customerId,
        brand: vehicle.brand,
        model: vehicle.model,
        year: vehicle.year,
        color: vehicle.color,
        mileage: vehicle.mileage,
      },
      create: {
        id: SEED_IDS.vehicles[vehicle.plate],
        plate: vehicle.plate,
        customerId: vehicle.customerId,
        brand: vehicle.brand,
        model: vehicle.model,
        year: vehicle.year,
        color: vehicle.color,
        mileage: vehicle.mileage,
      },
    });

    ids[vehicle.plate] = record.id;

    console.log(`  ✓ Vehicle: ${vehicle.plate} (${vehicle.brand} ${vehicle.model})`);
  }

  console.log(`✅ ${vehicles.length} vehicles seeded`);

  return ids;
}
