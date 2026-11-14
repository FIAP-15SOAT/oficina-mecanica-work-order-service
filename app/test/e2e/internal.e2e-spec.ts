import type { Server } from 'http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { TestContext, setupTestApp, teardownTestApp } from '../helpers/test-app.helper';
import { cleanDatabase } from '../helpers/db-cleanup.helper';
import { StaffUser, createStaffUser } from '../helpers/auth.helper';

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

const userCustomersFixture: unknown = JSON.parse(
  readFileSync(join(__dirname, '../contracts/internal-user-customers.json'), 'utf8'),
);

describe('Internal routes (E2E)', () => {
  let ctx: TestContext;
  let httpServer: Server;
  let adminAuth: StaffUser;

  beforeAll(async () => {
    ctx = await setupTestApp({ withSwagger: true });
    httpServer = ctx.httpServer;
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  beforeEach(async () => {
    await cleanDatabase(ctx.prisma);

    adminAuth = createStaffUser({}, { name: 'Admin E2E' });
  });

  async function createWorkOrder() {
    const auth = { Authorization: adminAuth.authorization };

    const customer = await request(httpServer)
      .post('/api/customers')
      .set(auth)
      .send({
        name: 'Cliente Interno',
        document: '52998224725',
        type: 'INDIVIDUAL',
        createAccess: false,
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
        .set('Authorization', adminAuth.authorization)
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

  describe('GET /internal/users/:userId/customers', () => {
    const INDIVIDUAL_ID = '70bb2668-aa3a-4412-afca-198286ca98db';
    const COMPANY_ID = 'c37a755d-9257-43ad-ae38-890efe884d63';

    async function createLinkedCustomer(
      id: string,
      overrides: {
        name: string;
        document: string;
        type: 'INDIVIDUAL' | 'COMPANY';
        isActive?: boolean;
      },
    ) {
      await ctx.prisma.customer.create({
        data: {
          id,
          email: `${id}@e2e.test`,
          phone: '11999999999',
          ...overrides,
        },
      });

      await ctx.prisma.userCustomer.create({
        data: { userId: adminAuth.user.id, customerId: id },
      });
    }

    it('should answer as in the contract fixture without authentication', async () => {
      await createLinkedCustomer(INDIVIDUAL_ID, {
        name: 'João da Silva',
        document: '12345678909',
        type: 'INDIVIDUAL',
      });
      await createLinkedCustomer(COMPANY_ID, {
        name: 'Oficina Parceira LTDA',
        document: '12345678000195',
        type: 'COMPANY',
      });

      const res = await request(httpServer)
        .get(`/internal/users/${adminAuth.user.id}/customers`)
        .expect(200);

      expect(res.body).toEqual({
        data: expect.arrayContaining([
          expect.objectContaining({ id: INDIVIDUAL_ID, document: '12345678909' }),
          expect.objectContaining({ id: COMPANY_ID, document: '12345678000195' }),
        ]),
      });
      expect(res.body.data).toHaveLength(2);
      expect(jsonShape(res.body)).toEqual(jsonShape(userCustomersFixture));
    });

    it('should leave out the inactive customers', async () => {
      await createLinkedCustomer(INDIVIDUAL_ID, {
        name: 'João da Silva',
        document: '12345678909',
        type: 'INDIVIDUAL',
      });
      await createLinkedCustomer(COMPANY_ID, {
        name: 'Oficina Parceira LTDA',
        document: '12345678000195',
        type: 'COMPANY',
        isActive: false,
      });

      const res = await request(httpServer)
        .get(`/internal/users/${adminAuth.user.id}/customers`)
        .expect(200);

      expect(res.body.data.map((customer: { id: string }) => customer.id)).toEqual([INDIVIDUAL_ID]);
    });

    it('should answer an empty list for an unknown user', async () => {
      const res = await request(httpServer)
        .get(`/internal/users/${randomUUID()}/customers`)
        .expect(200);

      expect(res.body).toEqual({ data: [] });
    });

    it('should answer 400 for a user id that is not a UUID', async () => {
      await request(httpServer).get('/internal/users/not-a-uuid/customers').expect(400);
    });
  });
});
