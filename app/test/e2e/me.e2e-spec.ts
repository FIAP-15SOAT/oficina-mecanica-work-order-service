import type { Server } from 'http';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { TestContext, setupTestApp, teardownTestApp } from '../helpers/test-app.helper';
import { cleanDatabase } from '../helpers/db-cleanup.helper';
import { AuthTokens, registerAndLogin } from '../helpers/auth.helper';
import { signTestCustomerToken } from '../helpers/customer-jwt.helper';

describe('Me (E2E)', () => {
  let ctx: TestContext;
  let httpServer: Server;
  let adminAuth: AuthTokens;

  beforeAll(async () => {
    ctx = await setupTestApp();
    httpServer = ctx.httpServer;
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  beforeEach(async () => {
    await cleanDatabase(ctx.prisma);
    adminAuth = await registerAndLogin(
      httpServer,
      {
        name: 'Admin E2E',
        email: 'admin-me@e2e.test',
        role: 'ADMIN',
      },
      ctx.prisma,
    );
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
   * Gera um CNPJ com dígitos verificadores válidos (mesmo algoritmo de
   * `DocumentValidator.validateCnpj`), para cenários com cliente COMPANY.
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
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
      .send({
        name: `Cliente Teste ${id}`,
        document: generateCPF(id),
        type: 'INDIVIDUAL',
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
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
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
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
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
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
      .send({ customerId, vehicleId, problemDescription: 'Barulho no motor' })
      .expect(201);
    return res.body.data as { id: string; number: string; status: string };
  }

  /**
   * Cria diretamente via Prisma um usuário puramente externo (role null, com
   * CPF) já vinculado a um cliente ativo — equivalente ao resultado de
   * `POST /api/customers/:customerId/users`, mas sem depender do fluxo
   * de e-mail de senha inicial, que é irrelevante para este teste.
   */
  async function createExternalUserLinkedTo(customerId: string, cpf: string) {
    const passwordHash = await bcrypt.hash('External@123', 10);
    const user = await ctx.prisma.user.create({
      data: {
        name: `Cliente Externo ${cpf}`,
        email: `externo-${cpf}@e2e.test`,
        cpf,
        passwordHash,
        role: null,
        isActive: true,
      },
    });

    await ctx.prisma.userCustomer.create({
      data: { userId: user.id, customerId },
    });

    return user;
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
     * `page` e `limit` chegam como texto na query string: sem a conversão do
     * `@Type(() => Number)` o `IsInt` recusaria toda requisição paginada.
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
  });

  // ─── Token de cliente fora da área do cliente ───────────────────────────────

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

  // ─── Recursos inexistentes nas rotas externas ───────────────────────────────

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

  // ─── PATCH /api/me/password ─────────────────────────────────────────────────

  describe('PATCH /api/me/password', () => {
    it('should let an externally authenticated user change their own password', async () => {
      const customer = await createCustomer();
      const user = await createExternalUserLinkedTo(customer.id, generateCPF(4000));
      const token = signTestCustomerToken(user.id);

      await request(httpServer)
        .patch('/api/me/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'External@123', newPassword: 'NovaSenha@456' })
        .expect(204);

      const updated = await ctx.prisma.user.findUnique({ where: { id: user.id } });
      expect(await bcrypt.compare('NovaSenha@456', updated!.passwordHash)).toBe(true);
    });

    it('rejects an external token issued before an authenticated password change', async () => {
      const customer = await createCustomer();
      const user = await createExternalUserLinkedTo(customer.id, generateCPF(4001));
      const tokenIssuedBeforeChange = signTestCustomerToken(user.id);

      // iat tem granularidade de segundo; garante que a troca cai num segundo
      // seguinte ao da assinatura, para não colidir por arredondamento.
      await new Promise((resolve) => setTimeout(resolve, 1100));

      await request(httpServer)
        .patch('/api/me/password')
        .set('Authorization', `Bearer ${tokenIssuedBeforeChange}`)
        .send({ currentPassword: 'External@123', newPassword: 'NovaSenha@456' })
        .expect(204);

      await request(httpServer)
        .get('/api/me/work-orders')
        .set('Authorization', `Bearer ${tokenIssuedBeforeChange}`)
        .expect(401);
    });

    it('should let an internally authenticated user change their own password', async () => {
      await request(httpServer)
        .patch('/api/me/password')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ currentPassword: 'Test@2026', newPassword: 'NovaSenha@456' })
        .expect(204);

      const updated = await ctx.prisma.user.findUnique({ where: { id: adminAuth.user.id } });
      expect(await bcrypt.compare('NovaSenha@456', updated!.passwordHash)).toBe(true);
    });

    it('should return 401 when the current password is wrong', async () => {
      await request(httpServer)
        .patch('/api/me/password')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ currentPassword: 'SenhaErrada@000', newPassword: 'NovaSenha@456' })
        .expect(401);
    });

    it('should return 422 when the new password does not meet the policy', async () => {
      await request(httpServer)
        .patch('/api/me/password')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ currentPassword: 'Test@2026', newPassword: 'fracasenha' })
        .expect(422);
    });

    it('should return 409 when the new password equals the current one', async () => {
      await request(httpServer)
        .patch('/api/me/password')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ currentPassword: 'Test@2026', newPassword: 'Test@2026' })
        .expect(409);
    });

    it('should return 401 without any token', async () => {
      await request(httpServer)
        .patch('/api/me/password')
        .send({ currentPassword: 'Test@2026', newPassword: 'NovaSenha@456' })
        .expect(401);
    });
  });

  // ─── Full external customer flow: CPF login → /api/me → quote decision ───

  describe('Full external customer flow — CPF login → /api/me → quote decision', () => {
    it('lets an externally authenticated user with an INDIVIDUAL and a COMPANY customer see both, scopes work-order/quote access to their own customers, and decides a quote', async () => {
      const customerA = await createCustomer();
      const customerB = await createCompanyCustomer();
      const otherCustomer = await createCustomer();

      const externalUser = await createExternalUserLinkedTo(customerA.id, generateCPF(2000));

      // Segundo vínculo via API real (não Prisma direto): mesmo CPF de
      // externalUser reaproveita o User existente em vez de criar um novo,
      // provando o comportamento de GrantCustomerAccessUseCase de ponta a
      // ponta — não só a leitura de /api/me sobre um estado montado à mão.
      await request(httpServer)
        .post(`/api/customers/${customerB.id}/users`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
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
      const quote = await ctx.prisma.quote.create({
        data: { workOrderId: workOrderA.id, status: 'SENT', servicesAmount: 100, totalAmount: 100 },
      });

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

      // GET /api/me — identity of an external (role null) user linked to both customers
      const meResponse = await request(httpServer)
        .get('/api/me')
        .set('Authorization', `Bearer ${externalToken}`);

      expect(meResponse.status).toBe(200);
      expect(meResponse.body.data.role).toBeNull();
      expect(meResponse.body.data.customers).toHaveLength(1);
      expect(meResponse.body.data.customers.map((c: { type: string }) => c.type)).toEqual([
        'COMPANY',
      ]);

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
        .set('Authorization', `Bearer ${adminAuth.accessToken}`);

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

      // Deciding again on an already-decided quote is rejected as a business rule violation
      const secondDecisionResponse = await request(httpServer)
        .post(`/api/me/quotes/${quote.id}/decisions`)
        .set('Authorization', `Bearer ${externalToken}`)
        .send({ action: 'reject', reason: 'tarde demais' });

      expect(secondDecisionResponse.status).toBe(409);
    });

    /**
     * A listagem de orçamentos de uma OS (`findByWorkOrderId`) não carrega os
     * itens de propósito — mas o detalhe (`GET /:quoteId`) e a decisão
     * (`POST /:quoteId/decisions`, tanto approve quanto reject) precisam
     * devolver os itens com o nome real do serviço/peça, nunca em branco.
     */
    it('returns quote items with real names on detail and on both decision outcomes, and omits items from the list', async () => {
      const customer = await createCustomer();
      const user = await createExternalUserLinkedTo(customer.id, generateCPF(2100));
      const vehicle = await createVehicle(customer.id);
      const workOrder = await ctx.prisma.workOrder.create({
        data: {
          number: '900101',
          customerId: customer.id,
          vehicleId: vehicle.id,
          status: 'AWAITING_APPROVAL',
        },
      });

      const serviceRes = await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: 'Troca de óleo', basePrice: 100, estimatedTimeMin: 60 })
        .expect(201);
      const partSupplyRes = await request(httpServer)
        .post('/api/parts-supplies')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          name: 'Filtro de óleo',
          sku: `FO-${Date.now()}`,
          category: 'PART',
          unit: 'UN',
          costPrice: 10,
          salePrice: 30,
          stock: 10,
          minStock: 2,
        })
        .expect(201);

      const quote = await ctx.prisma.quote.create({
        data: { workOrderId: workOrder.id, status: 'SENT', totalAmount: 130 },
      });
      await ctx.prisma.quoteService.create({
        data: {
          quoteId: quote.id,
          serviceId: serviceRes.body.data.id,
          quantity: 1,
          unitPrice: 100,
          totalPrice: 100,
        },
      });
      await ctx.prisma.quotePartSupply.create({
        data: {
          quoteId: quote.id,
          partSupplyId: partSupplyRes.body.data.id,
          quantity: 1,
          unitPrice: 30,
          totalPrice: 30,
        },
      });

      const token = signTestCustomerToken(user.id);

      const listResponse = await request(httpServer)
        .get(`/api/me/work-orders/${workOrder.id}/quotes`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(listResponse.body.data).toHaveLength(1);
      expect(listResponse.body.data[0]).not.toHaveProperty('services');
      expect(listResponse.body.data[0]).not.toHaveProperty('partsSupplies');

      const detailResponse = await request(httpServer)
        .get(`/api/me/quotes/${quote.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(detailResponse.body.data.services).toEqual([
        expect.objectContaining({ name: 'Troca de óleo' }),
      ]);
      expect(detailResponse.body.data.partsSupplies).toEqual([
        expect.objectContaining({ name: 'Filtro de óleo' }),
      ]);

      const rejectResponse = await request(httpServer)
        .post(`/api/me/quotes/${quote.id}/decisions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ action: 'reject', reason: 'Preço muito alto' })
        .expect(200);

      expect(rejectResponse.body.data.status).toBe('REJECTED');
      expect(rejectResponse.body.data.services).toEqual([
        expect.objectContaining({ name: 'Troca de óleo' }),
      ]);
      expect(rejectResponse.body.data.partsSupplies).toEqual([
        expect.objectContaining({ name: 'Filtro de óleo' }),
      ]);
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
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
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
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ isActive: false })
        .expect(204);

      const afterDeactivation = await request(httpServer)
        .get('/api/me/work-orders')
        .set('Authorization', `Bearer ${token}`);
      expect(afterDeactivation.status).toBe(401);
    });
  });
});
