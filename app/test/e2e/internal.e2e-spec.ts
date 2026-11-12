import type { Server } from 'http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { TestContext, setupTestApp, teardownTestApp } from '../helpers/test-app.helper';
import { cleanDatabase } from '../helpers/db-cleanup.helper';
import { AuthTokens, registerAndLogin } from '../helpers/auth.helper';

const UNKNOWN_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

const fixture: unknown = JSON.parse(
  readFileSync(join(__dirname, '../contracts/internal-work-order.json'), 'utf8'),
);

// Keys at every level mapped to their JSON type; the fixture's `$source` header is not part of the contract.
function jsonShape(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(jsonShape);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== '$source')
        .map(([key, nested]) => [key, jsonShape(nested)]),
    );
  }

  return value === null ? 'null' : typeof value;
}

describe('Internal routes (E2E)', () => {
  let ctx: TestContext;
  let httpServer: Server;
  let adminAuth: AuthTokens;

  beforeAll(async () => {
    ctx = await setupTestApp({ withSwagger: true });
    httpServer = ctx.httpServer;
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  beforeEach(async () => {
    await cleanDatabase(ctx.prisma);

    adminAuth = await registerAndLogin(
      httpServer,
      { name: 'Admin E2E', email: 'admin@e2e.test', role: 'ADMIN' },
      ctx.prisma,
    );
  });

  async function createWorkOrder() {
    const auth = { Authorization: `Bearer ${adminAuth.accessToken}` };

    const customer = await request(httpServer)
      .post('/api/customers')
      .set(auth)
      .send({
        name: 'Cliente Interno',
        document: '52998224725',
        type: 'INDIVIDUAL',
        email: 'cliente.interno@test.com',
        phone: '11999999999',
        address: {
          street: 'Rua Teste, 123',
          city: 'São Paulo',
          state: 'SP',
          zipCode: '01310-100',
        },
      })
      .expect(201);

    const vehicle = await request(httpServer)
      .post('/api/vehicles')
      .set(auth)
      .send({
        customerId: customer.body.data.id,
        plate: 'ABC-1234',
        brand: 'Toyota',
        model: 'Corolla',
        year: 2020,
      })
      .expect(201);

    const workOrder = await request(httpServer)
      .post('/api/work-orders')
      .set(auth)
      .send({ customerId: customer.body.data.id, vehicleId: vehicle.body.data.id })
      .expect(201);

    return workOrder.body.data as { id: string };
  }

  describe('GET /internal/work-orders/:id', () => {
    it('should return the work order detail without a token', async () => {
      const workOrder = await createWorkOrder();

      const publicRes = await request(httpServer)
        .get(`/api/work-orders/${workOrder.id}`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(200);

      const res = await request(httpServer)
        .get(`/internal/work-orders/${workOrder.id}`)
        .expect(200);

      expect(res.body).toEqual(publicRes.body);
      expect(jsonShape(res.body)).toEqual(jsonShape(fixture));
    });

    it('should answer 404 with the public error body for an unknown id', async () => {
      const res = await request(httpServer).get(`/internal/work-orders/${UNKNOWN_ID}`).expect(404);

      expect(res.body).toEqual({
        statusCode: 404,
        error: 'Not Found',
        message: expect.any(String),
      });
    });

    it('should not serve the internal route under /api', async () => {
      await request(httpServer).get(`/api/internal/work-orders/${UNKNOWN_ID}`).expect(404);
    });

    it('should answer a JSON 404 for an unknown internal path', async () => {
      const res = await request(httpServer).get('/internal/nope').expect(404);

      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.body).toEqual({
        statusCode: 404,
        error: 'Not Found',
        message: expect.any(String),
      });
    });

    it('should leave the internal route out of Swagger', async () => {
      const res = await request(httpServer).get('/api/docs-json').expect(200);

      const internalPaths = Object.keys(res.body.paths as object).filter((path) =>
        path.startsWith('/internal'),
      );

      expect(internalPaths).toEqual([]);
    });
  });
});
