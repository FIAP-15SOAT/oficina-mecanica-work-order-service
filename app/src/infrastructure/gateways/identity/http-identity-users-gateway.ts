import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ServiceRequestRejectedException } from '@application/exceptions/service-request-rejected.exception';
import { IIdentityUsersGateway } from '@application/ports/output/gateways/identity/identity-users-gateway.interface';
import {
  EnsureCustomerUserGatewayResponse,
  IdentityUserGatewayResponse,
} from '@application/ports/output/gateways/identity/identity-users-gateway.response';
import { InternalHttpClient } from '@infrastructure/clients/internal-http-client';
import { ServiceIntegrationException } from '@infrastructure/exceptions/service-integration.exception';

const NOT_FOUND_STATUS = 404;
const UNAVAILABLE_MESSAGE = 'Serviço de destino indisponível';

@Injectable()
export class HttpIdentityUsersGateway implements IIdentityUsersGateway {
  private readonly baseUrl: string;

  constructor(
    private readonly internalHttpClient: InternalHttpClient,
    configService: ConfigService,
  ) {
    this.baseUrl = configService.getOrThrow<string>('IDENTITY_SERVICE_URL');
  }

  async findById(id: string): Promise<IdentityUserGatewayResponse | null> {
    try {
      const { data } = await this.internalHttpClient.request<{ data: IdentityUserGatewayResponse }>(
        { method: 'GET', url: `${this.baseUrl}/internal/users/${id}` },
      );

      // Picks the fields so a field the Identity adds never reaches the public responses.
      return {
        id: data.id,
        name: data.name,
        email: data.email,
        role: data.role,
        isActive: data.isActive,
      };
    } catch (error) {
      if (!(error instanceof ServiceRequestRejectedException)) {
        throw error;
      }

      if (error.statusCode === NOT_FOUND_STATUS) {
        return null;
      }

      // Any other refusal means the two contracts drifted apart: the caller cannot fix the request.
      throw new ServiceIntegrationException(UNAVAILABLE_MESSAGE);
    }
  }

  async findByIds(ids: readonly string[]): Promise<IdentityUserGatewayResponse[]> {
    const found = await Promise.all([...new Set(ids)].map((id) => this.findById(id)));

    return found.filter((user) => user !== null);
  }

  async ensureCustomerUser(input: {
    name: string;
    email: string;
    cpf: string;
  }): Promise<EnsureCustomerUserGatewayResponse> {
    try {
      const { data } = await this.internalHttpClient.request<{
        data: EnsureCustomerUserGatewayResponse;
      }>({ method: 'POST', url: `${this.baseUrl}/internal/customer-users`, body: input });

      return { userId: data.userId, created: data.created };
    } catch (error) {
      if (!(error instanceof ServiceRequestRejectedException)) {
        throw error;
      }

      // 409 and 422 carry the owner's reason and reach the caller unchanged.
      if (error.statusCode === 409 || error.statusCode === 422) {
        throw error;
      }

      throw new ServiceIntegrationException(UNAVAILABLE_MESSAGE);
    }
  }
}
