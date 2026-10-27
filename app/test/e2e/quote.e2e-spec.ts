import type { Server } from 'http';
import type { StartedTestContainer } from 'testcontainers';
import request from 'supertest';
import { TestContext, setupTestApp, teardownTestApp } from '../helpers/test-app.helper';
import { cleanDatabase } from '../helpers/db-cleanup.helper';
import { AuthTokens, registerAndLogin } from '../helpers/auth.helper';

interface MailhogResponse {
  items: {
    To: { Mailbox: string; Domain: string }[];
    Content: { Body: string };
    Created: string;
  }[];
}

async function fetchLatestEmailBody(
  mailhogContainer: StartedTestContainer,
  toEmail: string,
): Promise<string> {
  const base = `http://${mailhogContainer.getHost()}:${mailhogContainer.getMappedPort(8025)}`;
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const res = await fetch(`${base}/api/v2/messages?limit=50`);
    const body = (await res.json()) as MailhogResponse;

    const matches = body.items.filter((item) =>
      item.To.some((to) => `${to.Mailbox}@${to.Domain}`.toLowerCase() === toEmail.toLowerCase()),
    );

    if (matches.length > 0) {
      matches.sort((a, b) => new Date(b.Created).getTime() - new Date(a.Created).getTime());
      return matches[0].Content.Body;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`No email found for ${toEmail}`);
}

