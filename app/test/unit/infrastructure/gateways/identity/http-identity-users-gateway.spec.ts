import { ConfigService } from '@nestjs/config';

import { ServiceRequestRejectedException } from '@application/exceptions/service-request-rejected.exception';
import { InternalHttpClient } from '@infrastructure/clients/internal-http-client';
import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';
import { HttpIdentityUsersGateway } from '@infrastructure/gateways/identity/http-identity-users-gateway';

import {
  readInternalCustomerUserFixture,
  readInternalUserFixture,
} from '../../../../helpers/identity-users-gateway-mock.factory';

describe('HttpIdentityUsersGateway', () => {
  const baseUrl = 'http://identity-service.identity.svc.cluster.local:3000';
  const userFixture = readInternalUserFixture();
  const customerUserFixture = readInternalCustomerUserFixture();
  const customerUserInput = {
    name: 'Maria Cliente',
    email: 'maria@example.com',
    cpf: '52998224725',
  };

  let internalHttpClient: jest.Mocked<Pick<InternalHttpClient, 'request'>>;
  let gateway: HttpIdentityUsersGateway;

  beforeEach(() => {
    internalHttpClient = { request: jest.fn() };

    gateway = new HttpIdentityUsersGateway(
      internalHttpClient as unknown as InternalHttpClient,
      new ConfigService({ IDENTITY_SERVICE_URL: baseUrl }),
    );
  });

  describe('findById', () => {
    it('should map the identity user fixture', async () => {
      internalHttpClient.request.mockResolvedValue(userFixture);

      await expect(gateway.findById(userFixture.data.id)).resolves.toEqual(userFixture.data);

      expect(internalHttpClient.request).toHaveBeenCalledWith({
        method: 'GET',
        url: `${baseUrl}/internal/users/${userFixture.data.id}`,
      });
    });

    it('should leave out a field the identity adds to the user', async () => {
      internalHttpClient.request.mockResolvedValue({
        data: { ...userFixture.data, cpf: '52998224725' },
      });

      await expect(gateway.findById(userFixture.data.id)).resolves.toStrictEqual(userFixture.data);
    });

    it('should return null when the identity answers 404', async () => {
      internalHttpClient.request.mockRejectedValue(
        new ServiceRequestRejectedException(404, 'Usuário não encontrado(a)'),
      );

      await expect(gateway.findById('unknown-id')).resolves.toBeNull();
    });

    it('should answer unavailable for another refusal on a read', async () => {
      internalHttpClient.request.mockRejectedValue(
        new ServiceRequestRejectedException(400, 'Requisição inválida'),
      );

      await expect(gateway.findById('any-id')).rejects.toThrow(
        new ServiceIntegrationException('Serviço de destino indisponível'),
      );
    });

    it('should let an unavailable identity error through', async () => {
      const unavailable = new ServiceIntegrationException('Serviço de destino indisponível');

      internalHttpClient.request.mockRejectedValue(unavailable);

      await expect(gateway.findById('any-id')).rejects.toBe(unavailable);
    });
  });

  describe('findByIds', () => {
    it('should request each distinct id once, in parallel', async () => {
      const answers: Array<(value: unknown) => void> = [];

      internalHttpClient.request.mockImplementation(
        () => new Promise((resolve) => answers.push(resolve)),
      );

      const pending = gateway.findByIds(['a', 'b', 'a']);

      expect(internalHttpClient.request).toHaveBeenCalledTimes(2);

      answers.forEach((answer) => answer(userFixture));

      await expect(pending).resolves.toHaveLength(2);
    });

    it('should leave out the ids the identity answers with 404', async () => {
      internalHttpClient.request
        .mockResolvedValueOnce(userFixture)
        .mockRejectedValueOnce(
          new ServiceRequestRejectedException(404, 'Usuário não encontrado(a)'),
        );

      await expect(gateway.findByIds([userFixture.data.id, 'unknown-id'])).resolves.toEqual([
        userFixture.data,
      ]);
    });

    it('should return an empty list without calling the identity for no ids', async () => {
      await expect(gateway.findByIds([])).resolves.toEqual([]);

      expect(internalHttpClient.request).not.toHaveBeenCalled();
    });
  });

  describe('ensureCustomerUser', () => {
    it('should post the customer user and map the fixture', async () => {
      internalHttpClient.request.mockResolvedValue(customerUserFixture);

      await expect(gateway.ensureCustomerUser(customerUserInput)).resolves.toEqual(
        customerUserFixture.data,
      );

      expect(internalHttpClient.request).toHaveBeenCalledWith({
        method: 'POST',
        url: `${baseUrl}/internal/customer-users`,
        body: customerUserInput,
      });
    });

    it('should leave out a field the identity adds to the customer user', async () => {
      internalHttpClient.request.mockResolvedValue({
        data: { ...customerUserFixture.data, createdAt: '2026-11-10T00:00:00.000Z' },
      });

      await expect(gateway.ensureCustomerUser(customerUserInput)).resolves.toStrictEqual(
        customerUserFixture.data,
      );
    });

    it.each([409, 422])('should keep the %i refusal of the customer user', async (status) => {
      const refusal = new ServiceRequestRejectedException(status, 'Recusado pelo Identity');

      internalHttpClient.request.mockRejectedValue(refusal);

      await expect(gateway.ensureCustomerUser(customerUserInput)).rejects.toBe(refusal);
    });

    it('should answer unavailable for another refusal of the customer user', async () => {
      internalHttpClient.request.mockRejectedValue(
        new ServiceRequestRejectedException(400, 'Requisição inválida'),
      );

      await expect(gateway.ensureCustomerUser(customerUserInput)).rejects.toThrow(
        new ServiceIntegrationException('Serviço de destino indisponível'),
      );
    });

    it('should let an unavailable identity error through', async () => {
      const unavailable = new ServiceIntegrationException('Serviço de destino indisponível');

      internalHttpClient.request.mockRejectedValue(unavailable);

      await expect(gateway.ensureCustomerUser(customerUserInput)).rejects.toBe(unavailable);
    });
  });

  it('should refuse to start without IDENTITY_SERVICE_URL', () => {
    expect(
      () =>
        new HttpIdentityUsersGateway(
          internalHttpClient as unknown as InternalHttpClient,
          new ConfigService({}),
        ),
    ).toThrow();
  });
});
