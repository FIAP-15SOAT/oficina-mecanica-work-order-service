/* eslint-disable no-console */
import { PrismaClient } from '../generated/client';
import { SEED_IDS } from './seed-ids';

interface ServiceSeed {
  name: string;
  description: string;
  basePrice: number;
  estimatedTimeMin: number;
}

const services: ServiceSeed[] = [
  {
    name: 'Troca de óleo',
    description: 'Troca de óleo do motor com filtro de óleo',
    basePrice: 150.0,
    estimatedTimeMin: 30,
  },
  {
    name: 'Alinhamento e balanceamento',
    description: 'Alinhamento de direção e balanceamento das 4 rodas',
    basePrice: 120.0,
    estimatedTimeMin: 60,
  },
  {
    name: 'Revisão completa',
    description:
      'Revisão de todos os sistemas do veículo incluindo motor, freios, suspensão e sistema elétrico',
    basePrice: 450.0,
    estimatedTimeMin: 180,
  },
  {
    name: 'Troca de pastilhas de freio',
    description: 'Substituição das pastilhas de freio dianteiras ou traseiras',
    basePrice: 200.0,
    estimatedTimeMin: 45,
  },
  {
    name: 'Troca de correia dentada',
    description: 'Substituição da correia dentada e tensionadores',
    basePrice: 350.0,
    estimatedTimeMin: 120,
  },
  {
    name: 'Troca de bateria',
    description: 'Remoção da bateria antiga e instalação de bateria nova',
    basePrice: 80.0,
    estimatedTimeMin: 20,
  },
  {
    name: 'Limpeza de bicos injetores',
    description: 'Limpeza ultrassônica dos bicos injetores de combustível',
    basePrice: 180.0,
    estimatedTimeMin: 90,
  },
  {
    name: 'Troca de velas de ignição',
    description: 'Substituição das velas de ignição do motor',
    basePrice: 100.0,
    estimatedTimeMin: 40,
  },
  {
    name: 'Troca de filtro de ar',
    description: 'Substituição do filtro de ar do motor',
    basePrice: 60.0,
    estimatedTimeMin: 15,
  },
  {
    name: 'Troca de filtro de combustível',
    description: 'Substituição do filtro de combustível',
    basePrice: 90.0,
    estimatedTimeMin: 30,
  },
  {
    name: 'Troca de amortecedores',
    description: 'Substituição dos amortecedores dianteiros ou traseiros (par)',
    basePrice: 280.0,
    estimatedTimeMin: 90,
  },
  {
    name: 'Sangria de freios',
    description: 'Troca do fluido de freio e sangria do sistema',
    basePrice: 120.0,
    estimatedTimeMin: 45,
  },
  {
    name: 'Troca de embreagem',
    description: 'Substituição do kit de embreagem completo',
    basePrice: 800.0,
    estimatedTimeMin: 240,
  },
  {
    name: 'Diagnóstico eletrônico',
    description: 'Diagnóstico completo do sistema eletrônico do veículo',
    basePrice: 100.0,
    estimatedTimeMin: 60,
  },
  {
    name: 'Troca de pneus',
    description: 'Desmontagem de pneus antigos e montagem de pneus novos (por unidade)',
    basePrice: 40.0,
    estimatedTimeMin: 15,
  },
  {
    name: 'Geometria de suspensão',
    description: 'Ajuste completo da geometria da suspensão',
    basePrice: 150.0,
    estimatedTimeMin: 90,
  },
  {
    name: 'Troca de óleo de câmbio',
    description: 'Troca do óleo da caixa de câmbio',
    basePrice: 200.0,
    estimatedTimeMin: 60,
  },
  {
    name: 'Limpeza de ar-condicionado',
    description: 'Higienização completa do sistema de ar-condicionado',
    basePrice: 150.0,
    estimatedTimeMin: 60,
  },
  {
    name: 'Recarga de ar-condicionado',
    description: 'Recarga do gás refrigerante do ar-condicionado',
    basePrice: 180.0,
    estimatedTimeMin: 45,
  },
  {
    name: 'Troca de disco de freio',
    description: 'Substituição dos discos de freio dianteiros ou traseiros (par)',
    basePrice: 300.0,
    estimatedTimeMin: 60,
  },
  {
    name: 'Polimento de faróis',
    description: 'Polimento e restauração dos faróis',
    basePrice: 120.0,
    estimatedTimeMin: 45,
  },
  {
    name: 'Troca de radiador',
    description: 'Substituição do radiador do sistema de arrefecimento',
    basePrice: 400.0,
    estimatedTimeMin: 120,
  },
  {
    name: "Troca de bomba d'água",
    description: "Substituição da bomba d'água do motor",
    basePrice: 250.0,
    estimatedTimeMin: 90,
  },
  {
    name: 'Retífica de motor',
    description: 'Retífica completa do motor',
    basePrice: 2500.0,
    estimatedTimeMin: 1200,
  },
  {
    name: 'Martelinho de ouro',
    description: 'Remoção de amassados sem pintura',
    basePrice: 200.0,
    estimatedTimeMin: 120,
  },
];

export async function seedServices(prisma: PrismaClient): Promise<Record<string, string>> {
  console.log('🌱 Seeding services...');

  const ids: Record<string, string> = {};

  for (const service of services) {
    const result = await prisma.service.upsert({
      where: { name: service.name },
      update: {
        description: service.description,
        basePrice: service.basePrice,
        estimatedTimeMin: service.estimatedTimeMin,
      },
      create: {
        id: SEED_IDS.services[service.name],
        name: service.name,
        description: service.description,
        basePrice: service.basePrice,
        estimatedTimeMin: service.estimatedTimeMin,
      },
    });

    ids[service.name] = result.id;
    console.log(`  ✔ ${service.name} - R$ ${service.basePrice.toFixed(2)}`);
  }

  console.log(`✅ ${services.length} services seeded`);
  return ids;
}
