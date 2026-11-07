import { QuoteItemValidator } from '@application/services/quote-item-validator';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { IInventoryCatalogGateway } from '@application/ports/output/gateways/inventory/inventory-catalog-gateway.interface';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';

import {
  createMockInventoryCatalogGateway,
  createMockInventoryPartSupplyGatewayResponse,
  createMockInventoryServiceGatewayResponse,
} from '../../../helpers/inventory-catalog-gateway-mock.factory';

describe('QuoteItemValidator', () => {
  let validator: QuoteItemValidator;
  let inventoryCatalogGateway: jest.Mocked<IInventoryCatalogGateway>;

  beforeEach(() => {
    inventoryCatalogGateway = createMockInventoryCatalogGateway();

    validator = new QuoteItemValidator(inventoryCatalogGateway);
  });

  describe('validateAndResolve()', () => {
    it('should price services with the base price and parts with the sale price', async () => {
      const service = createMockInventoryServiceGatewayResponse({ basePrice: 100 });

      const partSupply = createMockInventoryPartSupplyGatewayResponse({ salePrice: 50 });

      inventoryCatalogGateway.findServicesByIds.mockResolvedValue([service]);
      inventoryCatalogGateway.findPartsSuppliesByIds.mockResolvedValue([partSupply]);

      await expect(
        validator.validateAndResolve(
          [{ serviceId: service.id, quantity: 1 }],
          [{ partSupplyId: partSupply.id, quantity: 2 }],
        ),
      ).resolves.toEqual({
        services: [{ serviceId: service.id, unitPrice: 100, quantity: 1 }],
        partsSupplies: [{ partSupplyId: partSupply.id, unitPrice: 50, quantity: 2 }],
      });
    });

    it('should not read the inventory when there are no items', async () => {
      await expect(validator.validateAndResolve([], [])).resolves.toEqual({
        services: [],
        partsSupplies: [],
      });

      expect(inventoryCatalogGateway.findServicesByIds).not.toHaveBeenCalled();
      expect(inventoryCatalogGateway.findPartsSuppliesByIds).not.toHaveBeenCalled();
    });

    it('should throw not found for a service absent from the inventory', async () => {
      inventoryCatalogGateway.findServicesByIds.mockResolvedValue([]);

      await expect(
        validator.validateAndResolve([{ serviceId: 'unknown-service-id', quantity: 1 }], []),
      ).rejects.toThrow(new ResourceNotFoundException('Serviço', 'unknown-service-id'));
    });

    it('should throw not found for a part supply absent from the inventory', async () => {
      const service = createMockInventoryServiceGatewayResponse();

      inventoryCatalogGateway.findServicesByIds.mockResolvedValue([service]);
      inventoryCatalogGateway.findPartsSuppliesByIds.mockResolvedValue([]);

      await expect(
        validator.validateAndResolve(
          [{ serviceId: service.id, quantity: 1 }],
          [{ partSupplyId: 'unknown-part-id', quantity: 1 }],
        ),
      ).rejects.toThrow(new ResourceNotFoundException('Peça/Insumo', 'unknown-part-id'));
    });

    it('should reject parts without a service before any lookup', async () => {
      await expect(
        validator.validateAndResolve([], [{ partSupplyId: 'part-id', quantity: 1 }]),
      ).rejects.toThrow(BusinessRuleViolationException);

      expect(inventoryCatalogGateway.findServicesByIds).not.toHaveBeenCalled();

      expect(inventoryCatalogGateway.findPartsSuppliesByIds).not.toHaveBeenCalled();
    });

    it('should reject duplicate service ids before any lookup', async () => {
      await expect(
        validator.validateAndResolve(
          [
            { serviceId: 'dup-id', quantity: 1 },
            { serviceId: 'dup-id', quantity: 2 },
          ],
          [],
        ),
      ).rejects.toThrow(BusinessRuleViolationException);

      expect(inventoryCatalogGateway.findServicesByIds).not.toHaveBeenCalled();
    });
  });
});
