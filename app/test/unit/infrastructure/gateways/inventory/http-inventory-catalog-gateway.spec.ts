import { ConfigService } from '@nestjs/config';

import { ServiceRequestRejectedException } from '@application/exceptions/service-request-rejected.exception';
import { InternalHttpClient } from '@infrastructure/clients/internal-http-client';
import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';
import { HttpInventoryCatalogGateway } from '@infrastructure/gateways/inventory/http-inventory-catalog-gateway';

import {
  readInternalPartSupplyFixture,
  readInternalServiceFixture,
} from '../../../../helpers/inventory-catalog-gateway-mock.factory';

describe('HttpInventoryCatalogGateway', () => {
  const baseUrl = 'http://inventory-service.inventory.svc.cluster.local:3000';
  const serviceFixture = readInternalServiceFixture();
  const partSupplyFixture = readInternalPartSupplyFixture();

  let internalHttpClient: jest.Mocked<Pick<InternalHttpClient, 'request'>>;
  let gateway: HttpInventoryCatalogGateway;

  beforeEach(() => {
    internalHttpClient = { request: jest.fn() };

    gateway = new HttpInventoryCatalogGateway(
      internalHttpClient as unknown as InternalHttpClient,
      new ConfigService({ INVENTORY_SERVICE_URL: baseUrl }),
    );
  });

  describe('findServicesByIds', () => {
    it('should map the inventory response fixture to a catalog service', async () => {
      internalHttpClient.request.mockResolvedValue(serviceFixture);

      await expect(gateway.findServicesByIds([serviceFixture.data.id])).resolves.toEqual([
        serviceFixture.data,
      ]);

      expect(internalHttpClient.request).toHaveBeenCalledWith({
        method: 'GET',
        url: `${baseUrl}/internal/services/${serviceFixture.data.id}`,
      });
    });

    it('should request every id before the first answer arrives', async () => {
      const answers: Array<(value: unknown) => void> = [];

      internalHttpClient.request.mockImplementation(
        () => new Promise((resolve) => answers.push(resolve)),
      );

      const pending = gateway.findServicesByIds(['first-id', 'second-id']);

      expect(internalHttpClient.request).toHaveBeenCalledTimes(2);

      answers.forEach((answer) => answer(serviceFixture));

      await expect(pending).resolves.toHaveLength(2);
    });

    it('should leave out an id the inventory answers with 404', async () => {
      internalHttpClient.request
        .mockResolvedValueOnce(serviceFixture)
        .mockRejectedValueOnce(
          new ServiceRequestRejectedException(404, 'Serviço não encontrado(a)'),
        );

      await expect(
        gateway.findServicesByIds([serviceFixture.data.id, 'unknown-id']),
      ).resolves.toEqual([serviceFixture.data]);
    });

    it('should turn any other owner rejection into unavailability', async () => {
      internalHttpClient.request.mockRejectedValue(
        new ServiceRequestRejectedException(400, 'Requisição inválida'),
      );

      await expect(gateway.findServicesByIds(['any-id'])).rejects.toThrow(
        new ServiceIntegrationException('Serviço de destino indisponível'),
      );
    });

    it('should propagate unavailability', async () => {
      const unavailable = new ServiceIntegrationException('Serviço de destino indisponível');

      internalHttpClient.request.mockRejectedValue(unavailable);

      await expect(gateway.findServicesByIds(['any-id'])).rejects.toBe(unavailable);
    });
  });

  describe('findPartsSuppliesByIds', () => {
    it('should map the inventory response fixture to a catalog part supply', async () => {
      internalHttpClient.request.mockResolvedValue(partSupplyFixture);

      await expect(gateway.findPartsSuppliesByIds([partSupplyFixture.data.id])).resolves.toEqual([
        partSupplyFixture.data,
      ]);

      expect(internalHttpClient.request).toHaveBeenCalledWith({
        method: 'GET',
        url: `${baseUrl}/internal/parts-supplies/${partSupplyFixture.data.id}`,
      });
    });
  });

  it('should not call the inventory for an empty id list', async () => {
    await expect(gateway.findServicesByIds([])).resolves.toEqual([]);
    await expect(gateway.findPartsSuppliesByIds([])).resolves.toEqual([]);

    expect(internalHttpClient.request).not.toHaveBeenCalled();
  });

  it('should refuse to start without INVENTORY_SERVICE_URL', () => {
    expect(
      () =>
        new HttpInventoryCatalogGateway(
          internalHttpClient as unknown as InternalHttpClient,
          new ConfigService({}),
        ),
    ).toThrow();
  });
});
