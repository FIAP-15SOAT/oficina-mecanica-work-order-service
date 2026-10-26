/* eslint-disable no-console */
import { PrismaClient, PartSupplyCategory, Unit } from '../generated/client';
import { SEED_IDS } from './seed-ids';

interface PartSupplySeed {
  name: string;
  description?: string;
  sku: string;
  partNumber?: string;
  category: PartSupplyCategory;
  unit: Unit;
  costPrice: number;
  salePrice: number;
  stock: number;
  minStock: number;
}

const partSupplies: PartSupplySeed[] = [
  {
    name: 'Filtro de Óleo',
    description: 'Filtro de óleo para motores 1.0 a 2.0',
    sku: 'FILT-OL-001',
    partNumber: 'MANN-W712',
    category: PartSupplyCategory.PART,
    unit: Unit.UN,
    costPrice: 25.0,
    salePrice: 45.0,
    stock: 50,
    minStock: 10,
  },
  {
    name: 'Óleo Motor 5W30 Sintético 1L',
    description: 'Óleo motor sintético 5W30 para motores modernos',
    sku: 'OLEO-5W30-1L',
    category: PartSupplyCategory.SUPPLY,
    unit: Unit.L,
    costPrice: 30.0,
    salePrice: 52.0,
    stock: 100,
    minStock: 20,
  },
  {
    name: 'Pastilha de Freio Dianteira',
    description: 'Jogo de pastilhas de freio dianteiras',
    sku: 'PAST-FR-DI-001',
    partNumber: 'BOSCH-BP2105',
    category: PartSupplyCategory.PART,
    unit: Unit.JG,
    costPrice: 80.0,
    salePrice: 140.0,
    stock: 30,
    minStock: 5,
  },
  {
    name: 'Correia Dentada',
    description: 'Correia dentada original para motores 1.0 a 1.6',
    sku: 'CORR-DEN-001',
    partNumber: 'GATES-5619XS',
    category: PartSupplyCategory.PART,
    unit: Unit.UN,
    costPrice: 110.0,
    salePrice: 185.0,
    stock: 20,
    minStock: 3,
  },
  {
    name: 'Vela de Ignição',
    description: 'Vela de ignição iridium',
    sku: 'VELA-IG-001',
    partNumber: 'NGK-LZFR6AI',
    category: PartSupplyCategory.PART,
    unit: Unit.UN,
    costPrice: 35.0,
    salePrice: 60.0,
    stock: 40,
    minStock: 8,
  },
  {
    name: 'Fluido de Freio DOT4 500ml',
    description: 'Fluido de freio DOT4 para uso geral',
    sku: 'FLUID-FR-DOT4',
    category: PartSupplyCategory.SUPPLY,
    unit: Unit.UN,
    costPrice: 18.0,
    salePrice: 32.0,
    stock: 60,
    minStock: 15,
  },
  {
    name: 'Bateria 60Ah',
    description: 'Bateria 60Ah para veículos de médio porte',
    sku: 'BAT-60AH-001',
    category: PartSupplyCategory.PART,
    unit: Unit.UN,
    costPrice: 280.0,
    salePrice: 420.0,
    stock: 15,
    minStock: 3,
  },
  {
    name: 'Correia Alternador/AC',
    description: 'Correia poly-V para alternador e ar condicionado',
    sku: 'CORR-ALT-001',
    category: PartSupplyCategory.PART,
    unit: Unit.UN,
    costPrice: 45.0,
    salePrice: 80.0,
    stock: 25,
    minStock: 5,
  },
];

export async function seedPartSupplies(prisma: PrismaClient): Promise<Record<string, string>> {
  console.log('🌱 Seeding part supplies...');

  const ids: Record<string, string> = {};

  for (const part of partSupplies) {
    const record = await prisma.partSupply.upsert({
      where: { sku: part.sku },
      update: {
        name: part.name,
        description: part.description,
        partNumber: part.partNumber,
        category: part.category,
        unit: part.unit,
        costPrice: part.costPrice,
        salePrice: part.salePrice,
        stock: part.stock,
        minStock: part.minStock,
      },
      create: {
        id: SEED_IDS.partSupplies[part.sku],
        name: part.name,
        description: part.description,
        sku: part.sku,
        partNumber: part.partNumber,
        category: part.category,
        unit: part.unit,
        costPrice: part.costPrice,
        salePrice: part.salePrice,
        stock: part.stock,
        minStock: part.minStock,
      },
    });

    ids[part.sku] = record.id;
    console.log(`  ✓ Part: ${part.name} (${part.sku})`);
  }

  return ids;
}
