import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { IdentityUserGatewayResponse } from '@application/ports/output/gateways/identity/identity-users-gateway.response';

import {
  readInternalWorkOrderBalanceFixture,
  readInternalWorkOrderPaymentsFixture,
} from './billing-payments-gateway-mock.factory';
import { readInternalQuoteSummaryFixture } from './billing-quotes-gateway-mock.factory';
import {
  readInternalCustomerUserFixture,
  readInternalUserFixture,
} from './identity-users-gateway-mock.factory';
import {
  readInternalPartSupplyFixture,
  readInternalServiceFixture,
} from './inventory-catalog-gateway-mock.factory';

export interface InternalServicesStubResponse {
  status: number;
  body?: object;
}

export interface InternalServicesStub {
  url: string;
  services: Map<string, object>;
  partsSupplies: Map<string, object>;
  /** Billing quotes by id, in the shape with items. */
  quotes: Map<string, object>;
  /** Identity users by id. */
  users: Map<string, object>;
  /** Bodies received on `POST /internal/customer-users` and the answer it gives. */
  customerUsers: { calls: object[]; response: InternalServicesStubResponse };
  /** Ids whose route answers 500, as a failure of the owner. */
  failingIds: Set<string>;
  /** One-shot answers keyed by "<METHOD> <path>", checked before any route. */
  nextResponses: Map<string, InternalServicesStubResponse>;
  close(): Promise<void>;
}

/** Answers one route from its path params and the parsed JSON body. */
type RouteHandler = (params: Record<string, string>, body: unknown) => InternalServicesStubResponse;

type StoredQuote = Record<string, unknown> & { workOrderId: string };

const internalError: InternalServicesStubResponse = {
  status: 500,
  body: { statusCode: 500, error: 'Internal Server Error', message: 'Erro interno' },
};

const notFound = (name: string, id: string): InternalServicesStubResponse => ({
  status: 404,
  body: {
    statusCode: 404,
    error: 'Not Found',
    message: `${name} não encontrado(a) com identificador: ${id}`,
  },
});

const found = (data: object | undefined, name: string, id: string): InternalServicesStubResponse =>
  data ? { status: 200, body: { data } } : notFound(name, id);

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }

  const text = Buffer.concat(chunks).toString('utf8');

  return text ? JSON.parse(text) : undefined;
}

function inventoryRoutes(
  services: Map<string, object>,
  partsSupplies: Map<string, object>,
): Record<string, RouteHandler> {
  return {
    'GET /internal/services/:id': ({ id }) => found(services.get(id), 'Serviço', id),
    'GET /internal/parts-supplies/:id': ({ id }) => found(partsSupplies.get(id), 'Peça/Insumo', id),
  };
}

function billingRoutes(quotes: Map<string, object>): Record<string, RouteHandler> {
  return {
    'POST /internal/quotes': (_params, body) => createQuote(quotes, body),
    'GET /internal/quotes/:id': ({ id }) => found(quotes.get(id), 'Orçamento', id),
    'DELETE /internal/quotes/:id': ({ id }) =>
      quotes.delete(id) ? { status: 204 } : notFound('Orçamento', id),
    'POST /internal/quotes/:id/decisions': ({ id }, body) => decideQuote(quotes, id, body),
    'GET /internal/work-orders/:workOrderId/quotes': ({ workOrderId }) =>
      listWorkOrderQuotes(quotes, workOrderId),
    // Settled by default: the full lifecycles deliver the work order.
    'GET /internal/work-orders/:workOrderId/balance': () => {
      const { approvedTotal } = readInternalWorkOrderBalanceFixture().data;

      return {
        status: 200,
        body: { data: { approvedTotal, paidTotal: approvedTotal, balance: '0.00' } },
      };
    },
    'GET /internal/work-orders/:workOrderId/payments': ({ workOrderId }) => ({
      status: 200,
      body: {
        data: readInternalWorkOrderPaymentsFixture().data.map((payment) => ({
          ...payment,
          workOrderId,
        })),
      },
    }),
  };
}

function createQuote(quotes: Map<string, object>, body: unknown): InternalServicesStubResponse {
  const { workOrderId } = body as { workOrderId: string };
  const quote = { ...readInternalQuoteSummaryFixture().data, id: randomUUID(), workOrderId };

  quotes.set(quote.id, { ...quote, services: [], partsSupplies: [] });

  return { status: 201, body: { data: quote } };
}

