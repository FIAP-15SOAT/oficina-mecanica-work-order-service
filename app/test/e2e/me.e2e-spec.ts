import type { Server } from 'http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { sign } from 'jsonwebtoken';
import { TestContext, setupTestApp, teardownTestApp } from '../helpers/test-app.helper';
import { cleanDatabase } from '../helpers/db-cleanup.helper';
import { StaffUser, createStaffUser } from '../helpers/auth.helper';
import {
  CUSTOMER_JWT_TEST_AUDIENCE,
  CUSTOMER_JWT_TEST_ISSUER,
  CUSTOMER_JWT_TEST_PRIVATE_KEY,
  signTestCustomerToken,
} from '../helpers/customer-jwt.helper';
import {
  InternalServicesStub,
  startInternalServicesStub,
  stubIdentityUser,
} from '../helpers/internal-services-stub';
import { readInternalQuoteFixture } from '../helpers/billing-quotes-gateway-mock.factory';
import { readInternalWorkOrderPaymentsFixture } from '../helpers/billing-payments-gateway-mock.factory';

describe('Me (E2E)', () => {
  let ctx: TestContext;
  let httpServer: Server;
  let adminAuth: StaffUser;

  let stub: InternalServicesStub;

  beforeAll(async () => {
    stub = await startInternalServicesStub();
    ctx = await setupTestApp({ internalServicesUrl: stub.url });
    httpServer = ctx.httpServer;
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
    await stub.close();
  });

  beforeEach(async () => {
    await cleanDatabase(ctx.prisma);
    adminAuth = createStaffUser({ stub }, { name: 'Admin E2E' });
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────

  let customerCounter = 0;
  function generateCPF(index: number) {
    const base = index.toString().padStart(9, '0');
    const n = base.split('').map(Number);
    let d1 = n.reduce((acc, v, i) => acc + v * (10 - i), 0);
    d1 = 11 - (d1 % 11);
    if (d1 >= 10) d1 = 0;
    n.push(d1);
    let d2 = n.reduce((acc, v, i) => acc + v * (11 - i), 0);
    d2 = 11 - (d2 % 11);
    if (d2 >= 10) d2 = 0;
    n.push(d2);
    return n.join('');
  }

  /**
   * Generates a CNPJ with valid check digits (same algorithm as
   * `DocumentValidator.validateCnpj`), for scenarios with a COMPANY customer.
   */
  function generateCNPJ(index: number) {
    const base = `${index.toString().padStart(8, '0')}0001`.split('').map(Number);
    const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let d1 = base.reduce((acc, v, i) => acc + v * w1[i], 0) % 11;
    d1 = d1 < 2 ? 0 : 11 - d1;
    const withD1 = [...base, d1];
    const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let d2 = withD1.reduce((acc, v, i) => acc + v * w2[i], 0) % 11;
    d2 = d2 < 2 ? 0 : 11 - d2;
    return [...withD1, d2].join('');
  }

  async function createCustomer() {
    const id = ++customerCounter;
    const res = await request(httpServer)
      .post('/api/customers')
      .set('Authorization', adminAuth.authorization)
      .send({
        name: `Cliente Teste ${id}`,
        document: generateCPF(id),
        type: 'INDIVIDUAL',
        createAccess: false,
        email: `cliente-me-${Date.now()}${id}@test.com`,
        phone: '11999999999',
        address: {
          street: 'Rua Teste, 123',
          city: 'São Paulo',
          state: 'SP',
          zipCode: '01310-100',
        },
      })
      .expect(201);
    return res.body.data as { id: string };
  }

  async function createCompanyCustomer() {
    const id = ++customerCounter;
    const res = await request(httpServer)
      .post('/api/customers')
      .set('Authorization', adminAuth.authorization)
      .send({
        name: `Empresa Teste ${id} LTDA`,
        document: generateCNPJ(id),
        type: 'COMPANY',
        email: `empresa-me-${Date.now()}${id}@test.com`,
        phone: '11999999999',
        address: {
          street: 'Av. Teste, 456',
          city: 'São Paulo',
          state: 'SP',
          zipCode: '01310-100',
        },
        createAccess: false,
      })
      .expect(201);
    return res.body.data as { id: string };
  }

  async function createVehicle(customerId: string) {
    const res = await request(httpServer)
      .post('/api/vehicles')
      .set('Authorization', adminAuth.authorization)
      .send({
        customerId,
        plate: `ABC-${Date.now().toString().slice(-4)}`,
        brand: 'Toyota',
        model: 'Corolla',
        year: 2020,
      })
      .expect(201);
    return res.body.data as { id: string };
  }

  async function createWorkOrder(customerId: string, vehicleId: string) {
    const res = await request(httpServer)
      .post('/api/work-orders')
      .set('Authorization', adminAuth.authorization)
      .send({ customerId, vehicleId, problemDescription: 'Barulho no motor' })
      .expect(201);
    return res.body.data as { id: string; number: string; status: string };
  }

  /**
   * Creates an external user known to the Identity stub (role null, with a CPF) and links it
   * to an active customer, like `POST /api/customers/:customerId/users` does.
   */
  async function createExternalUserLinkedTo(customerId: string, cpf: string) {
    const user = stubIdentityUser(stub, {
      name: `Cliente Externo ${cpf}`,
      email: `externo-${cpf}@e2e.test`,
      role: null,
    });

    await ctx.prisma.userCustomer.create({
      data: { userId: user.id, customerId },
    });

    return { ...user, cpf };
  }

  // ─── GET /api/me/work-orders ────────────────────────────────────────────────

  describe('GET /api/me/work-orders', () => {
    it("should not leak another customer's work orders when customerId is not authorized for the caller", async () => {
      const customerA = await createCustomer();
      const customerB = await createCustomer();
      const vehicleA = await createVehicle(customerA.id);
      const vehicleB = await createVehicle(customerB.id);

      await createWorkOrder(customerA.id, vehicleA.id);
      await createWorkOrder(customerB.id, vehicleB.id);

      const userA = await createExternalUserLinkedTo(customerA.id, generateCPF(1000));
      const tokenA = signTestCustomerToken(userA.id);

      const res = await request(httpServer)
        .get(`/api/me/work-orders?customerId=${customerB.id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.totalRecords).toBe(0);
    });

    it("should return only the caller's own work orders when no customerId filter is given", async () => {
      const customerA = await createCustomer();
      const customerB = await createCustomer();
      const vehicleA = await createVehicle(customerA.id);
      const vehicleB = await createVehicle(customerB.id);

      const workOrderA = await createWorkOrder(customerA.id, vehicleA.id);
      await createWorkOrder(customerB.id, vehicleB.id);

      const userA = await createExternalUserLinkedTo(customerA.id, generateCPF(1001));
      const tokenA = signTestCustomerToken(userA.id);

      const res = await request(httpServer)
        .get('/api/me/work-orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(workOrderA.id);
      expect(res.body.pagination.totalRecords).toBe(1);
    });

    /**
     * `page` and `limit` arrive as text in the query string: without the
     * `@Type(() => Number)` conversion, `IsInt` would refuse every paginated request.
     */
    it('should paginate with the page and limit given in the query string', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      await createWorkOrder(customer.id, vehicle.id);
      await createWorkOrder(customer.id, vehicle.id);

      const user = await createExternalUserLinkedTo(customer.id, generateCPF(1002));
      const token = signTestCustomerToken(user.id);

      const res = await request(httpServer)
        .get('/api/me/work-orders?page=2&limit=1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.pagination).toMatchObject({ page: 2, limit: 1, totalRecords: 2 });
    });

    it('should return 401 when the token has no active linked customer', async () => {
      await request(httpServer)
        .get(`/api/me/work-orders?customerId=${randomUUID()}`)
        .set('Authorization', `Bearer ${signTestCustomerToken(randomUUID())}`)
        .expect(401);
    });

    it('should return 401 to a token without sub even when other users have active links', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      await createWorkOrder(customer.id, vehicle.id);
      await createExternalUserLinkedTo(customer.id, generateCPF(1003));

      const token = sign({}, CUSTOMER_JWT_TEST_PRIVATE_KEY, {
        algorithm: 'RS256',
        issuer: CUSTOMER_JWT_TEST_ISSUER,
        audience: CUSTOMER_JWT_TEST_AUDIENCE,
        expiresIn: 3600,
      });

      await request(httpServer)
        .get('/api/me/work-orders')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });
  });

  // ─── Customer token outside the customer area ───────────────────────────────

  describe('Customer token outside the customer area', () => {
    it('should answer 401 to a customer token on a staff route', async () => {
      const customer = await createCustomer();
      const user = await createExternalUserLinkedTo(customer.id, generateCPF(6000));

      await request(httpServer)
        .get('/api/customers')
        .set('Authorization', `Bearer ${signTestCustomerToken(user.id)}`)
        .expect(401);
    });
  });

  // ─── Unknown resources on the external routes ───────────────────────────────

  describe('Unknown resources on the external routes', () => {
    let token: string;

    beforeEach(async () => {
      const customer = await createCustomer();
      const user = await createExternalUserLinkedTo(customer.id, generateCPF(5000));
      token = signTestCustomerToken(user.id);
    });

    it('should return 404 for an unknown work order', async () => {
      await request(httpServer)
        .get(`/api/me/work-orders/${randomUUID()}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should return 404 when listing quotes of an unknown work order', async () => {
      await request(httpServer)
        .get(`/api/me/work-orders/${randomUUID()}/quotes`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should return 404 for an unknown quote', async () => {
      await request(httpServer)
        .get(`/api/me/quotes/${randomUUID()}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should return 404 when deciding an unknown quote', async () => {
      await request(httpServer)
        .post(`/api/me/quotes/${randomUUID()}/decisions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ action: 'approve' })
        .expect(404);
    });
  });

  // ─── Full external customer flow: linked customers → quote decision ───

  describe('Full external customer flow — linked customers → quote decision', () => {
    it('should let an externally authenticated user with an INDIVIDUAL and a COMPANY customer see both, scope work-order/quote access to their own customers, and decide a quote', async () => {
      const customerA = await createCustomer();
      const customerB = await createCompanyCustomer();
      const otherCustomer = await createCustomer();

      const externalUser = await createExternalUserLinkedTo(customerA.id, generateCPF(2000));

      // Second link through the real API (not Prisma directly): the identity answers with the
      // user it already has for this CPF, so the grant links externalUser instead of a new user.
      stubIdentityUser(stub, {
        id: externalUser.id,
        name: externalUser.name,
        email: externalUser.email,
        role: null,
      });
      stub.customerUsers.response = {
        status: 200,
        body: { data: { userId: externalUser.id, created: false } },
      };

      await request(httpServer)
        .post(`/api/customers/${customerB.id}/users`)
        .set('Authorization', adminAuth.authorization)
        .send({ name: externalUser.name, email: externalUser.email, cpf: externalUser.cpf })
        .expect(201);

      const vehicle = await ctx.prisma.vehicle.create({
        data: {
          customerId: customerA.id,
          plate: 'ABC1D23',
          brand: 'Fiat',
          model: 'Uno',
          year: 2015,
        },
      });

      const workOrderA = await ctx.prisma.workOrder.create({
        data: {
          number: '900001',
          customerId: customerA.id,
          vehicleId: vehicle.id,
          status: 'AWAITING_APPROVAL',
        },
      });

      const quote = {
        ...readInternalQuoteFixture().data,
        id: randomUUID(),
        workOrderId: workOrderA.id,
      };

      stub.quotes.set(quote.id, { ...quote, status: 'SENT' });

      const otherVehicle = await ctx.prisma.vehicle.create({
        data: {
          customerId: otherCustomer.id,
          plate: 'ZZZ9Z99',
          brand: 'VW',
          model: 'Gol',
          year: 2018,
        },
      });
      const notLinkedWorkOrder = await ctx.prisma.workOrder.create({
        data: {
          number: '900002',
          customerId: otherCustomer.id,
          vehicleId: otherVehicle.id,
          status: 'RECEIVED',
        },
      });

      const externalToken = signTestCustomerToken(externalUser.id);

      // GET /api/me/work-orders — only the caller's own linked-customer work orders
      const workOrdersResponse = await request(httpServer)
        .get('/api/me/work-orders')
        .set('Authorization', `Bearer ${externalToken}`);

      expect(workOrdersResponse.status).toBe(200);
      const workOrderIds = workOrdersResponse.body.data.map((wo: { id: string }) => wo.id);
      expect(workOrderIds).toContain(workOrderA.id);
      expect(workOrderIds).not.toContain(notLinkedWorkOrder.id);

      // Each work order identifies which of the caller's two linked customers
      // it belongs to — the actual point of this fix: an operator representing
      // more than one company can tell them apart without guessing from plate/model.
      const ownWorkOrderInList = workOrdersResponse.body.data.find(
        (wo: { id: string }) => wo.id === workOrderA.id,
      );
      expect(ownWorkOrderInList.customer.id).toBe(customerA.id);

      // Filtering by a customerId the caller is not authorized for yields an empty page, not an error
      const scopedFilterResponse = await request(httpServer)
        .get(`/api/me/work-orders?customerId=${otherCustomer.id}`)
        .set('Authorization', `Bearer ${externalToken}`);

      expect(scopedFilterResponse.status).toBe(200);
      expect(scopedFilterResponse.body.data).toHaveLength(0);

      // GET /api/me/work-orders/:id on the caller's own work order succeeds
      const ownDetailResponse = await request(httpServer)
        .get(`/api/me/work-orders/${workOrderA.id}`)
        .set('Authorization', `Bearer ${externalToken}`);

      expect(ownDetailResponse.status).toBe(200);
      expect(ownDetailResponse.body.data.id).toBe(workOrderA.id);
      expect(ownDetailResponse.body.data.customer.id).toBe(customerA.id);

      // Cross-customer access to a work order the caller has no link to is a 404, not 403
      const crossAccessResponse = await request(httpServer)
        .get(`/api/me/work-orders/${notLinkedWorkOrder.id}`)
        .set('Authorization', `Bearer ${externalToken}`);

      expect(crossAccessResponse.status).toBe(404);

      // A staff token is rejected on the external-only route
      const internalTokenOnExternalRoute = await request(httpServer)
        .get('/api/me/work-orders')
        .set('Authorization', adminAuth.authorization);

      expect(internalTokenOnExternalRoute.status).toBe(401);

      // An external (RS256) token is rejected on an internal-only route
      const externalTokenOnInternalRoute = await request(httpServer)
        .get('/api/customers')
        .set('Authorization', `Bearer ${externalToken}`);

      expect(externalTokenOnInternalRoute.status).toBe(401);

      // POST /api/me/quotes/:id/decisions — approving a linked, still-SENT quote succeeds
      const decisionResponse = await request(httpServer)
        .post(`/api/me/quotes/${quote.id}/decisions`)
        .set('Authorization', `Bearer ${externalToken}`)
        .send({ action: 'approve', reason: null });

      expect(decisionResponse.status).toBe(200);
      expect(decisionResponse.body.data.status).toBe('APPROVED');
    });
  });

  // ─── Quotes read and decided in the Billing ─────────────────────────────────

  describe('Quotes and payments in the Billing', () => {
    let token: string;
    let userId: string;
    let workOrderId: string;
    let unlinkedWorkOrderId: string;

    beforeEach(async () => {
      const customer = await createCustomer();
      const otherCustomer = await createCustomer();
      const user = await createExternalUserLinkedTo(customer.id, generateCPF(2100));

      const vehicle = await ctx.prisma.vehicle.create({
        data: {
          customerId: customer.id,
          plate: 'BIL1A23',
          brand: 'Fiat',
          model: 'Uno',
          year: 2015,
        },
      });

      const otherVehicle = await ctx.prisma.vehicle.create({
        data: {
          customerId: otherCustomer.id,
          plate: 'BIL9Z99',
          brand: 'VW',
          model: 'Gol',
          year: 2018,
        },
      });

      const workOrder = await ctx.prisma.workOrder.create({
        data: {
          number: '900101',
          customerId: customer.id,
          vehicleId: vehicle.id,
          status: 'AWAITING_APPROVAL',
        },
      });

      const unlinkedWorkOrder = await ctx.prisma.workOrder.create({
        data: {
          number: '900102',
          customerId: otherCustomer.id,
          vehicleId: otherVehicle.id,
          status: 'AWAITING_APPROVAL',
        },
      });

      token = signTestCustomerToken(user.id);
      userId = user.id;
      workOrderId = workOrder.id;
      unlinkedWorkOrderId = unlinkedWorkOrder.id;
    });

    it('should list the quotes of a linked work order from the Billing', async () => {
      const quote = { ...readInternalQuoteFixture().data, id: randomUUID(), workOrderId };

      stub.quotes.set(quote.id, quote);

      const res = await request(httpServer)
        .get(`/api/me/work-orders/${workOrderId}/quotes`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data).toEqual([
        {
          id: quote.id,
          status: quote.status,
          servicesAmount: quote.servicesAmount,
          partsAmount: quote.partsAmount,
          totalAmount: quote.totalAmount,
          notes: quote.notes,
          sentAt: quote.sentAt,
          approvedAt: quote.approvedAt,
          rejectedAt: quote.rejectedAt,
        },
      ]);
    });

    it('should answer 404 for the quotes of an unlinked work order', async () => {
      await request(httpServer)
        .get(`/api/me/work-orders/${unlinkedWorkOrderId}/quotes`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should list the payments of a linked work order', async () => {
      const payments = readInternalWorkOrderPaymentsFixture().data;

      const res = await request(httpServer)
        .get(`/api/me/work-orders/${workOrderId}/payments`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data).toEqual(
        payments.map(({ id, amount, status, checkoutUrl, expiresAt, createdAt, updatedAt }) => ({
          id,
          amount,
          status,
          checkoutUrl,
          expiresAt,
          createdAt,
          updatedAt,
        })),
      );
    });

    it('should return 404 for a work order not linked to the customer', async () => {
      const paymentsRoute = `GET /internal/work-orders/${unlinkedWorkOrderId}/payments`;

      stub.nextResponses.set(paymentsRoute, { status: 500 });

      await request(httpServer)
        .get(`/api/me/work-orders/${unlinkedWorkOrderId}/payments`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      expect(stub.nextResponses.has(paymentsRoute)).toBe(true);
    });

    it('should answer 404 without quote data for a quote of an unlinked work order', async () => {
      const quote = {
        ...readInternalQuoteFixture().data,
        id: randomUUID(),
        workOrderId: unlinkedWorkOrderId,
        status: 'SENT',
      };

      stub.quotes.set(quote.id, quote);

      const detailResponse = await request(httpServer)
        .get(`/api/me/quotes/${quote.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      const decisionResponse = await request(httpServer)
        .post(`/api/me/quotes/${quote.id}/decisions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ action: 'approve' })
        .expect(404);

      expect(detailResponse.body).not.toHaveProperty('data');
      expect(decisionResponse.body).not.toHaveProperty('data');
      expect(stub.quotes.get(quote.id)).toEqual(quote);
    });

    it('should forward the approval to the Billing and answer its quote', async () => {
      const quote = { ...readInternalQuoteFixture().data, id: randomUUID(), workOrderId };

      stub.quotes.set(quote.id, { ...quote, status: 'SENT', decidedBy: null });

      const res = await request(httpServer)
        .post(`/api/me/quotes/${quote.id}/decisions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ action: 'approve' })
        .expect(200);

      expect(res.body.data).toMatchObject({
        id: quote.id,
        status: 'APPROVED',
        services: [expect.objectContaining({ name: quote.services[0].name })],
        partsSupplies: [expect.objectContaining({ name: quote.partsSupplies[0].name })],
      });

      expect(stub.quotes.get(quote.id)).toMatchObject({ status: 'APPROVED', decidedBy: userId });
    });

    it('should answer 409 without forwarding when a quote approval is in progress', async () => {
      const quote = {
        ...readInternalQuoteFixture().data,
        id: randomUUID(),
        workOrderId,
        status: 'SENT',
      };

      stub.quotes.set(quote.id, quote);

      await ctx.prisma.sagaInstance.create({
        data: {
          type: 'QUOTE_APPROVAL',
          correlationId: randomUUID(),
          workOrderId,
          status: 'RESERVING_STOCK',
        },
      });

      const res = await request(httpServer)
        .post(`/api/me/quotes/${quote.id}/decisions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ action: 'approve' })
        .expect(409);

      expect(res.body.message).toBe(
        'Ordem de serviço com aprovação de orçamento em andamento: aguarde a conclusão e tente novamente',
      );

      expect(stub.quotes.get(quote.id)).toEqual(quote);
    });

    it('should answer the Billing 409 on a concurrent decision', async () => {
      const quote = {
        ...readInternalQuoteFixture().data,
        id: randomUUID(),
        workOrderId,
        status: 'SENT',
      };

      const message = 'Orçamento só pode ser decidido no status SENT. Status atual: "APPROVED"';

      stub.quotes.set(quote.id, quote);
      stub.nextResponses.set(`POST /internal/quotes/${quote.id}/decisions`, {
        status: 409,
        body: { statusCode: 409, error: 'Conflict', message },
      });

      const res = await request(httpServer)
        .post(`/api/me/quotes/${quote.id}/decisions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ action: 'reject', reason: 'Preço muito alto' })
        .expect(409);

      expect(res.body.message).toBe(message);
      expect(stub.quotes.get(quote.id)).toEqual(quote);
    });
  });

  // ─── Immediate revocation / deactivation with a still-valid JWT ────────────

  describe('Immediate revocation and deactivation with a still-valid JWT', () => {
    it('should block access immediately after revoking a still-valid JWT', async () => {
      const customer = await createCustomer();
      const user = await createExternalUserLinkedTo(customer.id, generateCPF(3000));
      const token = signTestCustomerToken(user.id);

      const beforeRevoke = await request(httpServer)
        .get('/api/me/work-orders')
        .set('Authorization', `Bearer ${token}`);
      expect(beforeRevoke.status).toBe(200);

      await request(httpServer)
        .delete(`/api/customers/${customer.id}/users/${user.id}`)
        .set('Authorization', adminAuth.authorization)
        .expect(204);

      const afterRevoke = await request(httpServer)
        .get('/api/me/work-orders')
        .set('Authorization', `Bearer ${token}`);
      expect(afterRevoke.status).toBe(401);
    });

    it('should block access immediately after deactivating the customer with a still-valid JWT', async () => {
      const customer = await createCustomer();
      const user = await createExternalUserLinkedTo(customer.id, generateCPF(3001));
      const token = signTestCustomerToken(user.id);

      const beforeDeactivation = await request(httpServer)
        .get('/api/me/work-orders')
        .set('Authorization', `Bearer ${token}`);
      expect(beforeDeactivation.status).toBe(200);

      await request(httpServer)
        .patch(`/api/customers/${customer.id}`)
        .set('Authorization', adminAuth.authorization)
        .send({ isActive: false })
        .expect(204);

      const afterDeactivation = await request(httpServer)
        .get('/api/me/work-orders')
        .set('Authorization', `Bearer ${token}`);
      expect(afterDeactivation.status).toBe(401);
    });
  });
});
