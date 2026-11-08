import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { IInventoryCatalogGateway } from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.interface';
import {
  InventoryPartSupplyGatewayResponse,
  InventoryServiceGatewayResponse,
} from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.response';

export interface InternalServiceFixture {
  data: InventoryServiceGatewayResponse;
}

export interface InternalPartSupplyFixture {
  data: InventoryPartSupplyGatewayResponse;
}

function readFixture<T>(file: string): T {
  return JSON.parse(readFileSync(join(__dirname, '../contracts/inventory', file), 'utf8')) as T;
}

export function readInternalServiceFixture(): InternalServiceFixture {
  return readFixture('internal-service.json');
}

export function readInternalPartSupplyFixture(): InternalPartSupplyFixture {
  return readFixture('internal-part-supply.json');
}

export function createMockInventoryCatalogGateway(): jest.Mocked<IInventoryCatalogGateway> {
  return { findServicesByIds: jest.fn(), findPartsSuppliesByIds: jest.fn() };
}

export function createMockInventoryServiceGatewayResponse(
  overrides: Partial<InventoryServiceGatewayResponse> = {},
): InventoryServiceGatewayResponse {
  return { ...readInternalServiceFixture().data, id: randomUUID(), ...overrides };
}

export function createMockInventoryPartSupplyGatewayResponse(
  overrides: Partial<InventoryPartSupplyGatewayResponse> = {},
): InventoryPartSupplyGatewayResponse {
  return { ...readInternalPartSupplyFixture().data, id: randomUUID(), ...overrides };
}