function decideQuote(
  quotes: Map<string, object>,
  id: string,
  body: unknown,
): InternalServicesStubResponse {
  const quote = quotes.get(id);

  if (quote === undefined) {
    return notFound('Orçamento', id);
  }

  const { action, decidedBy } = body as { action: string; decidedBy: string };
  const decided = { ...quote, status: action === 'approve' ? 'APPROVED' : 'REJECTED', decidedBy };

  quotes.set(id, decided);

  return { status: 200, body: { data: decided } };
}

function listWorkOrderQuotes(
  quotes: Map<string, object>,
  workOrderId: string,
): InternalServicesStubResponse {
  const summaries = ([...quotes.values()] as StoredQuote[])
    .filter((quote) => quote.workOrderId === workOrderId)
    .map(({ services: _services, partsSupplies: _partsSupplies, ...summary }) => summary);

  return { status: 200, body: { data: summaries } };
}

function identityRoutes(
  users: Map<string, object>,
  customerUsers: InternalServicesStub['customerUsers'],
): Record<string, RouteHandler> {
  return {
    'GET /internal/users/:id': ({ id }) => found(users.get(id), 'Usuário', id),
    'POST /internal/customer-users': (_params, body) => {
      customerUsers.calls.push(body as object);

      return customerUsers.response;
    },
  };
}

/** Serves the Inventory catalog, the Billing quote and payment and the Identity user internal routes. */
export async function startInternalServicesStub(): Promise<InternalServicesStub> {
  const services = new Map<string, object>();
  const partsSupplies = new Map<string, object>();
  const quotes = new Map<string, object>();
  const users = new Map<string, object>();
  const customerUsers: InternalServicesStub['customerUsers'] = {
    calls: [],
    response: { status: 200, body: { data: readInternalCustomerUserFixture().data } },
  };
  const failingIds = new Set<string>();
  const nextResponses = new Map<string, InternalServicesStubResponse>();

  const routes = Object.entries({
    ...inventoryRoutes(services, partsSupplies),
    ...billingRoutes(quotes),
    ...identityRoutes(users, customerUsers),
  }).map(([route, handle]) => {
    const [method, pathname] = route.split(' ');

    return { method, pattern: new URLPattern({ pathname }), handle };
  });

  const answer = (method: string, path: string, body: unknown): InternalServicesStubResponse => {
    const { pathname } = new URL(path, 'http://localhost');

    for (const route of routes) {
      const match = route.method === method ? route.pattern.exec({ pathname }) : null;

      if (match) {
        // Every param is a required ":name" segment, so a match always captures it.
        const params = match.pathname.groups as Record<string, string>;

        return failingIds.has(params.id) ? internalError : route.handle(params, body);
      }
    }

    return notFound('Recurso', path);
  };

  const server = createServer((req, res) => {
    void readBody(req).then((body) => {
      const method = req.method ?? 'GET';
      const path = req.url ?? '/';
      const key = `${method} ${path}`;
      const response = nextResponses.get(key) ?? answer(method, path, body);

      nextResponses.delete(key);

      res.writeHead(response.status, { 'content-type': 'application/json' });
      res.end(response.body && JSON.stringify(response.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    services,
    partsSupplies,
    quotes,
    users,
    customerUsers,
    failingIds,
    nextResponses,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export function stubService(
  stub: InternalServicesStub,
  overrides: { basePrice?: number; name?: string } = {},
): { id: string; name: string; basePrice: number } {
  const service = { ...readInternalServiceFixture().data, id: randomUUID(), ...overrides };

  stub.services.set(service.id, service);

  return service;
}

export function stubPartSupply(
  stub: InternalServicesStub,
  overrides: { salePrice?: number } = {},
): { id: string; name: string; salePrice: number } {
  const partSupply = { ...readInternalPartSupplyFixture().data, id: randomUUID(), ...overrides };

  stub.partsSupplies.set(partSupply.id, partSupply);

  return partSupply;
}

export function stubIdentityUser(
  stub: InternalServicesStub,
  overrides: Partial<IdentityUserGatewayResponse> = {},
): IdentityUserGatewayResponse {
  const user = { ...readInternalUserFixture().data, id: randomUUID(), ...overrides };

  stub.users.set(user.id, user);

  return user;
}

/**
 * Makes the identity answer `POST /internal/customer-users` with a new customer user.
 */
export function stubCustomerUser(stub: InternalServicesStub): IdentityUserGatewayResponse {
  const user = stubIdentityUser(stub, { role: null, email: `${randomUUID()}@e2e.test` });

  stub.customerUsers.response = { status: 200, body: { data: { userId: user.id, created: true } } };

  return user;
}
