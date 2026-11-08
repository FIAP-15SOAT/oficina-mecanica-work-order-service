import { randomUUID } from 'node:crypto';
import type { Server } from 'http';
import request from 'supertest';
import { TestContext, setupTestApp, teardownTestApp } from '../helpers/test-app.helper';
import { cleanDatabase } from '../helpers/db-cleanup.helper';
import { AuthTokens, registerAndLogin } from '../helpers/auth.helper';
import {
  InternalServicesStub,
  startInternalServicesStub,
  stubService,
} from '../helpers/internal-services-stub';

describe('Service (E2E)', () => {
  let ctx: TestContext;
  let stub: InternalServicesStub;
  let httpServer: Server;
  let adminAuth: AuthTokens;

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

  describe('Service Metrics', () => {
    async function createWorkOrderWithServiceItems(
      items: { serviceId: string; status: 'COMPLETED' | 'IN_PROGRESS'; minutes: number }[],
    ): Promise<void> {
      const customer = await ctx.prisma.customer.create({
        data: {
          name: 'Cliente Métricas',
          document: '12345678909',
          type: 'INDIVIDUAL',
          email: 'metrics@test.com',
          phone: '11999999999',
          address: {
            create: { street: 'Rua Teste', city: 'São Paulo', state: 'SP', zipCode: '01234-567' },
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
          number: '910001',
          status: 'IN_PROGRESS',
        },
      });

      const finishedAt = new Date();

      await ctx.prisma.workOrderService.createMany({
        data: items.map(({ serviceId, status, minutes }) => ({
          workOrderId: workOrder.id,
          serviceId,
          quantity: 1,
          unitPrice: 100,
          totalPrice: 100,
          status,
          startedAt: new Date(finishedAt.getTime() - minutes * 60_000),
          finishedAt: status === 'COMPLETED' ? finishedAt : null,
        })),
      });
    }

    it('should list only executed services, sorted by name and paged', async () => {
      const balancing = stubService(stub, { name: 'Balanceamento' });
      const alignment = stubService(stub, { name: 'Alinhamento' });
      const tireChange = stubService(stub, { name: 'Troca de pneu' });

      stubService(stub, { name: 'Polimento' });

      await createWorkOrderWithServiceItems([
        { serviceId: balancing.id, status: 'COMPLETED', minutes: 30 },
        { serviceId: alignment.id, status: 'COMPLETED', minutes: 60 },
        { serviceId: tireChange.id, status: 'IN_PROGRESS', minutes: 10 },
      ]);

      const firstPage = await request(httpServer)
        .get('/api/services-metrics')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);
      const secondPage = await request(httpServer)
        .get('/api/services-metrics?page=2&limit=1')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(firstPage.body).toEqual({
        data: [
          {
            serviceId: alignment.id,
            serviceName: 'Alinhamento',
            executionCount: 1,
            averageTimeMinutes: 60,
          },
          {
            serviceId: balancing.id,
            serviceName: 'Balanceamento',
            executionCount: 1,
            averageTimeMinutes: 30,
          },
        ],
        pagination: { totalRecords: 2, totalPages: 1, page: 1, limit: 10 },
      });

      expect(secondPage.body).toEqual({
        data: [
          {
            serviceId: balancing.id,
            serviceName: 'Balanceamento',
            executionCount: 1,
            averageTimeMinutes: 30,
          },
        ],
        pagination: { totalRecords: 2, totalPages: 2, page: 2, limit: 1 },
      });
    });

    it('should list a service the Inventory no longer has last, with a null name', async () => {
      const alignment = stubService(stub, { name: 'Alinhamento' });
      const removedServiceId = randomUUID();

      await createWorkOrderWithServiceItems([
        { serviceId: removedServiceId, status: 'COMPLETED', minutes: 20 },
        { serviceId: alignment.id, status: 'COMPLETED', minutes: 60 },
      ]);

      const res = await request(httpServer)
        .get('/api/services-metrics')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body.data).toEqual([
        {
          serviceId: alignment.id,
          serviceName: 'Alinhamento',
          executionCount: 1,
          averageTimeMinutes: 60,
        },
        {
          serviceId: removedServiceId,
          serviceName: null,
          executionCount: 1,
          averageTimeMinutes: 20,
        },
      ]);
    });

    it('should return the executions of a known service with its Inventory name', async () => {
      const alignment = stubService(stub, { name: 'Alinhamento' });

      await createWorkOrderWithServiceItems([
        { serviceId: alignment.id, status: 'COMPLETED', minutes: 45 },
      ]);

      const res = await request(httpServer)
        .get(`/api/services/${alignment.id}/metrics`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body.data).toEqual({
        serviceId: alignment.id,
        serviceName: 'Alinhamento',
        executionCount: 1,
        averageTimeMinutes: 45,
      });
    });

    it('should return zero executions for a known service without completed executions', async () => {
      const alignment = stubService(stub, { name: 'Alinhamento' });

      await createWorkOrderWithServiceItems([
        { serviceId: alignment.id, status: 'IN_PROGRESS', minutes: 10 },
      ]);

      const res = await request(httpServer)
        .get(`/api/services/${alignment.id}/metrics`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body.data).toEqual({
        serviceId: alignment.id,
        serviceName: 'Alinhamento',
        executionCount: 0,
        averageTimeMinutes: 0,
      });
    });

    it('should answer 404 when the Inventory does not know the service', async () => {
      await request(httpServer)
        .get(`/api/services/${randomUUID()}/metrics`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(404);
    });

    it('should use default pagination (page=1, limit=10) for metrics when not provided', async () => {
      const res = await request(httpServer)
        .get('/api/services-metrics')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      expect(res.body).toEqual({
        data: [],
        pagination: { totalRecords: 0, totalPages: 0, page: 1, limit: 10 },
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
        .get('/api/services-metrics')
        .set('Authorization', `Bearer ${mechanicAuth.accessToken}`)
        .expect(403);
    });
  });
});
