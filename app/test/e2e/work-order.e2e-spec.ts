import type { Server } from 'http';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import request from 'supertest';
import { TestContext, setupTestApp, teardownTestApp } from '../helpers/test-app.helper';
import { cleanDatabase } from '../helpers/db-cleanup.helper';
import { AuthTokens, registerAndLogin } from '../helpers/auth.helper';

describe('WorkOrder (E2E)', () => {
  let ctx: TestContext;
  let httpServer: Server;
  let adminAuth: AuthTokens;
  let redis: Redis;

  beforeAll(async () => {
    ctx = await setupTestApp({ captureLogs: true });
    httpServer = ctx.httpServer;
    redis = new Redis(ctx.valkeyContainer.getConnectionUrl());
  });

  afterAll(async () => {
    await redis.quit();
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

  // ─── POST /api/work-orders ──────────────────────────────────────────────────

  describe('POST /api/work-orders', () => {
    it('should create a work order with RECEIVED status', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);

      const res = await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ customerId: customer.id, vehicleId: vehicle.id })
        .expect(201);

      expect(res.body.data).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          number: expect.stringMatching(/^\d{6}$/),
          status: 'RECEIVED',
          customer: expect.objectContaining({ id: customer.id }),
          vehicle: expect.objectContaining({ id: vehicle.id }),
        }),
      );
    });

    it('should return 401 without token', async () => {
      await request(httpServer).post('/api/work-orders').send({}).expect(401);
    });

    it('should return 404 when customer not found', async () => {
      await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          customerId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          vehicleId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
        })
        .expect(404);
    });

    it('should return 404 when vehicle not found', async () => {
      const customer = await createCustomer();
      await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ customerId: customer.id, vehicleId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22' })
        .expect(404);
    });

    it('should return 400 when problemDescription exceeds the maximum length', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);

      await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          customerId: customer.id,
          vehicleId: vehicle.id,
          problemDescription: 'a'.repeat(2001),
        })
        .expect(400);
    });

    it('should return 400 when internalNotes exceeds the maximum length', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);

      await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ customerId: customer.id, vehicleId: vehicle.id, internalNotes: 'a'.repeat(2001) })
        .expect(400);
    });

    it('should create a work order with mileageAtService specified', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);

      const res = await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ customerId: customer.id, vehicleId: vehicle.id, mileageAtService: 75000 })
        .expect(201);

      expect(res.body.data.mileageAtService).toBe(75000);
    });

    it('should create a work order with assigned user (mechanic)', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);

      // Create a mechanic
      const mechanic = await registerAndLogin(
        httpServer,
        {
          name: 'Mechanic Assignment',
          email: `mechanic.assign${Date.now()}@test.com`,
          role: 'MECHANIC',
        },
        ctx.prisma,
      );

      const res = await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          customerId: customer.id,
          vehicleId: vehicle.id,
          assignedUserId: mechanic.user.id,
        })
        .expect(201);

      expect(res.body.data.assignedUser.id).toBe(mechanic.user.id);
    });

    it('should return 404 when assigned user not found', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);

      await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          customerId: customer.id,
          vehicleId: vehicle.id,
          assignedUserId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        })
        .expect(404);
    });

    it('should return 409 when assigned user is not a mechanic', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);

      // Admin user is not a mechanic
      const usersRes = await request(httpServer)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);
      const adminUserId = usersRes.body.data.find(
        (u: { role: string; id: string }) => u.role === 'ADMIN',
      ).id;

      await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          customerId: customer.id,
          vehicleId: vehicle.id,
          assignedUserId: adminUserId,
        })
        .expect(409);
    });

    it('should return 409 when assigned user is an inactive mechanic', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);

      // Create an inactive mechanic
      const inactiveMechanic = await registerAndLogin(
        httpServer,
        {
          name: 'Inactive Mechanic',
          email: `inactive${Date.now()}@test.com`,
          role: 'MECHANIC',
        },
        ctx.prisma,
      );

      // Deactivate the user manually in DB or via API if possible
      // Let's use Prisma directly since it's easier in E2E helpers
      await ctx.prisma.user.update({
        where: { email: inactiveMechanic.user.email },
        data: { isActive: false },
      });

      await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          customerId: customer.id,
          vehicleId: vehicle.id,
          assignedUserId: inactiveMechanic.user.id,
        })
        .expect(409);
    });

    it('should return 400 when customerId is not a valid UUID', async () => {
      await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ customerId: 'not-a-uuid', vehicleId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22' })
        .expect(400);
    });

    it('should return 400 when vehicleId is not a valid UUID', async () => {
      const customer = await createCustomer();
      await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ customerId: customer.id, vehicleId: 'not-a-uuid' })
        .expect(400);
    });

    it('should return 400 when assignedUserId is not a valid UUID', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ customerId: customer.id, vehicleId: vehicle.id, assignedUserId: 'not-a-uuid' })
        .expect(400);
    });

    it('should return 400 when mileageAtService is negative', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ customerId: customer.id, vehicleId: vehicle.id, mileageAtService: -1 })
        .expect(400);
    });

    it('should return 409 when vehicle does not belong to customer', async () => {
      const customer1 = await createCustomer();
      const customer2 = await createCustomer();
      const vehicleOfCustomer2 = await createVehicle(customer2.id);

      await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ customerId: customer1.id, vehicleId: vehicleOfCustomer2.id })
        .expect(409);
    });

    it('should create work order with services only and a PENDING quote', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const service = await createService();

      const res = await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          customerId: customer.id,
          vehicleId: vehicle.id,
          services: [{ serviceId: service.id, quantity: 1 }],
        })
        .expect(201);

      const woId = res.body.data.id as string;
      expect(res.body.data.status).toBe('RECEIVED');

      const quotesRes = await request(httpServer)
        .get(`/api/work-orders/${woId}/quotes`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(quotesRes.body.data).toHaveLength(1);
      expect(quotesRes.body.data[0].status).toBe('PENDING');
    });

    it('should create work order with services + parts and a PENDING quote', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const service = await createService();
      const part = await createPartSupply();

      const res = await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          customerId: customer.id,
          vehicleId: vehicle.id,
          services: [{ serviceId: service.id, quantity: 2 }],
          partsSupplies: [{ partSupplyId: part.id, quantity: 3 }],
        })
        .expect(201);

      const woId = res.body.data.id as string;

      const quotesRes = await request(httpServer)
        .get(`/api/work-orders/${woId}/quotes`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(quotesRes.body.data).toHaveLength(1);
      expect(quotesRes.body.data[0].status).toBe('PENDING');
    });

    it('should create work order without items and NO quote', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);

      const res = await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ customerId: customer.id, vehicleId: vehicle.id })
        .expect(201);

      const woId = res.body.data.id as string;

      const quotesRes = await request(httpServer)
        .get(`/api/work-orders/${woId}/quotes`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(quotesRes.body.data).toHaveLength(0);
    });

    it('should return 409 when parts-only are provided (no service)', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const part = await createPartSupply();

      await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          customerId: customer.id,
          vehicleId: vehicle.id,
          partsSupplies: [{ partSupplyId: part.id, quantity: 1 }],
        })
        .expect(409);
    });

    it('should return 404 when unknown serviceId is provided', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);

      await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          customerId: customer.id,
          vehicleId: vehicle.id,
          services: [{ serviceId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', quantity: 1 }],
        })
        .expect(404);
    });

    it('should return 409 when duplicate serviceId is provided', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const service = await createService();

      await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          customerId: customer.id,
          vehicleId: vehicle.id,
          services: [
            { serviceId: service.id, quantity: 1 },
            { serviceId: service.id, quantity: 2 },
          ],
        })
        .expect(409);
    });

    it('should return 404 when unknown partSupplyId is provided', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const service = await createService();

      await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          customerId: customer.id,
          vehicleId: vehicle.id,
          services: [{ serviceId: service.id, quantity: 1 }],
          partsSupplies: [{ partSupplyId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', quantity: 1 }],
        })
        .expect(404);
    });

    it('should return 409 when duplicate partSupplyId is provided', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const service = await createService();
      const part = await createPartSupply();

      await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          customerId: customer.id,
          vehicleId: vehicle.id,
          services: [{ serviceId: service.id, quantity: 1 }],
          partsSupplies: [
            { partSupplyId: part.id, quantity: 1 },
            { partSupplyId: part.id, quantity: 2 },
          ],
        })
        .expect(409);
    });
  });

  // ─── GET /api/work-orders ──────────────────────────────────────────────────

  describe('GET /api/work-orders', () => {
    it('should list work orders paginated', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      await createWorkOrder(customer.id, vehicle.id);

      const res = await request(httpServer)
        .get('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(10);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should use default pagination (page=1, limit=10) when not provided', async () => {
      const res = await request(httpServer)
        .get('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(10);
    });

    it('should accept sort=status:desc and return 200', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      await createWorkOrder(customer.id, vehicle.id);

      const res = await request(httpServer)
        .get('/api/work-orders?sort=status:desc')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.pagination).toBeDefined();
    });

    it('should accept sort=createdAt:asc and return 200', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      await createWorkOrder(customer.id, vehicle.id);

      const res = await request(httpServer)
        .get('/api/work-orders?sort=createdAt:asc')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.pagination).toBeDefined();
    });

    it('should accept sort=status:desc,createdAt:asc and return 200', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      await createWorkOrder(customer.id, vehicle.id);

      const res = await request(httpServer)
        .get('/api/work-orders?sort=status:desc,createdAt:asc')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.pagination).toBeDefined();
    });

    it('should default to ascending when the sort field carries no direction', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      await createWorkOrder(customer.id, vehicle.id);
      await createWorkOrder(customer.id, vehicle.id);

      const res = await request(httpServer)
        .get('/api/work-orders?sort=createdAt')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      const timestamps = (res.body.data as { createdAt: string }[]).map((item) =>
        new Date(item.createdAt).getTime(),
      );

      expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    });

    it('should return 400 for disallowed sort field', async () => {
      await request(httpServer)
        .get('/api/work-orders?sort=number:asc')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(400);
    });

    it('should return 400 for invalid sort direction', async () => {
      await request(httpServer)
        .get('/api/work-orders?sort=status:invalid')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(400);
    });

    it('should return 400 for empty sort field', async () => {
      await request(httpServer)
        .get('/api/work-orders?sort=:asc')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(400);
    });
  });

  // ─── GET /api/work-orders/:id ──────────────────────────────────────────────

  describe('GET /api/work-orders/:id', () => {
    it('should return work order by ID', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      const res = await request(httpServer)
        .get(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body.data.id).toBe(wo.id);
    });

    it('should return 404 for non-existent id', async () => {
      await request(httpServer)
        .get('/api/work-orders/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(404);
    });
  });

  // ─── PATCH /api/work-orders/:id ─────────────────────────────────────

  describe('PATCH /api/work-orders/:id', () => {
    it('should transition RECEIVED -> IN_DIAGNOSIS', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      const res = await request(httpServer)
        .patch(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_DIAGNOSIS' })
        .expect(200);

      expect(res.body.data.status).toBe('IN_DIAGNOSIS');
    });

    it('should return 409 when updating to the same status', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_DIAGNOSIS' })
        .expect(200);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_DIAGNOSIS' })
        .expect(409);
    });

    it('should cancel a work order with notes', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      const res = await request(httpServer)
        .patch(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'CANCELLED', notes: 'Cancelado pelo cliente' })
        .expect(200);

      expect(res.body.data.status).toBe('CANCELLED');
    });

    it('should return 409 when cancelling without notes', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'CANCELLED' })
        .expect(409);
    });

    it('should return 400 when status update notes exceed the maximum length', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'CANCELLED', notes: 'a'.repeat(2001) })
        .expect(400);
    });

    it('should return 400 when setting APPROVED via PATCH (not allowed via status endpoint)', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' })
        .expect(400);
    });

    it('should return 404 for non-existent work order during status update', async () => {
      await request(httpServer)
        .patch('/api/work-orders/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_DIAGNOSIS' })
        .expect(404);
    });
  });

  // ─── DELETE /api/work-orders/:id ───────────────────────────────────────────

  describe('DELETE /api/work-orders/:id', () => {
    it('should return 404 since delete endpoint was removed', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      await request(httpServer)
        .delete(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(404);
    });
  });

  // ─── GET /api/work-orders/:id/status-history ───────────────────────────────

  describe('GET /api/work-orders/:id/status-history', () => {
    it('should return status history', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      const res = await request(httpServer)
        .get(`/api/work-orders/${wo.id}/status-history`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0]).toEqual(
        expect.objectContaining({
          newStatus: 'RECEIVED',
          changedBy: expect.objectContaining({ id: expect.any(String) }),
        }),
      );
    });
  });

  // ─── PUT /api/work-orders/:id ──────────────────────────────────────────────

  describe('PUT /api/work-orders/:id', () => {
    it('should update work order details', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      const res = await request(httpServer)
        .put(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          problemDescription: 'Problema atualizado',
          internalNotes: 'Notas internas',
          mileageAtService: 50000,
        })
        .expect(200);

      expect(res.body.data.problemDescription).toBe('Problema atualizado');
      expect(res.body.data.internalNotes).toBe('Notas internas');
      expect(res.body.data.mileageAtService).toBe(50000);
    });

    it('should return 404 when work order does not exist during update', async () => {
      await request(httpServer)
        .put('/api/work-orders/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ problemDescription: 'Test' })
        .expect(404);
    });

    it('should return 400 when updating with a problemDescription that exceeds the maximum length', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      await request(httpServer)
        .put(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ problemDescription: 'a'.repeat(2001) })
        .expect(400);
    });

    it('should return 400 when updating with internalNotes that exceeds the maximum length', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      await request(httpServer)
        .put(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ internalNotes: 'a'.repeat(2001) })
        .expect(400);
    });

    it('should return 404 when assigned user does not exist during update', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      await request(httpServer)
        .put(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ assignedUserId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
        .expect(404);
    });

    it('should assign an existing mechanic during update', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      const mechanic = await registerAndLogin(
        httpServer,
        {
          name: 'Mechanic Update',
          email: `mechanic.update${Date.now()}@test.com`,
          role: 'MECHANIC',
        },
        ctx.prisma,
      );

      // A valid existing user covers the "assignedUser found" branch.
      const res = await request(httpServer)
        .put(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ assignedUserId: mechanic.user.id })
        .expect(200);

      expect(res.body.data.assignedUser.id).toBe(mechanic.user.id);
    });
  });

  describe('GET /api/work-orders/:id/status-history', () => {
    it('should return 404 when work order does not exist', async () => {
      await request(httpServer)
        .get('/api/work-orders/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/status-history')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(404);
    });
  });

  // ─── PATCH /api/work-orders/:id/services/:serviceId ────────────────

  describe('PATCH /api/work-orders/:id/services/:serviceId', () => {
    it('should update service status within a work order', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      // We need to have a service linked to the work order.
      // Usually services are linked via approved quotes.
      // For this test, we'll manually link it in DB or use a quote flow.
      // Using quote flow is more "E2E".

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_DIAGNOSIS' })
        .expect(200);

      const serviceRes = await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: 'Troca de Óleo', basePrice: 100, estimatedTimeMin: 30 })
        .expect(201);
      const serviceId = serviceRes.body.data.id;

      const quoteRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId: wo.id })
        .expect(201);
      const quoteId = quoteRes.body.data.id;

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' })
        .expect(200);

      // Now the service is in the work order with status PENDING
      // Move to IN_PROGRESS first (to move WO to IN_PROGRESS)
      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_PROGRESS' })
        .expect(200);

      const res = await request(httpServer)
        .patch(`/api/work-orders/${wo.id}/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'COMPLETED' })
        .expect(200);

      expect(res.body.data.status).toBe('COMPLETED');
    });

    it('should return 400 when service status is not IN_PROGRESS or COMPLETED', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}/services/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'PENDING' })
        .expect(400);
    });

    it('should return 404 for status update of non-existent work order', async () => {
      await request(httpServer)
        .patch(
          '/api/work-orders/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/services/b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
        )
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'COMPLETED' })
        .expect(404);
    });

    it('should return 404 for status update of service not in work order', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}/services/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'COMPLETED' })
        .expect(404);
    });

    it('should transition service to IN_PROGRESS and trigger stock movements', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_DIAGNOSIS' })
        .expect(200);

      const serviceRes = await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: 'Troca de Óleo Full', basePrice: 100, estimatedTimeMin: 30 })
        .expect(201);
      const serviceId = serviceRes.body.data.id;

      const partRes = await request(httpServer)
        .post('/api/parts-supplies')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          name: 'Filtro',
          sku: `FLT-${Date.now()}`,
          category: 'PART',
          unit: 'UN',
          costPrice: 20,
          salePrice: 40,
          stock: 10,
          minStock: 2,
        })
        .expect(201);
      const partId = partRes.body.data.id;

      const quoteRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId: wo.id })
        .expect(201);
      const quoteId = quoteRes.body.data.id;

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/parts-supplies`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ partSupplyId: partId, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' })
        .expect(200);

      // Transition to IN_PROGRESS
      const res = await request(httpServer)
        .patch(`/api/work-orders/${wo.id}/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_PROGRESS' })
        .expect(200);

      expect(res.body.data.status).toBe('IN_PROGRESS');

      // Check OS status also changed to IN_PROGRESS
      const woRes = await request(httpServer)
        .get(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);
      expect(woRes.body.data.status).toBe('IN_PROGRESS');

      // Check stock movement (Wait, stock movement check is optional but good)
      const stockRes = await request(httpServer)
        .get(`/api/stock-movements?partSupplyId=${partId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);
      expect(stockRes.body.data.length).toBeGreaterThan(0);
    });

    it('should return 409 when completing a service that is not IN_PROGRESS (still PENDING)', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_DIAGNOSIS' })
        .expect(200);

      const serviceRes = await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          name: `Servico Pending Complete ${Date.now()}`,
          basePrice: 100,
          estimatedTimeMin: 30,
        })
        .expect(201);
      const serviceId = serviceRes.body.data.id as string;

      const quoteRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId: wo.id })
        .expect(201);
      const quoteId = quoteRes.body.data.id as string;

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' })
        .expect(200);

      // Service is now PENDING — trying to complete it without starting it first
      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'COMPLETED' })
        .expect(409);
    });

    it('should return 409 when updating service to the same status', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_DIAGNOSIS' })
        .expect(200);

      const serviceRes = await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: 'Revisão Geral', basePrice: 200, estimatedTimeMin: 60 })
        .expect(201);
      const serviceId = serviceRes.body.data.id;

      const quoteRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId: wo.id })
        .expect(201);
      const quoteId = quoteRes.body.data.id;

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' })
        .expect(200);

      // Transition to IN_PROGRESS
      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_PROGRESS' })
        .expect(200);

      // Attempt same transition again — should conflict
      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_PROGRESS' })
        .expect(409);
    });

    it('should return 409 when completing a service that is already COMPLETED', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_DIAGNOSIS' })
        .expect(200);

      const serviceRes = await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: `Serviço Já Concluído ${Date.now()}`, basePrice: 100, estimatedTimeMin: 30 })
        .expect(201);
      const serviceId = serviceRes.body.data.id;

      const quoteRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId: wo.id })
        .expect(201);
      const quoteId = quoteRes.body.data.id;

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' })
        .expect(200);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_PROGRESS' })
        .expect(200);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'COMPLETED' })
        .expect(200);

      // Service is now COMPLETED — trying to complete it again
      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'COMPLETED' })
        .expect(409);
    });

    it('should return 409 when starting a service that is already COMPLETED', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_DIAGNOSIS' })
        .expect(200);

      const serviceRes = await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          name: `Serviço Reiniciar Concluído ${Date.now()}`,
          basePrice: 100,
          estimatedTimeMin: 30,
        })
        .expect(201);

      const serviceId = serviceRes.body.data.id;

      const quoteRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId: wo.id })
        .expect(201);
      const quoteId = quoteRes.body.data.id;

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' })
        .expect(200);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_PROGRESS' })
        .expect(200);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'COMPLETED' })
        .expect(200);

      // Service is now COMPLETED — trying to start it again
      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_PROGRESS' })
        .expect(409);
    });
  });

  // ─── GET /api/work-orders (Filters) ────────────────────────────────────────

  describe('GET /api/work-orders (Advanced Filters)', () => {
    it('should filter by various parameters', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      // Filter by number
      let res = await request(httpServer)
        .get(`/api/work-orders?number=${wo.number}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);
      expect(res.body.data.length).toBe(1);

      // Filter by status
      res = await request(httpServer)
        .get('/api/work-orders?status=RECEIVED')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      // Filter by customerId
      res = await request(httpServer)
        .get(`/api/work-orders?customerId=${customer.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);
      expect(res.body.data.length).toBe(1);

      // Filter by vehicleId
      res = await request(httpServer)
        .get(`/api/work-orders?vehicleId=${vehicle.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);
      expect(res.body.data.length).toBe(1);

      // Filter by assignedUserId
      // Create another WO with assigned user (must be a mechanic)
      const mechanic = await registerAndLogin(
        httpServer,
        {
          name: 'Mechanic Filter',
          email: `mechanic.filter${Date.now()}@test.com`,
          role: 'MECHANIC',
        },
        ctx.prisma,
      );

      await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          customerId: customer.id,
          vehicleId: vehicle.id,
          assignedUserId: mechanic.user.id,
          problemDescription: 'Assigned WO',
        })
        .expect(201);

      res = await request(httpServer)
        .get(`/api/work-orders?assignedUserId=${mechanic.user.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(
        res.body.data.every(
          (wo: { assignedUser?: { id: string } }) => wo.assignedUser?.id === mechanic.user.id,
        ),
      ).toBe(true);
    });
  });

  // ─── Full lifecycle: all services COMPLETED → work order COMPLETED ──────────

  describe('Full lifecycle: completing all services transitions work order to COMPLETED', () => {
    it('should set work order status to COMPLETED when all service items are completed', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_DIAGNOSIS' })
        .expect(200);

      const service1Res = await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: `Serviço A ${Date.now()}`, basePrice: 100, estimatedTimeMin: 30 })
        .expect(201);

      const service2Res = await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: `Serviço B ${Date.now()}`, basePrice: 80, estimatedTimeMin: 20 })
        .expect(201);

      const quoteRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId: wo.id })
        .expect(201);
      const quoteId = quoteRes.body.data.id as string;

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: service1Res.body.data.id, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: service2Res.body.data.id, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' })
        .expect(200);

      // Start and complete service 1
      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}/services/${service1Res.body.data.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_PROGRESS' })
        .expect(200);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}/services/${service1Res.body.data.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'COMPLETED' })
        .expect(200);

      // Work order should still be IN_PROGRESS (service 2 not done yet)
      const woMid = await request(httpServer)
        .get(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);
      expect(woMid.body.data.status).toBe('IN_PROGRESS');

      // Start and complete service 2
      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}/services/${service2Res.body.data.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_PROGRESS' })
        .expect(200);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}/services/${service2Res.body.data.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'COMPLETED' })
        .expect(200);

      // All services done — work order must be COMPLETED now
      const woFinal = await request(httpServer)
        .get(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);
      expect(woFinal.body.data.status).toBe('COMPLETED');
    });
  });

  // ─── AllExceptionsFilter — malformed JSON ──────────────────────────────────

  describe('AllExceptionsFilter — malformed JSON body', () => {
    it('should return 400 for malformed JSON body', async () => {
      const res = await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .set('Content-Type', 'application/json')
        .send('{invalid json:}');

      expect(res.status).toBe(400);
    });
  });

  // ─── WorkOrder.startServiceItem — entity not found (line 150) ──────────────

  describe('PATCH /api/work-orders/:id/services/:serviceId — startServiceItem entity not found', () => {
    it('should return 404 when service is not in work order (status IN_PROGRESS)', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}/services/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_PROGRESS' })
        .expect(404);
    });
  });

  // ─── WorkOrder.update — status not RECEIVED/IN_DIAGNOSIS (line 233) ────────

  describe('PUT /api/work-orders/:id — update blocked when status is beyond IN_DIAGNOSIS', () => {
    it('should return 409 when updating a work order in APPROVED status', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_DIAGNOSIS' })
        .expect(200);

      const serviceRes = await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: `Servico Update Block ${Date.now()}`, basePrice: 100, estimatedTimeMin: 30 })
        .expect(201);

      const quoteRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId: wo.id })
        .expect(201);
      const quoteId = quoteRes.body.data.id;

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId: serviceRes.body.data.id, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' })
        .expect(200);

      // WO is now APPROVED — update must be rejected
      await request(httpServer)
        .put(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ problemDescription: 'Tentativa de atualização bloqueada' })
        .expect(409);
    });
  });

  // ─── WorkOrder.validateStatusTransition — invalid transition (line 300) ────

  describe('PATCH /api/work-orders/:id — invalid status transition', () => {
    it('should return 409 for a forbidden status transition (RECEIVED → DELIVERED)', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'DELIVERED' })
        .expect(409);
    });
  });

  // ─── Full lifecycle with DELIVERED transition (line 320) ───────────────────

  describe('Full lifecycle: COMPLETED → DELIVERED', () => {
    it('should transition work order to DELIVERED after all services are completed', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_DIAGNOSIS' })
        .expect(200);

      const serviceRes = await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: `Servico Delivery ${Date.now()}`, basePrice: 150, estimatedTimeMin: 45 })
        .expect(201);
      const serviceId = serviceRes.body.data.id;

      const quoteRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId: wo.id })
        .expect(201);
      const quoteId = quoteRes.body.data.id;

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' })
        .expect(200);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_PROGRESS' })
        .expect(200);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'COMPLETED' })
        .expect(200);

      // WO is COMPLETED — now transition to DELIVERED
      const res = await request(httpServer)
        .patch(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'DELIVERED' })
        .expect(200);

      expect(res.body.data.status).toBe('DELIVERED');
      expect(res.body.data.deliveredAt).toBeTruthy();
    });
  });

  // ─── GET /api/work-orders/:id — service.description and partSupply details ───

  describe('GET /api/work-orders/:id — service description and partSupply description/partNumber', () => {
    it('should return work order with service description and partSupply description and partNumber', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_DIAGNOSIS' })
        .expect(200);

      const serviceRes = await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          name: 'Revisão Com Descrição',
          basePrice: 200,
          estimatedTimeMin: 60,
          description: 'Revisão completa do motor',
        })
        .expect(201);

      const serviceId = serviceRes.body.data.id as string;

      const partRes = await request(httpServer)
        .post('/api/parts-supplies')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          name: 'Filtro Detalhado',
          sku: `FLT-DET-${Date.now()}`,
          category: 'PART',
          unit: 'UN',
          costPrice: 25,
          salePrice: 50,
          stock: 20,
          minStock: 3,
          description: 'Filtro de ar original',
          partNumber: 'FA-9999',
        })
        .expect(201);

      const partId = partRes.body.data.id as string;

      const quoteRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId: wo.id })
        .expect(201);
      const quoteId = quoteRes.body.data.id as string;

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/services`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ serviceId, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/parts-supplies`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ partSupplyId: partId, quantity: 1 })
        .expect(200);

      await request(httpServer)
        .post(`/api/quotes/${quoteId}/submissions`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' })
        .expect(200);

      const res = await request(httpServer)
        .get(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      const serviceItem = res.body.data.services.find((s: { id: string }) => s.id === serviceId);
      const partItem = res.body.data.partSupplies.find((p: { id: string }) => p.id === partId);

      expect(serviceItem).toBeDefined();
      expect(serviceItem.description).toBe('Revisão completa do motor');
      expect(partItem).toBeDefined();
      expect(partItem.description).toBe('Filtro de ar original');
      expect(partItem.partNumber).toBe('FA-9999');
    });
  });

  describe('GET /api/work-orders — default status filter', () => {
    it('should omit COMPLETED, DELIVERED and CANCELLED orders by default, keeping REJECTED and active ones', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);

      const activeWo = await createWorkOrder(customer.id, vehicle.id);

      // Insert closed orders directly via prisma (hard to reach via API alone)
      await ctx.prisma.workOrder.createMany({
        data: [
          {
            id: randomUUID(),
            number: `${Date.now()}01`,
            customerId: customer.id,
            vehicleId: vehicle.id,
            status: 'COMPLETED',
            totalAmount: 0,
            version: 1,
          },
          {
            id: randomUUID(),
            number: `${Date.now()}02`,
            customerId: customer.id,
            vehicleId: vehicle.id,
            status: 'DELIVERED',
            totalAmount: 0,
            version: 1,
          },
          {
            id: randomUUID(),
            number: `${Date.now()}03`,
            customerId: customer.id,
            vehicleId: vehicle.id,
            status: 'CANCELLED',
            totalAmount: 0,
            version: 1,
          },
          {
            id: randomUUID(),
            number: `${Date.now()}04`,
            customerId: customer.id,
            vehicleId: vehicle.id,
            status: 'REJECTED',
            totalAmount: 0,
            version: 1,
          },
        ],
      });

      const res = await request(httpServer)
        .get('/api/work-orders')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      const statuses: string[] = res.body.data.map((wo: { status: string }) => wo.status);
      expect(statuses).not.toContain('COMPLETED');
      expect(statuses).not.toContain('DELIVERED');
      expect(statuses).not.toContain('CANCELLED');
      expect(statuses).toContain('RECEIVED');
      expect(statuses).toContain('REJECTED');

      expect(res.body.pagination.totalRecords).toBe(2); // RECEIVED + REJECTED
      expect(res.body.data.some((wo: { id: string }) => wo.id === activeWo.id)).toBe(true);
    });

    it('GET /api/work-orders?status=DELIVERED should return delivered orders (override default)', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);

      await ctx.prisma.workOrder.create({
        data: {
          id: randomUUID(),
          number: `${Date.now()}05`,
          customerId: customer.id,
          vehicleId: vehicle.id,
          status: 'DELIVERED',
          totalAmount: 0,
          version: 1,
        },
      });

      const res = await request(httpServer)
        .get('/api/work-orders?status=DELIVERED')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.every((wo: { status: string }) => wo.status === 'DELIVERED')).toBe(true);
    });

    it('GET /api/work-orders/:id of a closed order should return 200', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);

      const closedId = randomUUID();
      await ctx.prisma.workOrder.create({
        data: {
          id: closedId,
          number: `${Date.now()}06`,
          customerId: customer.id,
          vehicleId: vehicle.id,
          status: 'DELIVERED',
          totalAmount: 0,
          version: 1,
        },
      });

      const res = await request(httpServer)
        .get(`/api/work-orders/${closedId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body.data.id).toBe(closedId);
      expect(res.body.data.status).toBe('DELIVERED');
    });
  });

  // ─── PATCH /api/work-orders/:id — Concorrência (Optimistic Locking) ─────────

  describe('PATCH /api/work-orders/:id — Concurrency (optimistic locking)', () => {
    it('should maintain consistency under concurrent status transitions', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      const [r1, r2] = await Promise.all([
        request(httpServer)
          .patch(`/api/work-orders/${wo.id}`)
          .set('Authorization', `Bearer ${adminAuth.accessToken}`)
          .send({ status: 'IN_DIAGNOSIS' }),
        request(httpServer)
          .patch(`/api/work-orders/${wo.id}`)
          .set('Authorization', `Bearer ${adminAuth.accessToken}`)
          .send({ status: 'IN_DIAGNOSIS' }),
      ]);

      // Neither may be a server error (500)
      expect([200, 409]).toContain(r1.status);
      expect([200, 409]).toContain(r2.status);

      // At least one must succeed
      expect([r1.status, r2.status]).toContain(200);

      // Final state must be consistent — only one transition happened
      const finalWo = await ctx.prisma.workOrder.findUnique({ where: { id: wo.id } });
      expect(finalWo!.status).toBe('IN_DIAGNOSIS');
    });

    it('should return 409 for stale-version update (direct optimistic lock verification)', async () => {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const wo = await createWorkOrder(customer.id, vehicle.id);

      // Advance version via HTTP (version 0 → 1)
      await request(httpServer)
        .patch(`/api/work-orders/${wo.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_DIAGNOSIS' })
        .expect(200);

      // Simulate stale second transaction with version=0
      await expect(
        ctx.prisma.workOrder.update({
          where: { id: wo.id, version: 0 }, // stale — version is now 1
          data: { status: 'IN_DIAGNOSIS', version: { increment: 1 } },
        }),
      ).rejects.toMatchObject({ code: 'P2025' });
    });
  });

  // Last describe: the cache-down case pauses Valkey for 3 s.
  describe('GET /api/work-orders/:id — cache', () => {
    async function createCachedWorkOrder() {
      const customer = await createCustomer();
      const vehicle = await createVehicle(customer.id);
      const workOrder = await createWorkOrder(customer.id, vehicle.id);

      return { ...workOrder, customerId: customer.id, vehicleId: vehicle.id };
    }

    function getDetail(id: string) {
      return request(httpServer)
        .get(`/api/work-orders/${id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);
    }

    it('should serve the second read from the cache with the same body', async () => {
      const { id } = await createCachedWorkOrder();

      const first = await getDetail(id);
      const ttl = await redis.ttl(`work-order:work-order:${id}`);
      const second = await getDetail(id);

      expect(second.body).toEqual(first.body);
      expect(ttl).toBeGreaterThanOrEqual(43_190);
      expect(ttl).toBeLessThanOrEqual(43_200);
    });

    it('should show the new status after a status change', async () => {
      const { id } = await createCachedWorkOrder();
      await getDetail(id);

      await request(httpServer)
        .patch(`/api/work-orders/${id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_DIAGNOSIS' })
        .expect(200);

      expect((await getDetail(id)).body.data.status).toBe('IN_DIAGNOSIS');
    });

    it('should show the new plate after the vehicle changes', async () => {
      const { id, customerId, vehicleId } = await createCachedWorkOrder();

      await getDetail(id);

      await request(httpServer)
        .put(`/api/vehicles/${vehicleId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ customerId, plate: 'XYZ-9876', brand: 'Toyota', model: 'Corolla', year: 2020 })
        .expect(200);

      expect((await getDetail(id)).body.data.vehicle.plate).toBe('XYZ9876');
    });

    it('should keep the cached service name after the service is renamed', async () => {
      const { id } = await createCachedWorkOrder();

      await request(httpServer)
        .patch(`/api/work-orders/${id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'IN_DIAGNOSIS' })
        .expect(200);

      const service = await createService();
      const quoteRes = await request(httpServer)
        .post('/api/quotes')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ workOrderId: id })
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

      await request(httpServer)
        .patch(`/api/quotes/${quoteId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ status: 'APPROVED' })
        .expect(200);

      const cachedName = (await getDetail(id)).body.data.services[0].name as string;

      await request(httpServer)
        .put(`/api/services/${service.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          name: 'Serviço renomeado',
          description: 'Troca de óleo do motor',
          basePrice: 150,
          estimatedTimeMin: 30,
        })
        .expect(200);

      expect((await getDetail(id)).body.data.services[0].name).toBe(cachedName);
    });

    it('should answer from PostgreSQL when the cache is down', async () => {
      const { id } = await createCachedWorkOrder();
      ctx.logCapture!.clear();
      // Accepts the connection and answers nothing: the command timeout is what returns the read.
      await redis.call('CLIENT', 'PAUSE', '3000', 'ALL');

      const response = await getDetail(id);
      await request(httpServer).get('/api/health/ready').expect(200);

      expect(response.body.data.id).toBe(id);
      expect(ctx.logCapture!.lines()).toContainEqual(
        expect.objectContaining({ 'oficina.event.name': 'cache.unavailable' }),
      );
    });
  });
});
