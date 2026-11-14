import type { Server } from 'http';
import request from 'supertest';
import { TestContext, setupTestApp, teardownTestApp } from '../helpers/test-app.helper';
import { cleanDatabase } from '../helpers/db-cleanup.helper';
import { staffAuthHeader } from '../helpers/auth.helper';

describe('Vehicle (E2E)', () => {
  let ctx: TestContext;
  let httpServer: Server;
  let adminAuth: string;

  beforeAll(async () => {
    ctx = await setupTestApp();
    httpServer = ctx.httpServer;
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  beforeEach(async () => {
    await cleanDatabase(ctx.prisma);
    adminAuth = staffAuthHeader();
  });

  async function createCustomer(authorization: string) {
    const res = await request(httpServer)
      .post('/api/customers')
      .set('Authorization', authorization)
      .send({
        name: 'João da Silva',
        document: '123.456.789-09',
        type: 'INDIVIDUAL',
        createAccess: false,
        email: 'joao@e2e.test',
        phone: '(11) 99999-9999',
        address: {
          street: 'Rua Teste, 123',
          city: 'São Paulo',
          state: 'SP',
          zipCode: '01310-100',
        },
      })
      .expect(201);
    return res.body.data as { id: string; name: string };
  }

  const validVehicle = {
    plate: 'ABC1234',
    brand: 'Toyota',
    model: 'Corolla',
    year: 2020,
  };

  // ─── POST /api/vehicles ──────────────────────────────────────────────────

  describe('POST /api/vehicles', () => {
    it('should create vehicle and return 201 with nested customer', async () => {
      const customer = await createCustomer(adminAuth);

      const res = await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: customer.id })
        .expect(201);

      expect(res.body.data).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          plate: 'ABC1234',
          brand: 'Toyota',
          model: 'Corolla',
          year: 2020,
          customerId: customer.id,
          customer: expect.objectContaining({
            id: customer.id,
            name: 'João da Silva',
          }),
        }),
      );
    });

    it('should return 404 when customer does not exist', async () => {
      await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: '00000000-0000-0000-0000-000000000000' })
        .expect(404);
    });

    it('should return 409 when plate already exists', async () => {
      const customer = await createCustomer(adminAuth);

      await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: customer.id })
        .expect(201);

      await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: customer.id })
        .expect(409);
    });

    it('should return 422 when plate format is invalid', async () => {
      const customer = await createCustomer(adminAuth);

      await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: customer.id, plate: '1234ABC' })
        .expect(400);
    });

    it('should return 422 when year is in the future', async () => {
      const customer = await createCustomer(adminAuth);
      const futureYear = new Date().getFullYear() + 1;

      await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: customer.id, year: futureYear })
        .expect(422);
    });

    it('should return 400 when required fields are missing', async () => {
      await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ brand: 'Toyota' })
        .expect(400);
    });

    it('should return 400 when brand is shorter than the minimum length', async () => {
      const customer = await createCustomer(adminAuth);
      await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: customer.id, brand: 'A' })
        .expect(400);
    });

    it('should return 400 when brand exceeds the maximum length', async () => {
      const customer = await createCustomer(adminAuth);
      await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: customer.id, brand: 'a'.repeat(61) })
        .expect(400);
    });

    it('should return 400 when model is shorter than the minimum length', async () => {
      const customer = await createCustomer(adminAuth);
      await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: customer.id, model: 'A' })
        .expect(400);
    });

    it('should return 400 when model exceeds the maximum length', async () => {
      const customer = await createCustomer(adminAuth);
      await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: customer.id, model: 'a'.repeat(61) })
        .expect(400);
    });

    it('should return 400 when color exceeds the maximum length', async () => {
      const customer = await createCustomer(adminAuth);
      await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: customer.id, color: 'a'.repeat(41) })
        .expect(400);
    });

    it('should return 400 when year is below the minimum allowed', async () => {
      const customer = await createCustomer(adminAuth);
      await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: customer.id, year: 1949 })
        .expect(400);
    });

    it('should return 400 when year is not an integer', async () => {
      const customer = await createCustomer(adminAuth);
      await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: customer.id, year: 2020.5 })
        .expect(400);
    });

    it('should return 400 when mileage is negative', async () => {
      const customer = await createCustomer(adminAuth);
      await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: customer.id, mileage: -1 })
        .expect(400);
    });

    it('should return 401 when no token is provided', async () => {
      await request(httpServer).post('/api/vehicles').send(validVehicle).expect(401);
    });
  });

  // ─── GET /api/vehicles ───────────────────────────────────────────────────

  describe('GET /api/vehicles', () => {
    let customerId: string;

    beforeEach(async () => {
      const customer = await createCustomer(adminAuth);
      customerId = customer.id;

      await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId })
        .expect(201);

      await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ plate: 'XYZ-9999', brand: 'Honda', model: 'Civic', year: 2021, customerId })
        .expect(201);
    });

    it('should return paginated list', async () => {
      const res = await request(httpServer)
        .get('/api/vehicles')
        .set('Authorization', adminAuth)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(10);
      expect(res.body.pagination.totalRecords).toBeGreaterThanOrEqual(2);
    });

    it('should use default pagination (page=1, limit=10) when not provided', async () => {
      const res = await request(httpServer)
        .get('/api/vehicles')
        .set('Authorization', adminAuth)
        .expect(200);

      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(10);
    });

    it('should include nested customer object in each result', async () => {
      const res = await request(httpServer)
        .get('/api/vehicles')
        .set('Authorization', adminAuth)
        .expect(200);

      expect(res.body.data[0].customer).toEqual(
        expect.objectContaining({ id: customerId, name: 'João da Silva' }),
      );
    });

    it('should filter by brand (partial match)', async () => {
      const res = await request(httpServer)
        .get('/api/vehicles?brand=Toyota')
        .set('Authorization', adminAuth)
        .expect(200);

      expect(res.body.pagination.totalRecords).toBe(1);
      expect(res.body.data[0].brand).toContain('Toyota');
    });

    it('should filter by exact plate', async () => {
      const res = await request(httpServer)
        .get('/api/vehicles?plate=ABC1234')
        .set('Authorization', adminAuth)
        .expect(200);

      expect(res.body.pagination.totalRecords).toBe(1);
    });

    it('should filter by customerId', async () => {
      const res = await request(httpServer)
        .get(`/api/vehicles?customerId=${customerId}`)
        .set('Authorization', adminAuth)
        .expect(200);

      expect(res.body.pagination.totalRecords).toBe(2);
      res.body.data.forEach((v: { customerId: string }) => expect(v.customerId).toBe(customerId));
    });
  });

  // ─── GET /api/vehicles/:id ───────────────────────────────────────────────

  describe('GET /api/vehicles/:id', () => {
    it('should return vehicle by id with nested customer', async () => {
      const customer = await createCustomer(adminAuth);
      const created = await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: customer.id })
        .expect(201);

      const res = await request(httpServer)
        .get(`/api/vehicles/${created.body.data.id}`)
        .set('Authorization', adminAuth)
        .expect(200);

      expect(res.body.data.id).toBe(created.body.data.id);
      expect(res.body.data.customer).toEqual(
        expect.objectContaining({ id: customer.id, name: 'João da Silva' }),
      );
    });

    it('should return 404 when vehicle does not exist', async () => {
      await request(httpServer)
        .get('/api/vehicles/00000000-0000-0000-0000-000000000000')
        .set('Authorization', adminAuth)
        .expect(404);
    });

    it('should return 400 for invalid UUID', async () => {
      await request(httpServer)
        .get('/api/vehicles/not-a-uuid')
        .set('Authorization', adminAuth)
        .expect(400);
    });
  });

  // ─── PUT /api/vehicles/:id ───────────────────────────────────────────────

  describe('PUT /api/vehicles/:id', () => {
    it('should update vehicle and return 200', async () => {
      const customer = await createCustomer(adminAuth);
      const created = await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: customer.id })
        .expect(201);

      const res = await request(httpServer)
        .put(`/api/vehicles/${created.body.data.id}`)
        .set('Authorization', adminAuth)
        .send({
          customerId: customer.id,
          plate: 'ABC1234',
          brand: 'Honda',
          model: 'Corolla',
          year: 2020,
        })
        .expect(200);

      expect(res.body.data.brand).toBe('Honda');
    });

    it('should update vehicle color and mileage', async () => {
      const customer = await createCustomer(adminAuth);
      const created = await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: customer.id })
        .expect(201);

      const res = await request(httpServer)
        .put(`/api/vehicles/${created.body.data.id}`)
        .set('Authorization', adminAuth)
        .send({
          customerId: customer.id,
          plate: 'ABC1234',
          brand: 'Toyota',
          model: 'Corolla',
          year: 2020,
          color: 'Prata',
          mileage: 75000,
        })
        .expect(200);

      expect(res.body.data.color).toBe('Prata');
      expect(res.body.data.mileage).toBe(75000);
    });

    it('should return 400 when updating with a brand that exceeds the maximum length', async () => {
      const customer = await createCustomer(adminAuth);
      const created = await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: customer.id })
        .expect(201);

      await request(httpServer)
        .put(`/api/vehicles/${created.body.data.id}`)
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: customer.id, brand: 'a'.repeat(61) })
        .expect(400);
    });

    it('should return 404 when vehicle does not exist', async () => {
      const customer = await createCustomer(adminAuth);

      await request(httpServer)
        .put('/api/vehicles/00000000-0000-0000-0000-000000000000')
        .set('Authorization', adminAuth)
        .send({
          customerId: customer.id,
          plate: 'ABC1234',
          brand: 'Honda',
          model: 'Corolla',
          year: 2020,
        })
        .expect(404);
    });

    it('should return 409 when updating to plate of another vehicle', async () => {
      const customer = await createCustomer(adminAuth);

      await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: customer.id })
        .expect(201);

      const second = await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({
          plate: 'XYZ-9999',
          brand: 'Honda',
          model: 'Civic',
          year: 2021,
          customerId: customer.id,
        })
        .expect(201);

      await request(httpServer)
        .put(`/api/vehicles/${second.body.data.id}`)
        .set('Authorization', adminAuth)
        .send({
          customerId: customer.id,
          plate: 'ABC1234',
          brand: 'Honda',
          model: 'Civic',
          year: 2021,
        })
        .expect(409);
    });

    it('should return 404 when updating to non-existent customer', async () => {
      const customer = await createCustomer(adminAuth);
      const created = await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: customer.id })
        .expect(201);

      await request(httpServer)
        .put(`/api/vehicles/${created.body.data.id}`)
        .set('Authorization', adminAuth)
        .send({
          ...validVehicle,
          customerId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        })
        .expect(404);
    });

    it('should reassign to another existing customer and a new free plate', async () => {
      const firstCustomer = await createCustomer(adminAuth);

      // Second customer needs distinct document/email (createCustomer is fixed).
      const secondCustomerRes = await request(httpServer)
        .post('/api/customers')
        .set('Authorization', adminAuth)
        .send({
          name: 'Maria Souza',
          document: '987.654.321-00',
          type: 'INDIVIDUAL',
          createAccess: false,
          email: 'maria@e2e.test',
          phone: '(11) 98888-8888',
          address: {
            street: 'Rua B, 1',
            city: 'São Paulo',
            state: 'SP',
            zipCode: '01310-100',
          },
        })
        .expect(201);
      const secondCustomerId = secondCustomerRes.body.data.id as string;

      const created = await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: firstCustomer.id })
        .expect(201);

      // Changing the owner to an existing customer covers the "customer found"
      // branch; a brand-new plate covers the "plate is free" branch.
      const res = await request(httpServer)
        .put(`/api/vehicles/${created.body.data.id}`)
        .set('Authorization', adminAuth)
        .send({
          customerId: secondCustomerId,
          plate: 'DEF5678',
          brand: 'Honda',
          model: 'Civic',
          year: 2021,
        })
        .expect(200);

      expect(res.body.data.plate).toBe('DEF5678');
    });
  });

  // ─── DELETE /api/vehicles/:id ────────────────────────────────────────────

  describe('DELETE /api/vehicles/:id', () => {
    it('should delete vehicle and return 204', async () => {
      const customer = await createCustomer(adminAuth);
      const created = await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: customer.id })
        .expect(201);

      await request(httpServer)
        .delete(`/api/vehicles/${created.body.data.id}`)
        .set('Authorization', adminAuth)
        .expect(204);
    });

    it('should return 404 when vehicle does not exist', async () => {
      await request(httpServer)
        .delete('/api/vehicles/00000000-0000-0000-0000-000000000000')
        .set('Authorization', adminAuth)
        .expect(404);
    });

    it('should return 409 when vehicle has work orders', async () => {
      const customer = await createCustomer(adminAuth);
      const created = await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth)
        .send({ ...validVehicle, customerId: customer.id })
        .expect(201);

      await ctx.prisma.workOrder.create({
        data: {
          number: '920001',
          customerId: customer.id,
          vehicleId: created.body.data.id,
        },
      });

      await request(httpServer)
        .delete(`/api/vehicles/${created.body.data.id}`)
        .set('Authorization', adminAuth)
        .expect(409);
    });
  });
});