describe('Quote (E2E)', () => {
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
        email: 'admin@e2e.test',
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
  async function createCustomer() {
    const id = ++customerCounter;
    const res = await request(httpServer)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
      .send({
        name: `Cliente Teste ${id}`,
        document: generateCPF(id),
        type: 'INDIVIDUAL',
        email: `cliente${Date.now()}${id}@test.com`,
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

  async function createCustomerWithoutAccess() {
    const id = ++customerCounter;
    const email = `cliente-sem-acesso-${Date.now()}${id}@test.com`;
    const res = await request(httpServer)
      .post('/api/customers')
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
      .send({
        name: `Cliente Sem Acesso ${id}`,
        document: generateCPF(id),
        type: 'INDIVIDUAL',
        email,
        phone: '11999999999',
        address: {
          street: 'Rua Teste, 123',
          city: 'São Paulo',
          state: 'SP',
          zipCode: '01310-100',
        },
        createAccess: false,
      })
      .expect(201);
    return { ...(res.body.data as { id: string }), email };
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

  async function createWorkOrderInDiagnosis() {
    const customer = await createCustomer();
    const vehicle = await createVehicle(customer.id);

    const woRes = await request(httpServer)
      .post('/api/work-orders')
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
      .send({ customerId: customer.id, vehicleId: vehicle.id, problemDescription: 'Revisão geral' })
      .expect(201);

    const wo = woRes.body.data as { id: string };

    await request(httpServer)
      .patch(`/api/work-orders/${wo.id}`)
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
      .send({ status: 'IN_DIAGNOSIS' })
      .expect(200);

    return { workOrderId: wo.id, customer, vehicle };
  }

  async function createService() {
    const res = await request(httpServer)
      .post('/api/services')
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
      .send({
        name: `Troca de óleo ${Date.now()}`,
        description: 'Troca de óleo do motor',
        basePrice: 150,
        estimatedTimeMin: 30,
      })
      .expect(201);
    return res.body.data as { id: string };
  }

  async function createPartSupply() {
    const res = await request(httpServer)
      .post('/api/parts-supplies')
      .set('Authorization', `Bearer ${adminAuth.accessToken}`)
      .send({
        name: `Filtro de Óleo ${Date.now()}`,
        sku: `FILT-OL-${Date.now()}`,
        category: 'PART',
        unit: 'UN',
        costPrice: 25,
        salePrice: 45,
        stock: 50,
        minStock: 5,
      })
      .expect(201);
    return res.body.data as { id: string };
  }

  // ─── POST /api/quotes ────────────────────────────────────────────────────────

  describe('POST /api/quotes', () => {
    it('should create a quote for an IN_DIAGNOSIS work order', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();

      const res = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      expect(res.body.data).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          workOrder: expect.objectContaining({ id: workOrderId }),
          status: 'PENDING',
          totalAmount: 0,
        }),
      );
    });

    it('should return 409 when work order is RECEIVED', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const woRes = await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ customerId: customer.id, vehicleId: vehicle.id })
        .expect(201);

      await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId: woRes.body.data.id })
        .expect(409);
    });

    it('should return 404 when work order does not exist', async () => {
      await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
        .expect(404);
    });

    it('should return 400 when notes exceed the maximum length', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();

      await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId, notes: 'a'.repeat(2001) })
        .expect(400);
    });

    it('should return 400 when workOrderId is not a valid UUID', async () => {
      await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId: 'not-a-uuid' })
        .expect(400);
    });

    it('should create a quote with inline services and parts and return it with items', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const service = await createService();
      const part = await createPartSupply();

      const res = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          workOrderId,
          services: [{ serviceId: service.id, quantity: 2 }],
          partsSupplies: [{ partSupplyId: part.id, quantity: 1 }],
        })
        .expect(201);

      expect(res.body.data.status).toBe('PENDING');
      expect(res.body.data.totalAmount).toBeGreaterThan(0);
    });

    it('should return 409 when parts-only payload (no service) is provided', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const part = await createPartSupply();

      await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          workOrderId,
          partsSupplies: [{ partSupplyId: part.id, quantity: 1 }],
        })
        .expect(409);
    });

    it('should create an empty PENDING quote when no items are provided (unchanged behavior)', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();

      const res = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      expect(res.body.data.status).toBe('PENDING');
      expect(res.body.data.totalAmount).toBe(0);
    });

    it('should still enforce the work order status gate when inline items are provided', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const service = await createService();

      const woRes = await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ customerId: customer.id, vehicleId: vehicle.id })
        .expect(201);

      await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          workOrderId: woRes.body.data.id,
          services: [{ serviceId: service.id, quantity: 1 }],
        })
        .expect(409);
    });

    it('should create a quote with services only (no parts) and return totalAmount > 0', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const service = await createService();

      const res = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          workOrderId,
          services: [{ serviceId: service.id, quantity: 1 }],
        })
        .expect(201);

      expect(res.body.data.status).toBe('PENDING');
      expect(res.body.data.totalAmount).toBeGreaterThan(0);
      expect(res.body.data.partsAmount).toBe(0);
    });

    it('should return 404 when an inline serviceId does not exist', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();

      await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          workOrderId,
          services: [{ serviceId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', quantity: 1 }],
        })
        .expect(404);
    });

    it('should return 404 when an inline partSupplyId does not exist', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const service = await createService();

      await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          workOrderId,
          services: [{ serviceId: service.id, quantity: 1 }],
          partsSupplies: [{ partSupplyId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', quantity: 1 }],
        })
        .expect(404);
    });

    it('should return 409 when duplicate serviceId is provided in inline services', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const service = await createService();

      await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          workOrderId,
          services: [
            { serviceId: service.id, quantity: 1 },
            { serviceId: service.id, quantity: 2 },
          ],
        })
        .expect(409);
    });

    it('should return 409 when duplicate partSupplyId is provided in inline partsSupplies', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const service = await createService();
      const part = await createPartSupply();

      await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          workOrderId,
          services: [{ serviceId: service.id, quantity: 1 }],
          partsSupplies: [
            { partSupplyId: part.id, quantity: 1 },
            { partSupplyId: part.id, quantity: 2 },
          ],
        })
        .expect(409);
    });
  });

  // ─── GET /api/quotes/:id ─────────────────────────────────────────────────────

  describe('GET /api/quotes/:id', () => {
    it('should return a quote by id with workOrder object', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      const quoteId = createRes.body.data.id as string;

      const res = await request(httpServer)
        .get(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body.data.id).toBe(quoteId);
      expect(res.body.data.workOrder).toBeDefined();
      expect(res.body.data.workOrder.id).toBe(workOrderId);
      expect(res.body.data.workOrder.services).toBeUndefined();
      expect(res.body.data.workOrder.partSupplies).toBeUndefined();
      expect((res.body.data as Record<string, unknown>)['workOrderId']).toBeUndefined();
    });

    it('should return 404 for non-existent quote', async () => {
      await request(httpServer)
        .get('/api/quotes/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(404);
    });

    it('should return quote with populated services and partsSupplies arrays', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const service = await createService();
      const part = await createPartSupply();

      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);
      const quoteId = createRes.body.data.id as string;

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: service.id, quantity: 2 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/parts-supplies`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ partSupplyId: part.id, quantity: 3 })
        .expect(200);

      const res = await request(httpServer)
        .get(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body.data.services).toHaveLength(1);
      expect(res.body.data.partsSupplies).toHaveLength(1);
      expect(res.body.data.services[0].id).toBe(service.id);
      expect(res.body.data.services[0].name).toBeDefined();
      expect(res.body.data.services[0].quantity).toBe(2);
      expect(res.body.data.partsSupplies[0].id).toBe(part.id);
      expect(res.body.data.partsSupplies[0].name).toBeDefined();
      expect(res.body.data.partsSupplies[0].sku).toBeDefined();
      expect(res.body.data.partsSupplies[0].quantity).toBe(3);
    });
  });

  // ─── POST /api/quotes/:id/services ───────────────────────────────────────────

  describe('POST /api/quotes/:id/services', () => {
    it('should add a service to the quote', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const service = await createService();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      const quoteId = createRes.body.data.id as string;

      const res = await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: service.id, quantity: 1 })
        .expect(200);

      expect(res.body.data.servicesAmount).toBeGreaterThan(0);
      expect(res.body.data.totalAmount).toBeGreaterThan(0);
    });

    it('should return 409 when adding to a non-PENDING quote', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      const quoteId = createRes.body.data.id as string;

      // Add a service first, then submit to move to SENT
      const serviceForSubmit = await createService();
      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: serviceForSubmit.id, quantity: 1 })
        .expect(200);

      // Submit to move to SENT
      await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({})
        .expect(200);

      const service = await createService();
      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: service.id, quantity: 1 })
        .expect(409);
    });

    it('should return 404 when adding non-existent service', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      await request(httpServer)
        .post(`/api/quotes/${createRes.body.data.id}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', quantity: 1 })
        .expect(404);
    });

    it('should return 404 when quote does not exist', async () => {
      const service = await createService();
      await request(httpServer)
        .post(`/api/quotes/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: service.id, quantity: 1 })
        .expect(404);
    });

    it('should return 400 when quantity is zero', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const service = await createService();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      await request(httpServer)
        .post(`/api/quotes/${createRes.body.data.id}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: service.id, quantity: 0 })
        .expect(400);
    });

    it('should return 400 when serviceId is not a valid UUID', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      await request(httpServer)
        .post(`/api/quotes/${createRes.body.data.id}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: 'not-a-uuid', quantity: 1 })
        .expect(400);
    });

    it('should return 409 when service is already in the quote', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const service = await createService();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);
      const quoteId = createRes.body.data.id;

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: service.id, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: service.id, quantity: 1 })
        .expect(409);
    });
  });

  // ─── POST /api/quotes/:id/parts-supplies ──────────────────────────────────────────────

  describe('POST /api/quotes/:id/parts-supplies', () => {
    it('should add a part supply to the quote', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const part = await createPartSupply();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      const quoteId = createRes.body.data.id as string;

      const res = await request(httpServer)
        .post(`/api/quotes/${quoteId}/parts-supplies`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ partSupplyId: part.id, quantity: 2 })
        .expect(200);

      expect(res.body.data.partsAmount).toBeGreaterThan(0);
      expect(res.body.data.totalAmount).toBeGreaterThan(0);
    });

    it('should return 409 when adding to a non-PENDING quote', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      const quoteId = createRes.body.data.id as string;

      const serviceForSubmit = await createService();
      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: serviceForSubmit.id, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({})
        .expect(200);

      const part = await createPartSupply();
      await request(httpServer)
        .post(`/api/quotes/${quoteId}/parts-supplies`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ partSupplyId: part.id, quantity: 1 })
        .expect(409);
    });

    it('should return 404 when adding non-existent part supply', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      await request(httpServer)
        .post(`/api/quotes/${createRes.body.data.id}/parts-supplies`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ partSupplyId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', quantity: 1 })
        .expect(404);
    });

    it('should return 404 when quote does not exist', async () => {
      const part = await createPartSupply();
      await request(httpServer)
        .post(`/api/quotes/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/parts-supplies`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ partSupplyId: part.id, quantity: 1 })
        .expect(404);
    });

    it('should return 400 when quantity is zero', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const part = await createPartSupply();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      await request(httpServer)
        .post(`/api/quotes/${createRes.body.data.id}/parts-supplies`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ partSupplyId: part.id, quantity: 0 })
        .expect(400);
    });

    it('should return 400 when partSupplyId is not a valid UUID', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      await request(httpServer)
        .post(`/api/quotes/${createRes.body.data.id}/parts-supplies`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ partSupplyId: 'not-a-uuid', quantity: 1 })
        .expect(400);
    });

    it('should return 409 when part supply is already in the quote', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const part = await createPartSupply();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);
      const quoteId = createRes.body.data.id;

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/parts-supplies`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ partSupplyId: part.id, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/parts-supplies`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ partSupplyId: part.id, quantity: 1 })
        .expect(409);
    });
  });

  // ─── POST /api/quotes/:id/submissions ─────────────────────────────────────────────

  describe('POST /api/quotes/:id/submissions', () => {
    it('should submit a quote and transition work order to AWAITING_APPROVAL', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const service = await createService();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      const quoteId = createRes.body.data.id as string;

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: service.id, quantity: 1 })
        .expect(200);

      const res = await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({})
        .expect(200);

      expect(res.body.data.status).toBe('SENT');
    });

    /**
     * With no active external user linked, the recipient is the customer's own
     * e-mail and the text changes from "acesse o sistema" to "entre em contato
     * com a oficina" — sending access instructions to someone without access is
     * the defect this case prevents.
     */
    it('should notify the customer directly when nobody has external access', async () => {
      const customer = await createCustomerWithoutAccess();
      const vehicle = await createVehicle(customer.id);

      const woRes = await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          customerId: customer.id,
          vehicleId: vehicle.id,
          problemDescription: 'Revisão geral',
        })
        .expect(201);

      await request(httpServer)
        .patch(`/api/work-orders/${woRes.body.data.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_DIAGNOSIS' })
        .expect(200);

      const service = await createService();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId: woRes.body.data.id })
        .expect(201);

      await request(httpServer)
        .post(`/api/quotes/${createRes.body.data.id}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: service.id, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${createRes.body.data.id}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({})
        .expect(200);

      const body = await fetchLatestEmailBody(ctx.mailhogContainer, customer.email);

      expect(body).toContain('Entre em contato com a oficina');
      expect(body).not.toContain('Acesse o sistema');
    });

    it('should return 409 when submitting quote with no items', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      await request(httpServer)
        .post(`/api/quotes/${createRes.body.data.id}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({})
        .expect(409);
    });

    it('should transition work order from REJECTED back to AWAITING_APPROVAL when a new quote is submitted', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const firstService = await createService();
      const firstQuoteRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);
      const firstQuoteId = firstQuoteRes.body.data.id as string;

      await request(httpServer)
        .post(`/api/quotes/${firstQuoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: firstService.id, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${firstQuoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({})
        .expect(200);

      await request(httpServer)
        .patch(`/api/quotes/${firstQuoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'REJECTED', reason: 'Cliente pediu nova proposta' })
        .expect(200);

      const woAfterReject = await request(httpServer)
        .get(`/api/work-orders/${workOrderId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);
      expect(woAfterReject.body.data.status).toBe('REJECTED');

      const secondService = await createService();
      const secondQuoteRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);
      const secondQuoteId = secondQuoteRes.body.data.id as string;

      await request(httpServer)
        .post(`/api/quotes/${secondQuoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: secondService.id, quantity: 1 })
        .expect(200);

      const submissionRes = await request(httpServer)
        .post(`/api/quotes/${secondQuoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({})
        .expect(200);
      expect(submissionRes.body.data.status).toBe('SENT');

      const woAfterResubmit = await request(httpServer)
        .get(`/api/work-orders/${workOrderId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);
      expect(woAfterResubmit.body.data.status).toBe('AWAITING_APPROVAL');
    });

    it('should submit a second competing quote while AWAITING_APPROVAL without transitioning the work order', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();

      // First quote → submit → work order transitions to AWAITING_APPROVAL.
      const firstService = await createService();
      const firstQuoteRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);
      const firstQuoteId = firstQuoteRes.body.data.id as string;
      await request(httpServer)
        .post(`/api/quotes/${firstQuoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: firstService.id, quantity: 1 })
        .expect(200);
      await request(httpServer)
        .post(`/api/quotes/${firstQuoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({})
        .expect(200);

      // A second (competing) quote can be created AND submitted while the work
      // order is AWAITING_APPROVAL — the work order status is left unchanged.
      const secondService = await createService();
      const secondQuoteRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);
      const secondQuoteId = secondQuoteRes.body.data.id as string;
      await request(httpServer)
        .post(`/api/quotes/${secondQuoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: secondService.id, quantity: 1 })
        .expect(200);

      const submissionRes = await request(httpServer)
        .post(`/api/quotes/${secondQuoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({})
        .expect(200);
      expect(submissionRes.body.data.status).toBe('SENT');

      const wo = await request(httpServer)
        .get(`/api/work-orders/${workOrderId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);
      expect(wo.body.data.status).toBe('AWAITING_APPROVAL');
    });

    it('should keep the work order awaiting approval when one competing quote is rejected, then let the other be approved', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();

      // Two competing quotes, both submitted → both SENT, work order AWAITING_APPROVAL.
      const serviceA = await createService();

      const quoteARes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      const quoteAId = quoteARes.body.data.id as string;

      await request(httpServer)
        .post(`/api/quotes/${quoteAId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: serviceA.id, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteAId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({})
        .expect(200);

      const serviceB = await createService();

      const quoteBRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      const quoteBId = quoteBRes.body.data.id as string;

      await request(httpServer)
        .post(`/api/quotes/${quoteBId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: serviceB.id, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteBId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({})
        .expect(200);

      // Reject quote A → work order must stay AWAITING_APPROVAL because B is still out.
      await request(httpServer)
        .patch(`/api/quotes/${quoteAId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'REJECTED', reason: 'Cliente preferiu a outra proposta' })
        .expect(200);

      const woAfterReject = await request(httpServer)
        .get(`/api/work-orders/${workOrderId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(woAfterReject.body.data.status).toBe('AWAITING_APPROVAL');

      // Approving B now succeeds (previously this 409'd because the sibling's
      // rejection had already moved the work order to REJECTED).
      const approveRes = await request(httpServer)
        .patch(`/api/quotes/${quoteBId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' })
        .expect(200);

      expect(approveRes.body.data.status).toBe('APPROVED');

      const woAfterApprove = await request(httpServer)
        .get(`/api/work-orders/${workOrderId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(woAfterApprove.body.data.status).toBe('APPROVED');
    });
  });

  describe('POST /api/quotes/:id/submissions — requires work order diagnosis', () => {
    async function createReceivedWorkOrderWithQuote() {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const service = await createService();

      const woRes = await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          customerId: customer.id,
          vehicleId: vehicle.id,
          problemDescription: 'Revisão',
          services: [{ serviceId: service.id, quantity: 1 }],
        })
        .expect(201);

      const workOrderId = woRes.body.data.id as string;
      expect(woRes.body.data.status).toBe('RECEIVED');

      const quotesRes = await request(httpServer)
        .get(`/api/work-orders/${workOrderId}/quotes`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      const quote = quotesRes.body.data[0] as { id: string; status: string };
      expect(quote.status).toBe('PENDING');

      return { workOrderId, quoteId: quote.id };
    }

    it('should return 409 when submitting a quote whose work order is still RECEIVED', async () => {
      const { workOrderId, quoteId } = await createReceivedWorkOrderWithQuote();

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({})
        .expect(409);

      const quoteRes = await request(httpServer)
        .get(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(quoteRes.body.data.status).toBe('PENDING');

      const woRes = await request(httpServer)
        .get(`/api/work-orders/${workOrderId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(woRes.body.data.status).toBe('RECEIVED');
    });

    it('should submit and then approve after the work order is moved to IN_DIAGNOSIS', async () => {
      const { workOrderId, quoteId } = await createReceivedWorkOrderWithQuote();

      await request(httpServer)
        .patch(`/api/work-orders/${workOrderId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_DIAGNOSIS' })
        .expect(200);

      const submitRes = await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({})
        .expect(200);

      expect(submitRes.body.data.status).toBe('SENT');

      const woAfterSubmit = await request(httpServer)
        .get(`/api/work-orders/${workOrderId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(woAfterSubmit.body.data.status).toBe('AWAITING_APPROVAL');

      const approveRes = await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' })
        .expect(200);

      expect(approveRes.body.data.status).toBe('APPROVED');

      const woAfterApprove = await request(httpServer)
        .get(`/api/work-orders/${workOrderId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(woAfterApprove.body.data.status).toBe('APPROVED');
    });
  });

  // ─── PATCH /api/quotes/:id (Approve/Reject) ───────────────────────────────────

  describe('PATCH /api/quotes/:id', () => {
    it('should approve a submitted quote', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const service = await createService();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      const quoteId = createRes.body.data.id as string;

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: service.id, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({})
        .expect(200);

      const res = await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' })
        .expect(200);

      expect(res.body.data.status).toBe('APPROVED');

      // Verify WorkOrder is updated
      const woRes = await request(httpServer)
        .get(`/api/work-orders/${workOrderId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(woRes.body.data.status).toBe('APPROVED');
      expect(woRes.body.data.approvedAt).toBeDefined();
      expect(woRes.body.data.approvedAt).not.toBeNull();
    });

    it('should reject a submitted quote', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const service = await createService();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      const quoteId = createRes.body.data.id as string;

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: service.id, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({})
        .expect(200);

      const res = await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'REJECTED', reason: 'Preço fora do esperado' })
        .expect(200);

      expect(res.body.data.status).toBe('REJECTED');
    });

    it('should return 400 when rejecting without reason', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const service = await createService();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      const quoteId = createRes.body.data.id;

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: service.id, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({})
        .expect(200);

      // A missing reason is malformed input, not a state conflict — the
      // parameter combination (status=REJECTED without reason) is invalid in
      // itself, whatever the quote's current state.
      await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'REJECTED' })
        .expect(400);
    });

    it('should return 400 with invalid status', async () => {
      await request(httpServer)
        .patch(`/api/quotes/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'INVALID' })
        .expect(400);
    });

    it('should return 404 when quote does not exist', async () => {
      await request(httpServer)
        .patch(`/api/quotes/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' })
        .expect(404);
    });

    it('should return 404 when rejecting a quote that does not exist', async () => {
      await request(httpServer)
        .patch(`/api/quotes/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'REJECTED', reason: 'Cliente desistiu' })
        .expect(404);
    });

    it('should return 409 when stock is insufficient during approval', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const partRes = await request(httpServer)
        .post('/api/parts-supplies')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          name: 'Pneu',
          sku: `PNEU-${Date.now()}`,
          category: 'PART',
          unit: 'UN',
          costPrice: 200,
          salePrice: 400,
          stock: 1, // Low stock
          minStock: 0,
        })
        .expect(201);
      const partId = partRes.body.data.id;
      const service = await createService();

      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);
      const quoteId = createRes.body.data.id;

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: service.id, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/parts-supplies`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ partSupplyId: partId, quantity: 5 }) // Request more than available
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' })
        .expect(409);
    });
  });

  // ─── PUT & DELETE services/parts-supplies ──────────────────────────────────────────────

  describe('Quote Items Management', () => {
    it('should update and remove items in a PENDING quote', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const service = await createService();
      const part = await createPartSupply();

      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      const quoteId = createRes.body.data.id;

      // Add
      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: service.id, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/parts-supplies`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ partSupplyId: part.id, quantity: 1 })
        .expect(200);

      // Update
      await request(httpServer)
        .patch(`/api/quotes/${quoteId}/services/${service.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ quantity: 3 })
        .expect(200);

      await request(httpServer)
        .patch(`/api/quotes/${quoteId}/parts-supplies/${part.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ quantity: 5 })
        .expect(200);

      // Remove
      await request(httpServer)
        .delete(`/api/quotes/${quoteId}/services/${service.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(204);

      await request(httpServer)
        .delete(`/api/quotes/${quoteId}/parts-supplies/${part.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(204);
    });

    it('should return 400 when updating service item with quantity zero', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const service = await createService();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);
      const quoteId = createRes.body.data.id;

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: service.id, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .patch(`/api/quotes/${quoteId}/services/${service.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ quantity: 0 })
        .expect(400);
    });

    it('should return 400 when updating part supply item with quantity zero', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const part = await createPartSupply();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);
      const quoteId = createRes.body.data.id;

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/parts-supplies`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ partSupplyId: part.id, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .patch(`/api/quotes/${quoteId}/parts-supplies/${part.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ quantity: 0 })
        .expect(400);
    });

    it('should return 404 when updating non-existent item', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      await request(httpServer)
        .patch(
          `/api/quotes/${createRes.body.data.id}/services/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`,
        )
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ quantity: 1 })
        .expect(404);
    });

    it('should return 404 when removing non-existent item', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      await request(httpServer)
        .delete(
          `/api/quotes/${createRes.body.data.id}/parts-supplies/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`,
        )
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(404);
    });
  });

  // ─── PATCH /api/quotes/:id ──────────────────────────────────────────────────

  describe('PATCH /api/quotes/:id', () => {
    it('should approve a quote manually', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      const quoteId = createRes.body.data.id;
      const service = await createService();

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: service.id, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      const res = await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' })
        .expect(200);

      expect(res.body.data.status).toBe('APPROVED');
    });

    it('should reject a quote manually with reason', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      const quoteId = createRes.body.data.id;
      const service = await createService();

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: service.id, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      const res = await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'REJECTED', reason: 'Muito caro' })
        .expect(200);

      expect(res.body.data.status).toBe('REJECTED');
    });

    it('should return 400 when rejecting without reason', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);

      await request(httpServer)
        .patch(`/api/quotes/${createRes.body.data.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'REJECTED' })
        .expect(400); // BadRequestException mapped to 400
    });

    it('should return 404 when quote does not exist', async () => {
      await request(httpServer)
        .patch('/api/quotes/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' })
        .expect(404);
    });
  });

  // ─── Extra Coverage Scenarios ──────────────────────────────────────────────

  describe('Extra Coverage Scenarios', () => {
    it('should return 404 when adding service to non-existent quote', async () => {
      const service = await createService();
      await request(httpServer)
        .post(`/api/quotes/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: service.id, quantity: 1 })
        .expect(404);
    });

    it('should return 404 when adding non-existent service to quote', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);
      await request(httpServer)
        .post(`/api/quotes/${createRes.body.data.id}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', quantity: 1 })
        .expect(404);
    });

    it('should return 404 when removing service from non-existent quote', async () => {
      await request(httpServer)
        .delete(
          `/api/quotes/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/services/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`,
        )
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(404);
    });

    it('should return 404 when removing part from non-existent quote', async () => {
      await request(httpServer)
        .delete(
          `/api/quotes/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/parts-supplies/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`,
        )
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(404);
    });

    it('should return 404 when submitting non-existent quote', async () => {
      await request(httpServer)
        .post('/api/quotes/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/submissions')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(404);
    });

    it('should return 409 when submitting a REJECTED quote', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const service = await createService();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);
      const quoteId = createRes.body.data.id;
      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: service.id, quantity: 1 })
        .expect(200);

      // Submit first to move to SENT
      await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      // Reject it
      await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'REJECTED', reason: 'Test' })
        .expect(200);

      // Try to submit again
      await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(409);
    });

    it('should return 400 when manual status update is not APPROVED or REJECTED', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);
      await request(httpServer)
        .patch(`/api/quotes/${createRes.body.data.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'SENT' })
        .expect(400);
    });

    it('should return 404 when service is not associated with quote during removal', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);
      const service = await createService();
      await request(httpServer)
        .delete(`/api/quotes/${createRes.body.data.id}/services/${service.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(404);
    });

    it('should return 404 when part is not associated with quote during update', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const createRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);
      const part = await createPartSupply();
      await request(httpServer)
        .patch(`/api/quotes/${createRes.body.data.id}/parts-supplies/${part.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ quantity: 5 })
        .expect(404);
    });

    it('should return 404 when updating service in non-existent quote', async () => {
      const service = await createService();
      await request(httpServer)
        .patch(`/api/quotes/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/services/${service.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ quantity: 5 })
        .expect(404);
    });

    it('should return 404 when updating part in non-existent quote', async () => {
      const part = await createPartSupply();
      await request(httpServer)
        .patch(`/api/quotes/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/parts-supplies/${part.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ quantity: 5 })
        .expect(404);
    });

    it('should sanitize strings with null characters (SanitizeStringsPipe)', async () => {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const notes = 'Test\0Notes';
      const sanitizedNotes = 'TestNotes';

      const res = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId, notes })
        .expect(201);

      expect(res.body.data.notes).toBe(sanitizedNotes);
    });

    describe('Retrieval', () => {
      it('should list all quotes paginated (GET /api/quotes)', async () => {
        const wo = await createWorkOrderInDiagnosis();
        await request(httpServer)
          .post('/api/quotes')
          .set('Authorization', `Bearer ${adminAuth.accessToken}`)
          .send({ workOrderId: wo.workOrderId })
          .expect(201);

        const res = await request(httpServer)
          .get('/api/quotes')
          .set('Authorization', `Bearer ${adminAuth.accessToken}`)
          .expect(200);

        expect(res.body.data).toBeInstanceOf(Array);
        expect(res.body.pagination).toBeDefined();
        expect(res.body.pagination.page).toBe(1);
        expect(res.body.pagination.limit).toBe(10);
        expect(res.body.data.length).toBeGreaterThanOrEqual(1);
        expect(res.body.data[0].workOrder).toBeDefined();
        expect(res.body.data[0].workOrder.id).toBeDefined();
        expect((res.body.data[0] as Record<string, unknown>)['workOrderId']).toBeUndefined();
        expect(res.body.data[0].services).toBeUndefined();
        expect(res.body.data[0].partsSupplies).toBeUndefined();
      });

      it('should filter quotes by workOrderId (GET /api/quotes?workOrderId=...)', async () => {
        const wo1 = await createWorkOrderInDiagnosis();
        const _wo2 = await createWorkOrderInDiagnosis();

        await request(httpServer)
          .post('/api/quotes')
          .set('Authorization', `Bearer ${adminAuth.accessToken}`)
          .send({ workOrderId: wo1.workOrderId })
          .expect(201);

        const res = await request(httpServer)
          .get(`/api/quotes?workOrderId=${wo1.workOrderId}`)
          .set('Authorization', `Bearer ${adminAuth.accessToken}`)
          .expect(200);

        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].workOrder.id).toBe(wo1.workOrderId);
      });

      it('should filter quotes by status (GET /api/quotes?status=...)', async () => {
        const wo = await createWorkOrderInDiagnosis();
        const quoteRes = await request(httpServer)
          .post('/api/quotes')
          .set('Authorization', `Bearer ${adminAuth.accessToken}`)
          .send({ workOrderId: wo.workOrderId })
          .expect(201);

        const quoteId = quoteRes.body.data.id;

        // By default it's PENDING
        const resPending = await request(httpServer)
          .get('/api/quotes?status=PENDING')
          .set('Authorization', `Bearer ${adminAuth.accessToken}`)
          .expect(200);

        const hasPending = resPending.body.data.some((q: { id: string }) => q.id === quoteId);
        expect(hasPending).toBe(true);

        const resSent = await request(httpServer)
          .get('/api/quotes?status=SENT')
          .set('Authorization', `Bearer ${adminAuth.accessToken}`)
          .expect(200);

        const hasSent = resSent.body.data.some((q: { id: string }) => q.id === quoteId);
        expect(hasSent).toBe(false);
      });

      it('should filter quotes by status without page and limit (GET /api/quotes?status=...)', async () => {
        const res = await request(httpServer)
          .get('/api/quotes?status=PENDING')
          .set('Authorization', `Bearer ${adminAuth.accessToken}`)
          .expect(200);

        expect(res.body.pagination).toBeDefined();
        expect(res.body.pagination.page).toBe(1);
        expect(res.body.pagination.limit).toBe(10);
      });

      it('should list quotes of a work order (GET /api/work-orders/:id/quotes)', async () => {
        const wo = await createWorkOrderInDiagnosis();
        await request(httpServer)
          .post('/api/quotes')
          .set('Authorization', `Bearer ${adminAuth.accessToken}`)
          .send({ workOrderId: wo.workOrderId })
          .expect(201);

        const res = await request(httpServer)
          .get(`/api/work-orders/${wo.workOrderId}/quotes`)
          .set('Authorization', `Bearer ${adminAuth.accessToken}`)
          .expect(200);

        expect(res.body.data).toBeInstanceOf(Array);
        expect(res.body.data.length).toBeGreaterThanOrEqual(1);
        expect(res.body.data[0].workOrder).toBeDefined();
        expect(res.body.data[0].workOrder.id).toBe(wo.workOrderId);
        expect((res.body.data[0] as Record<string, unknown>)['workOrderId']).toBeUndefined();
        expect(res.body.data[0].services).toBeUndefined();
        expect(res.body.data[0].partsSupplies).toBeUndefined();
      });

      it('should return 404 when listing quotes for non-existent work order', async () => {
        const invalidId = 'f9b6e8e0-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
        await request(httpServer)
          .get(`/api/work-orders/${invalidId}/quotes`)
          .set('Authorization', `Bearer ${adminAuth.accessToken}`)
          .expect(404);
      });
    });
  });

  // ─── Concurrency — optimistic locking ───────────────────────────────────────

  describe('Quote approval — Concurrency (optimistic locking)', () => {
    async function setupSentQuote() {
      const { workOrderId } = await createWorkOrderInDiagnosis();
      const service = await createService();

      const quoteRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId })
        .expect(201);
      const quoteId = quoteRes.body.data.id as string;

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: service.id, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      return { quoteId, workOrderId };
    }

    it('should allow exactly one of two concurrent APPROVE requests to succeed', async () => {
      const { quoteId } = await setupSentQuote();

      const [res1, res2] = await Promise.all([
        request(httpServer)
          .patch(`/api/quotes/${quoteId}`)
          .set('Authorization', `Bearer ${adminAuth.accessToken}`)
          .send({ status: 'APPROVED' }),
        request(httpServer)
          .patch(`/api/quotes/${quoteId}`)
          .set('Authorization', `Bearer ${adminAuth.accessToken}`)
          .send({ status: 'APPROVED' }),
      ]);

      // Neither may be a server error (500)
      expect([200, 409]).toContain(res1.status);
      expect([200, 409]).toContain(res2.status);

      // Exactly one succeeds; the other gets ConcurrencyException or BusinessRuleViolation (both 409)
      const statuses = [res1.status, res2.status];
      expect(statuses).toContain(200);
      expect(statuses).toContain(409);

      // DB state must reflect a single approval
      const record = await ctx.prisma.quote.findUnique({ where: { id: quoteId } });
      expect(record!.status).toBe('APPROVED');
    });

    it('should return 409 when approving an already-approved quote (deterministic)', async () => {
      const { quoteId } = await setupSentQuote();

      await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' })
        .expect(200);

      await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' })
        .expect(409);
    });

    it('should return 409 when rejecting an already-rejected quote (deterministic)', async () => {
      const { quoteId } = await setupSentQuote();

      await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'REJECTED', reason: 'Preço elevado' })
        .expect(200);

      await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'REJECTED', reason: 'Outro motivo' })
        .expect(409);
    });

    it('should reject stale-version update with P2025 (direct optimistic lock verification)', async () => {
      const { quoteId } = await setupSentQuote();

      // Advance version via one approval (version 0 → N)
      await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' })
        .expect(200);

      // Simulate what the losing concurrent transaction would attempt
      await expect(
        ctx.prisma.quote.update({
          where: { id: quoteId, version: 0 }, // stale — version advanced past 0
          data: { status: 'REJECTED', version: { increment: 1 } },
        }),
      ).rejects.toMatchObject({ code: 'P2025' });
    });
  });
});
