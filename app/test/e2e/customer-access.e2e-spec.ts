// test/e2e/customer-access.e2e-spec.ts
import type { Server } from 'http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { UserRole } from '@domain/enums/user-role.enum';
import { TestContext, setupTestApp, teardownTestApp } from '../helpers/test-app.helper';
import { cleanDatabase } from '../helpers/db-cleanup.helper';
import { StaffUser, createStaffUser, staffAuthHeader } from '../helpers/auth.helper';
import {
  InternalServicesStub,
  startInternalServicesStub,
  stubCustomerUser,
  stubIdentityUser,
} from '../helpers/internal-services-stub';

describe('Customer Access (E2E)', () => {
  let stub: InternalServicesStub;
  let ctx: TestContext;
  let httpServer: Server;
  let adminAuth: StaffUser;
  let attendantAuth: StaffUser;
  let mechanicAuth: StaffUser;

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
    stub.customerUsers.calls.length = 0;
    adminAuth = createStaffUser({ stub }, { name: 'Admin E2E' });

    attendantAuth = createStaffUser({ stub }, { name: 'Atendente E2E', role: UserRole.ATTENDANT });

    mechanicAuth = createStaffUser({ stub }, { name: 'Mecânico E2E', role: UserRole.MECHANIC });
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────

  let counter = 0;

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

  async function createCustomer(overrides: Record<string, unknown> = {}) {
    const id = ++counter;
    const res = await request(httpServer)
      .post('/api/customers')
      .set('Authorization', adminAuth.authorization)
      .send({
        name: `Cliente Acesso ${id}`,
        document: generateCPF(id),
        type: 'INDIVIDUAL',
        email: `cliente-acesso-${Date.now()}${id}@test.com`,
        phone: '11999999999',
        address: {
          street: 'Rua Teste, 123',
          city: 'São Paulo',
          state: 'SP',
          zipCode: '01310-100',
        },
        createAccess: false,
        ...overrides,
      })
      .expect(201);
    return res.body.data as { id: string; name: string; email: string; document: string };
  }

  function generatePlate(index: number) {
    return `ABC-${index.toString().padStart(4, '0')}`;
  }

  async function createCompanyCustomer(overrides: Record<string, unknown> = {}) {
    const id = ++counter;
    const res = await request(httpServer)
      .post('/api/customers')
      .set('Authorization', adminAuth.authorization)
      .send({
        name: `Empresa Acesso ${id} LTDA`,
        document: generateCNPJ(id),
        type: 'COMPANY',
        email: `empresa-acesso-${Date.now()}${id}@test.com`,
        phone: '11999999999',
        address: {
          street: 'Av. Teste, 456',
          city: 'São Paulo',
          state: 'SP',
          zipCode: '01310-100',
        },
        createAccess: false,
        ...overrides,
      })
      .expect(201);
    return res.body.data as { id: string; name: string; email: string; document: string };
  }

  async function grantAccess(customerId: string) {
    const user = stubCustomerUser(stub);

    await request(httpServer)
      .post(`/api/customers/${customerId}/users`)
      .set('Authorization', adminAuth.authorization)
      .send({})
      .expect(201);

    return user;
  }

  function findLinks(customerId: string) {
    return ctx.prisma.userCustomer.findMany({ where: { customerId }, select: { userId: true } });
  }

  // ─── POST /api/customers/:customerId/users ──────────────────────────

  describe('POST /api/customers/:customerId/users', () => {
    it('should create the user in the identity and grant access for an INDIVIDUAL customer', async () => {
      const customer = await createCustomer();
      const user = stubCustomerUser(stub);

      const res = await request(httpServer)
        .post(`/api/customers/${customer.id}/users`)
        .set('Authorization', adminAuth.authorization)
        .send({})
        .expect(201);

      expect(res.body.data).toEqual({
        user,
        customer: {
          id: customer.id,
          name: expect.any(String),
          type: 'INDIVIDUAL',
          isActive: true,
        },
        initialPasswordSent: true,
      });

      expect(stub.customerUsers.calls).toEqual([
        { name: customer.name, email: customer.email, cpf: customer.document },
      ]);

      expect(await findLinks(customer.id)).toEqual([{ userId: user.id }]);
    });

    it('should allow ATTENDANT to grant access', async () => {
      const customer = await createCustomer();

      stubCustomerUser(stub);

      await request(httpServer)
        .post(`/api/customers/${customer.id}/users`)
        .set('Authorization', attendantAuth.authorization)
        .send({})
        .expect(201);
    });

    it('should return 403 for MECHANIC role', async () => {
      const customer = await createCustomer();

      await request(httpServer)
        .post(`/api/customers/${customer.id}/users`)
        .set('Authorization', mechanicAuth.authorization)
        .send({})
        .expect(403);
    });

    it('should return 401 without a token', async () => {
      const customer = await createCustomer();

      await request(httpServer).post(`/api/customers/${customer.id}/users`).send({}).expect(401);
    });

    it('should return 404 without calling the identity when the customer does not exist', async () => {
      await request(httpServer)
        .post('/api/customers/00000000-0000-0000-0000-000000000000/users')
        .set('Authorization', adminAuth.authorization)
        .send({})
        .expect(404);

      expect(stub.customerUsers.calls).toEqual([]);
    });

    it('should send the person of the body with the cpf in digits only for a COMPANY customer', async () => {
      const company = await createCompanyCustomer();

      stubCustomerUser(stub);

      const res = await request(httpServer)
        .post(`/api/customers/${company.id}/users`)
        .set('Authorization', adminAuth.authorization)
        .send({ name: 'Operador da Empresa', email: 'operador@test.com', cpf: '529.982.247-25' })
        .expect(201);

      expect(res.body.data.initialPasswordSent).toBe(true);

      expect(stub.customerUsers.calls).toEqual([
        { name: 'Operador da Empresa', email: 'operador@test.com', cpf: '52998224725' },
      ]);
    });

    it('should refuse (business rule) granting access to a COMPANY customer without name/email/cpf', async () => {
      const company = await createCompanyCustomer();

      await request(httpServer)
        .post(`/api/customers/${company.id}/users`)
        .set('Authorization', adminAuth.authorization)
        .send({})
        .expect(409);

      expect(stub.customerUsers.calls).toEqual([]);
    });

    it.each([
      [
        'a name shorter than 3 characters',
        { name: 'Jo' },
        'O nome deve ter no mínimo 3 caracteres',
      ],
      ['a cpf without digits', { cpf: 'abc' }, 'CPF inválido'],
      ['a cpf with wrong check digits', { cpf: '529.982.247-26' }, 'CPF inválido'],
    ])('should return 400 without calling the identity for %s', async (_label, field, message) => {
      const company = await createCompanyCustomer();

      const res = await request(httpServer)
        .post(`/api/customers/${company.id}/users`)
        .set('Authorization', adminAuth.authorization)
        .send({
          name: 'Operador da Empresa',
          email: 'operador@test.com',
          cpf: '529.982.247-25',
          ...field,
        })
        .expect(400);

      expect(res.body.message).toContain(message);
      expect(stub.customerUsers.calls).toEqual([]);
    });

    it('should link the same user again when the grant is repeated after the link was not written', async () => {
      const customer = await createCustomer();
      const user = stubCustomerUser(stub);

      await request(httpServer)
        .post(`/api/customers/${customer.id}/users`)
        .set('Authorization', adminAuth.authorization)
        .send({})
        .expect(201);

      // The user exists in the identity, but the link is gone, as after a failed write.
      await ctx.prisma.userCustomer.deleteMany({ where: { customerId: customer.id } });
      stub.customerUsers.response = {
        status: 200,
        body: { data: { userId: user.id, created: false } },
      };

      const retry = await request(httpServer)
        .post(`/api/customers/${customer.id}/users`)
        .set('Authorization', adminAuth.authorization)
        .send({})
        .expect(201);

      expect(retry.body.data.user.id).toBe(user.id);
      expect(retry.body.data.initialPasswordSent).toBe(false);
      expect(await findLinks(customer.id)).toEqual([{ userId: user.id }]);
    });

    it('should answer the 409 of the identity with its message and write no link', async () => {
      const customer = await createCustomer();
      const message =
        'O e-mail informado já pertence a outro usuário. Verifique o cadastro do cliente';

      stub.customerUsers.response = {
        status: 409,
        body: { statusCode: 409, error: 'Conflict', message },
      };

      const res = await request(httpServer)
        .post(`/api/customers/${customer.id}/users`)
        .set('Authorization', adminAuth.authorization)
        .send({})
        .expect(409);

      expect(res.body.message).toBe(message);
      expect(await findLinks(customer.id)).toEqual([]);
    });

    it('should return 503 and write no link when the identity is unavailable', async () => {
      const customer = await createCustomer();

      stub.customerUsers.response = {
        status: 503,
        body: { statusCode: 503, error: 'Service Unavailable', message: 'Indisponível' },
      };

      const res = await request(httpServer)
        .post(`/api/customers/${customer.id}/users`)
        .set('Authorization', adminAuth.authorization)
        .send({})
        .expect(503);

      expect(res.body.message).toBe('Serviço de destino indisponível');
      expect(await findLinks(customer.id)).toEqual([]);
    });

    it('should return 409 when granting access twice to the same user/customer pair', async () => {
      const customer = await createCustomer();

      await grantAccess(customer.id);

      await request(httpServer)
        .post(`/api/customers/${customer.id}/users`)
        .set('Authorization', adminAuth.authorization)
        .send({})
        .expect(409);
    });

    it('should return 409 (business rule) without calling the identity when the customer is inactive', async () => {
      const customer = await createCustomer();

      await request(httpServer)
        .patch(`/api/customers/${customer.id}`)
        .set('Authorization', adminAuth.authorization)
        .send({ isActive: false })
        .expect(204);

      await request(httpServer)
        .post(`/api/customers/${customer.id}/users`)
        .set('Authorization', adminAuth.authorization)
        .send({})
        .expect(409);

      expect(stub.customerUsers.calls).toEqual([]);
    });
  });

  // ─── GET /api/customers/:customerId/users ───────────────────────────

  describe('GET /api/customers/:customerId/users', () => {
    it('should list the users granted access to the customer as the identity has them', async () => {
      const customer = await createCustomer();
      const user = await grantAccess(customer.id);

      const response = await request(httpServer)
        .get(`/api/customers/${customer.id}/users`)
        .set('Authorization', adminAuth.authorization)
        .expect(200);

      expect(response.body.data).toEqual([user]);
    });

    it('should leave out a linked user the identity no longer has', async () => {
      const customer = await createCustomer();
      const user = await grantAccess(customer.id);

      stub.users.delete(user.id);

      const response = await request(httpServer)
        .get(`/api/customers/${customer.id}/users`)
        .set('Authorization', adminAuth.authorization)
        .expect(200);

      expect(response.body.data).toEqual([]);
    });

    it('should return 404 for a non-existent customer', async () => {
      await request(httpServer)
        .get('/api/customers/00000000-0000-0000-0000-000000000000/users')
        .set('Authorization', adminAuth.authorization)
        .expect(404);
    });

    it('should return 403 for MECHANIC role', async () => {
      const customer = await createCustomer();

      await request(httpServer)
        .get(`/api/customers/${customer.id}/users`)
        .set('Authorization', mechanicAuth.authorization)
        .expect(403);
    });
  });

  // ─── GET /api/users/:userId/customers ───────────────────────────────

  describe('GET /api/users/:userId/customers', () => {
    it('should list the customers linked to the user', async () => {
      const customer = await createCustomer();
      const user = await grantAccess(customer.id);

      const response = await request(httpServer)
        .get(`/api/users/${user.id}/customers`)
        .set('Authorization', adminAuth.authorization)
        .expect(200);

      expect(response.body.data).toEqual([
        { id: customer.id, name: expect.any(String), type: 'INDIVIDUAL', isActive: true },
      ]);
    });

    it('should return an empty list for a user with no linked customer', async () => {
      const user = stubIdentityUser(stub);

      const response = await request(httpServer)
        .get(`/api/users/${user.id}/customers`)
        .set('Authorization', adminAuth.authorization)
        .expect(200);

      expect(response.body.data).toEqual([]);
    });

    it('should return 404 for a user the identity does not find', async () => {
      const userId = '00000000-0000-0000-0000-000000000000';

      const response = await request(httpServer)
        .get(`/api/users/${userId}/customers`)
        .set('Authorization', adminAuth.authorization)
        .expect(404);

      expect(response.body.message).toBe(`Usuário não encontrado(a) com identificador: ${userId}`);
    });

    it('should return 403 for MECHANIC role', async () => {
      await request(httpServer)
        .get(`/api/users/${attendantAuth.user.id}/customers`)
        .set('Authorization', mechanicAuth.authorization)
        .expect(403);
    });
  });

  // ─── DELETE /api/customers/:customerId/users/:userId ────────────────

  describe('DELETE /api/customers/:customerId/users/:userId', () => {
    it('should revoke access and return 204', async () => {
      const customer = await createCustomer();
      const user = await grantAccess(customer.id);

      await request(httpServer)
        .delete(`/api/customers/${customer.id}/users/${user.id}`)
        .set('Authorization', adminAuth.authorization)
        .expect(204);

      expect(await findLinks(customer.id)).toEqual([]);
    });

    it('should return 404 when the link does not exist', async () => {
      const customer = await createCustomer();

      await request(httpServer)
        .delete(`/api/customers/${customer.id}/users/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', adminAuth.authorization)
        .expect(404);
    });

    it('should return 403 for MECHANIC role', async () => {
      const customer = await createCustomer();
      const user = await grantAccess(customer.id);

      await request(httpServer)
        .delete(`/api/customers/${customer.id}/users/${user.id}`)
        .set('Authorization', mechanicAuth.authorization)
        .expect(403);
    });
  });

  describe('PATCH /api/customers/:customerId', () => {
    it('should deactivate an active customer and persist the change', async () => {
      const customer = await createCustomer();

      await request(httpServer)
        .patch(`/api/customers/${customer.id}`)
        .set('Authorization', adminAuth.authorization)
        .send({ isActive: false })
        .expect(204);

      const found = await ctx.prisma.customer.findUnique({ where: { id: customer.id } });

      expect(found?.isActive).toBe(false);
    });

    it('should reactivate a previously deactivated customer', async () => {
      const customer = await createCustomer();

      await request(httpServer)
        .patch(`/api/customers/${customer.id}`)
        .set('Authorization', adminAuth.authorization)
        .send({ isActive: false })
        .expect(204);

      await request(httpServer)
        .patch(`/api/customers/${customer.id}`)
        .set('Authorization', adminAuth.authorization)
        .send({ isActive: true })
        .expect(204);

      const found = await ctx.prisma.customer.findUnique({ where: { id: customer.id } });

      expect(found?.isActive).toBe(true);
    });

    it('should return 404 for a non-existent customer', async () => {
      await request(httpServer)
        .patch('/api/customers/00000000-0000-0000-0000-000000000000')
        .set('Authorization', adminAuth.authorization)
        .send({ isActive: false })
        .expect(404);
    });

    it('should return 403 for MECHANIC role', async () => {
      const customer = await createCustomer();

      await request(httpServer)
        .patch(`/api/customers/${customer.id}`)
        .set('Authorization', mechanicAuth.authorization)
        .send({ isActive: false })
        .expect(403);
    });

    it('should refuse (business rule) creating a vehicle for an inactive customer', async () => {
      const customer = await createCustomer();

      await request(httpServer)
        .patch(`/api/customers/${customer.id}`)
        .set('Authorization', adminAuth.authorization)
        .send({ isActive: false })
        .expect(204);

      await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth.authorization)
        .send({
          customerId: customer.id,
          plate: generatePlate(++counter),
          brand: 'Fiat',
          model: 'Uno',
          year: 2020,
        })
        .expect(409);
    });

    it('should refuse (business rule) opening a work order for an inactive customer', async () => {
      const customer = await createCustomer();

      const vehicle = await request(httpServer)
        .post('/api/vehicles')
        .set('Authorization', adminAuth.authorization)
        .send({
          customerId: customer.id,
          plate: generatePlate(++counter),
          brand: 'Fiat',
          model: 'Uno',
          year: 2020,
        })
        .expect(201);

      await request(httpServer)
        .patch(`/api/customers/${customer.id}`)
        .set('Authorization', adminAuth.authorization)
        .send({ isActive: false })
        .expect(204);

      await request(httpServer)
        .post('/api/work-orders')
        .set('Authorization', adminAuth.authorization)
        .send({
          customerId: customer.id,
          vehicleId: vehicle.body.data.id,
          problemDescription: 'Barulho no motor',
        })
        .expect(409);
    });
  });

  // ─── Staff token and routes owned by the Identity ───────────────────

  describe('staff token and routes owned by the Identity', () => {
    it('should authorize a staff route by the role in the token without the user in any database', async () => {
      const userId = randomUUID();

      await request(httpServer)
        .get('/api/customers')
        .set('Authorization', staffAuthHeader({ sub: userId, role: UserRole.ATTENDANT }))
        .expect(200);

      await request(httpServer)
        .get('/api/customers')
        .set('Authorization', staffAuthHeader({ sub: userId, role: UserRole.MECHANIC }))
        .expect(403);

      expect(stub.users.has(userId)).toBe(false);
    });

    it.each([
      ['post', '/api/auth/login'],
      ['get', '/api/users'],
      ['get', '/api/me'],
      ['patch', '/api/me/password'],
    ] as const)('should answer 404 to %s %s', async (method, path) => {
      await request(httpServer)
        [method](path)
        .set('Authorization', adminAuth.authorization)
        .expect(404);
    });
  });
});
