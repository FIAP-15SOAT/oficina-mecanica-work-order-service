import type { Server } from 'http';
import request from 'supertest';
import { TestContext, setupTestApp, teardownTestApp } from '../helpers/test-app.helper';
import { cleanDatabase } from '../helpers/db-cleanup.helper';
import { AuthTokens, registerAndLogin } from '../helpers/auth.helper';

describe('Service (E2E)', () => {
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

  const validService = {
    name: 'Troca de Óleo',
    description: 'Troca completa com filtro',
    basePrice: 129.9,
    estimatedTimeMin: 60,
  };

  // ─── POST /api/services ───────────────────────────────────────────────────

  describe('POST /api/services', () => {
    it('should create a service and return 201', async () => {
      const res = await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send(validService)
        .expect(201);

      expect(res.body.data).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: 'Troca de Óleo',
          description: 'Troca completa com filtro',
        }),
      );
    });

    it('should create a service without optional description', async () => {
      const res = await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          name: 'Alinhamento',
          basePrice: 80,
          estimatedTimeMin: 30,
        })
        .expect(201);

      expect(res.body.data.name).toBe('Alinhamento');
      expect(res.body.data.description).toBeNull();
    });

    it('should return 409 when creating service with duplicate name', async () => {
      await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send(validService)
        .expect(201);

      await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send(validService)
        .expect(409);
    });

    it('should return 400 with invalid body', async () => {
      await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: 'ab', basePrice: -10, estimatedTimeMin: 0 })
        .expect(400);
    });

    it('should return 400 when name is shorter than the minimum length', async () => {
      await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ ...validService, name: 'ab' })
        .expect(400);
    });

    it('should return 400 when name exceeds the maximum length', async () => {
      await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ ...validService, name: 'a'.repeat(151) })
        .expect(400);
    });

    it('should return 400 when description exceeds the maximum length', async () => {
      await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ ...validService, description: 'a'.repeat(501) })
        .expect(400);
    });

    it('should return 400 when basePrice is negative', async () => {
      await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ ...validService, basePrice: -10 })
        .expect(400);
    });

    it('should return 400 when estimatedTimeMin is zero', async () => {
      await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ ...validService, estimatedTimeMin: 0 })
        .expect(400);
    });

    it('should return 401 without token', async () => {
      await request(httpServer).post('/api/services').send(validService).expect(401);
    });

    it('should return 403 for non-admin role', async () => {
      const mechanic = await registerAndLogin(
        httpServer,
        {
          name: 'Mechanic',
          email: 'mechanic@e2e.test',
          role: 'MECHANIC',
        },
        ctx.prisma,
      );

      await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${mechanic.accessToken}`)
        .send(validService)
        .expect(403);
    });
  });

  // ─── GET /api/services ────────────────────────────────────────────────────

  describe('GET /api/services', () => {
    beforeEach(async () => {
      for (let i = 1; i <= 15; i++) {
        await request(httpServer)
          .post('/api/services')
          .set('Authorization', `Bearer ${adminAuth.accessToken}`)
          .send({
            name: `Serviço ${i}`,
            basePrice: 100 + i,
            estimatedTimeMin: 30 + i,
          })
          .expect(201);
      }
    });

    it('should return paginated services with defaults (page=1, pageSize=10)', async () => {
      const res = await request(httpServer)
        .get('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBe(10);
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(10);
      expect(res.body.pagination.totalRecords).toBe(15);
      expect(res.body.pagination.totalPages).toBe(2);
    });

    it('should return second page', async () => {
      const res = await request(httpServer)
        .get('/api/services?page=2&limit=10')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body.data.length).toBe(5);
    });

    it('should respect custom pageSize', async () => {
      const res = await request(httpServer)
        .get('/api/services?page=1&limit=5')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body.data.length).toBe(5);
      expect(res.body.pagination.totalPages).toBe(3);
    });

    it('should return 401 without token', async () => {
      await request(httpServer).get('/api/services').expect(401);
    });

    it('should filter services by name (case-insensitive)', async () => {
      const res = await request(httpServer)
        .get('/api/services?name=servi%C3%A7o+1&limit=100')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body.pagination.totalRecords).toBeGreaterThanOrEqual(1);
      res.body.data.forEach((item: { name: string }) => {
        expect(item.name.toLowerCase()).toContain('serviço 1');
      });
    });
  });

  // ─── GET /api/services/:id ────────────────────────────────────────────────

  describe('GET /api/services/:id', () => {
    it('should return service by id', async () => {
      const createRes = await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send(validService)
        .expect(201);

      const serviceId = createRes.body.data.id;

      const res = await request(httpServer)
        .get(`/api/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body.data.id).toBe(serviceId);
      expect(res.body.data.name).toBe('Troca de Óleo');
    });

    it('should return 404 for non-existent service', async () => {
      await request(httpServer)
        .get('/api/services/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(404);
    });

    it('should return 400 for invalid UUID', async () => {
      await request(httpServer)
        .get('/api/services/not-a-uuid')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(400);
    });
  });

  // ─── PUT /api/services/:id ────────────────────────────────────────────────

  describe('PUT /api/services/:id', () => {
    let serviceId: string;

    beforeEach(async () => {
      const createRes = await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send(validService)
        .expect(201);
      serviceId = createRes.body.data.id;
    });

    it('should update service data', async () => {
      const res = await request(httpServer)
        .put(`/api/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          name: 'Troca de Óleo Premium',
          description: 'Com óleo sintético',
          basePrice: 189.9,
          estimatedTimeMin: 90,
        })
        .expect(200);

      expect(res.body.data.name).toBe('Troca de Óleo Premium');
      expect(res.body.data.description).toBe('Com óleo sintético');
    });

    it('should return 404 for non-existent service', async () => {
      await request(httpServer)
        .put('/api/services/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          name: 'Ghost',
          basePrice: 100,
          estimatedTimeMin: 30,
        })
        .expect(404);
    });

    it('should return 400 when updating with a name that exceeds the maximum length', async () => {
      await request(httpServer)
        .put(`/api/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ ...validService, name: 'a'.repeat(151) })
        .expect(400);
    });

    it('should return 400 when updating with a description that exceeds the maximum length', async () => {
      await request(httpServer)
        .put(`/api/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ ...validService, description: 'a'.repeat(501) })
        .expect(400);
    });

    it('should return 400 when updating with a negative basePrice', async () => {
      await request(httpServer)
        .put(`/api/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ ...validService, basePrice: -5 })
        .expect(400);
    });

    it('should return 400 when updating with estimatedTimeMin of zero', async () => {
      await request(httpServer)
        .put(`/api/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ ...validService, estimatedTimeMin: 0 })
        .expect(400);
    });

    it('should return 409 when updating to duplicate name', async () => {
      await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          name: 'Outro Serviço',
          basePrice: 50,
          estimatedTimeMin: 20,
        })
        .expect(201);

      await request(httpServer)
        .put(`/api/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({
          name: 'Outro Serviço',
          basePrice: 100,
          estimatedTimeMin: 30,
        })
        .expect(409);
    });
  });

  // ─── DELETE /api/services/:id ─────────────────────────────────────────────

  describe('DELETE /api/services/:id', () => {
    it('should delete service and return 204', async () => {
      const createRes = await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send(validService)
        .expect(201);

      const serviceId = createRes.body.data.id;

      await request(httpServer)
        .delete(`/api/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(204);

      await request(httpServer)
        .get(`/api/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(404);
    });

    it('should return 404 for non-existent service', async () => {
      await request(httpServer)
        .delete('/api/services/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(404);
    });
  });

  // ─── GET /api/services/metrics ───────────────────────────────────────────

  describe('Service Metrics', () => {
    it('should return metrics for all services', async () => {
      await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send(validService)
        .expect(201);

      const res = await request(httpServer)
        .get('/api/services-metrics')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`);

      expect(res.status).toBe(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      for (const item of res.body.data) {
        expect(
          item.averageTimeMinutes === null || typeof item.averageTimeMinutes === 'number',
        ).toBe(true);

        if (item.averageTimeMinutes !== null) {
          const decimalPart = item.averageTimeMinutes.toString().split('.')[1] ?? '';
          expect(decimalPart.length).toBeLessThanOrEqual(2);
        }
      }
    });

    it('should return metrics list with averageTimeMinutes filled when there are completed executions', async () => {
      const createRes = await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: 'Balanceamento', basePrice: 70, estimatedTimeMin: 45 })
        .expect(201);
      const serviceId = createRes.body.data.id;

      const customer = await ctx.prisma.customer.create({
        data: {
          name: 'Métricas Lista',
          document: '12345678909',
          type: 'INDIVIDUAL',
          email: `metrics-list${Date.now()}@test.com`,
          phone: '11999999999',
          address: {
            create: {
              street: 'Rua Teste',
              city: 'São Paulo',
              state: 'SP',
              zipCode: '01234-567',
            },
          },
        },
      });

      const vehicle = await ctx.prisma.vehicle.create({
        data: {
          customerId: customer.id,
          plate: 'MET-LST1',
          brand: 'Test',
          model: 'Test',
          year: 2020,
        },
      });

      const workOrder = await ctx.prisma.workOrder.create({
        data: {
          customerId: customer.id,
          vehicleId: vehicle.id,
          number: '910001',
          status: 'COMPLETED',
        },
      });

      await ctx.prisma.workOrderService.create({
        data: {
          workOrderId: workOrder.id,
          serviceId,
          quantity: 1,
          unitPrice: 70,
          totalPrice: 70,
          status: 'COMPLETED',
          startedAt: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
          finishedAt: new Date(),
        },
      });

      const res = await request(httpServer)
        .get('/api/services-metrics')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      const metric = res.body.data.find((m: { serviceId: string }) => m.serviceId === serviceId);
      expect(metric).toBeDefined();
      expect(typeof metric.averageTimeMinutes).toBe('number');
      expect(metric.averageTimeMinutes).toBeCloseTo(30, 0);
      expect(metric.executionCount).toBeGreaterThanOrEqual(1);
    });

    it('should use default pagination (page=1, limit=10) for metrics when not provided', async () => {
      const res = await request(httpServer)
        .get('/api/services-metrics')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(10);
    });

    it('should return metrics for a specific service', async () => {
      const createRes = await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: 'Troca de Pneu', basePrice: 50, estimatedTimeMin: 30 })
        .expect(201);
      const serviceId = createRes.body.data.id;

      // Create a customer and vehicle for the work order
      const customer = await ctx.prisma.customer.create({
        data: {
          name: 'Métricas',
          document: '12345678909',
          type: 'INDIVIDUAL',
          email: 'metrics@test.com',
          phone: '11999999999',
          address: {
            create: {
              street: 'Rua Teste',
              city: 'São Paulo',
              state: 'SP',
              zipCode: '01234-567',
            },
          },
        },
      });

      const vehicle = await ctx.prisma.vehicle.create({
        data: {
          customerId: customer.id,
          plate: 'MET-0001',
          brand: 'Test',
          model: 'Test',
          year: 2020,
        },
      });

      const workOrder = await ctx.prisma.workOrder.create({
        data: {
          customerId: customer.id,
          vehicleId: vehicle.id,
          number: '910002',
          status: 'COMPLETED',
        },
      });

      // Manually create a completed service in DB to have metrics
      await ctx.prisma.workOrderService.create({
        data: {
          workOrderId: workOrder.id,
          serviceId,
          quantity: 1,
          unitPrice: 50,
          totalPrice: 50,
          status: 'COMPLETED',
          startedAt: new Date(Date.now() - 3600000), // 1 hour ago
          finishedAt: new Date(),
        },
      });

      const res = await request(httpServer)
        .get(`/api/services/${serviceId}/metrics`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body.data.executionCount).toBeGreaterThanOrEqual(1);
      expect(typeof res.body.data.averageTimeMinutes).toBe('number');
      expect(res.body.data.averageTimeMinutes).toBeCloseTo(60, 0);
      const decimalStr = res.body.data.averageTimeMinutes.toString();
      const decimalPart = decimalStr.includes('.') ? decimalStr.split('.')[1] : '';
      expect(decimalPart.length).toBeLessThanOrEqual(2);
    });

    it('should return zero executions for a service without completed executions', async () => {
      const createRes = await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: 'Alinhamento', basePrice: 80, estimatedTimeMin: 40 })
        .expect(201);

      const serviceId = createRes.body.data.id;

      const customer = await ctx.prisma.customer.create({
        data: {
          name: 'Métricas Vazias',
          document: '52998224725',
          type: 'INDIVIDUAL',
          email: 'metrics-empty@test.com',
          phone: '11999999999',
          address: {
            create: { street: 'Rua Teste', city: 'São Paulo', state: 'SP', zipCode: '01234-567' },
          },
        },
      });

      const vehicle = await ctx.prisma.vehicle.create({
        data: {
          customerId: customer.id,
          plate: 'MET-0002',
          brand: 'Test',
          model: 'Test',
          year: 2020,
        },
      });

      const workOrder = await ctx.prisma.workOrder.create({
        data: {
          customerId: customer.id,
          vehicleId: vehicle.id,
          number: '910003',
          status: 'IN_PROGRESS',
        },
      });

      // An execution still in progress must not count.
      await ctx.prisma.workOrderService.create({
        data: {
          workOrderId: workOrder.id,
          serviceId,
          quantity: 1,
          unitPrice: 80,
          totalPrice: 80,
          status: 'IN_PROGRESS',
          startedAt: new Date(),
        },
      });

      const res = await request(httpServer)
        .get(`/api/services/${serviceId}/metrics`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body.data).toEqual({
        serviceId,
        serviceName: 'Alinhamento',
        executionCount: 0,
        averageTimeMinutes: null,
      });
    });

    it('should return 403 for metrics when user is not ADMIN', async () => {
      const mechanicAuth = await registerAndLogin(
        httpServer,
        {
          name: 'Mecânico Teste',
          email: 'mechanic-metrics@test.com',
          role: 'MECHANIC',
        },
        ctx.prisma,
      );

      await request(httpServer)
        .get('/api/services/metrics')
        .set('Authorization', `Bearer ${mechanicAuth.accessToken}`)
        .expect(403);
    });

    it('should return 404 for metrics of non-existent service', async () => {
      await request(httpServer)
        .get('/api/services/00000000-0000-0000-0000-000000000000/metrics')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(404);
    });
  });

  describe('Service Deletion (Conflicts)', () => {
    it('should return 409 when service is in a quote', async () => {
      // 1. Create dependencies
      const customer = await ctx.prisma.customer.create({
        data: {
          name: 'Conflict Customer',
          document: '12345678909',
          type: 'INDIVIDUAL',
          email: `conflict${Date.now()}@test.com`,
          phone: '11999999999',
        },
      });

      const vehicle = await ctx.prisma.vehicle.create({
        data: {
          customerId: customer.id,
          plate: `CNF-${Date.now().toString().slice(-4)}`,
          brand: 'Toyota',
          model: 'Corolla',
          year: 2020,
        },
      });

      const workOrder = await ctx.prisma.workOrder.create({
        data: {
          number: `WO-CNF-${Date.now().toString().slice(-4)}`,
          customerId: customer.id,
          vehicleId: vehicle.id,
          status: 'IN_DIAGNOSIS',
        },
      });

      const quote = await ctx.prisma.quote.create({
        data: {
          workOrderId: workOrder.id,
          status: 'PENDING',
          totalAmount: 0,
        },
      });

      const createRes = await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send(validService)
        .expect(201);
      const serviceId = createRes.body.data.id;

      // Manual mock of quote service linkage to trigger conflict
      await ctx.prisma.quoteService.create({
        data: {
          quoteId: quote.id,
          serviceId,
          quantity: 1,
          unitPrice: 100,
          totalPrice: 100,
        },
      });

      await request(httpServer)
        .delete(`/api/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(409);
    });

    it('should return 409 when service is in a work order', async () => {
      const customer = await ctx.prisma.customer.create({
        data: {
          name: 'WO Conflict',
          document: '12345678909',
          type: 'INDIVIDUAL',
          email: `wo-conflict${Date.now()}@test.com`,
          phone: '11999999999',
        },
      });

      const vehicle = await ctx.prisma.vehicle.create({
        data: {
          customerId: customer.id,
          plate: `WOC-${Date.now().toString().slice(-4)}`,
          brand: 'Toyota',
          model: 'Corolla',
          year: 2020,
        },
      });

      const workOrder = await ctx.prisma.workOrder.create({
        data: {
          number: `WO-WOC-${Date.now().toString().slice(-4)}`,
          customerId: customer.id,
          vehicleId: vehicle.id,
          status: 'RECEIVED',
        },
      });

      const createRes = await request(httpServer)
        .post('/api/services')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send(validService)
        .expect(201);

      const serviceId = createRes.body.data.id;

      await ctx.prisma.workOrderService.create({
        data: {
          workOrderId: workOrder.id,
          serviceId,
          quantity: 1,
          unitPrice: 100,
          totalPrice: 100,
          status: 'PENDING',
        },
      });

      await request(httpServer)
        .delete(`/api/services/${serviceId}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(409);
    });
  });
});
