import { Controller, Get } from '@nestjs/common';
import type { Server } from 'http';
import type { StartedTestContainer } from 'testcontainers';
import * as bcrypt from 'bcrypt';
import { generateKeyPairSync } from 'node:crypto';
import { decode, JwtPayload, sign, verify } from 'jsonwebtoken';
import request from 'supertest';
import { TestContext, setupTestApp, teardownTestApp } from '../helpers/test-app.helper';
import { cleanDatabase } from '../helpers/db-cleanup.helper';
import { registerAndLogin } from '../helpers/auth.helper';
import { signTestCustomerToken } from '../helpers/customer-jwt.helper';
import {
  STAFF_JWT_TEST_KEY_ID,
  STAFF_JWT_TEST_PRIVATE_KEY,
  STAFF_JWT_TEST_PUBLIC_KEY,
  STAFF_REFRESH_TEST_PUBLIC_KEY,
  signTestRefreshToken,
  signTestStaffToken,
} from '../helpers/staff-jwt.helper';

interface MailhogMessage {
  Created: string;
  To: Array<{ Mailbox: string; Domain: string }>;
  Content: { Body: string };
}

interface MailhogResponse {
  items: MailhogMessage[];
}

async function fetchLatestResetCode(
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
      const codeMatch = matches[0].Content.Body.match(/\b(\d{6})\b/);

      if (codeMatch) {
        return codeMatch[1];
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`No password reset email found for ${toEmail}`);
}

@Controller('unmarked-test-route')
class UnmarkedTestController {
  @Get()
  find(): { data: string } {
    return { data: 'reached' };
  }
}

describe('Auth (E2E)', () => {
  let ctx: TestContext;
  let httpServer: Server;

  beforeAll(async () => {
    ctx = await setupTestApp({ controllers: [UnmarkedTestController] });
    httpServer = ctx.httpServer;
  });

  afterAll(async () => {
    await teardownTestApp(ctx);
  });

  beforeEach(async () => {
    await cleanDatabase(ctx.prisma);
  });

  // ─── Global authentication guard ─────────────────────────────────────────

  describe('Route without an authentication marker', () => {
    it('should answer 401 with the error body on an unmarked test route without token', async () => {
      const res = await request(httpServer).get('/api/unmarked-test-route').expect(401);

      expect(res.body).toEqual({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Token de autenticação inválido ou ausente',
      });
    });

    it('should answer 200 on an unmarked test route with a staff token', async () => {
      const auth = await registerAndLogin(httpServer, { email: 'unmarked@e2e.test' }, ctx.prisma);

      const res = await request(httpServer)
        .get('/api/unmarked-test-route')
        .set('Authorization', `Bearer ${auth.accessToken}`)
        .expect(200);

      expect(res.body).toEqual({ data: 'reached' });
    });
  });

  // ─── POST /api/auth/login ─────────────────────────────────────────────────

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await registerAndLogin(
        httpServer,
        {
          name: 'Login User',
          email: 'login@e2e.test',
          password: 'Senha@123',
          role: 'ADMIN',
        },
        ctx.prisma,
      );
    });

    it('should login successfully and return tokens', async () => {
      const res = await request(httpServer)
        .post('/api/auth/login')
        .send({ email: 'login@e2e.test', password: 'Senha@123' })
        .expect(200);

      expect(res.body.data).toEqual(
        expect.objectContaining({
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
          user: expect.objectContaining({
            id: expect.any(String),
            name: 'Login User',
            email: 'login@e2e.test',
            role: 'ADMIN',
          }),
        }),
      );
    });

    it('should return 401 with wrong password', async () => {
      await request(httpServer)
        .post('/api/auth/login')
        .send({ email: 'login@e2e.test', password: 'WrongPassword' })
        .expect(401);
    });

    it('should return 401 with non-existent email', async () => {
      await request(httpServer)
        .post('/api/auth/login')
        .send({ email: 'nope@e2e.test', password: 'Senha@123' })
        .expect(401);
    });

    it('should return 400 with missing fields', async () => {
      await request(httpServer)
        .post('/api/auth/login')
        .send({ email: 'login@e2e.test' })
        .expect(400);
    });

    it('should return 401 when user is deactivated', async () => {
      await ctx.prisma.user.updateMany({
        where: { email: 'login@e2e.test' },
        data: { isActive: false },
      });

      await request(httpServer)
        .post('/api/auth/login')
        .send({ email: 'login@e2e.test', password: 'Senha@123' })
        .expect(401);
    });

    /**
     * A purely external account (role null) uses the same password hash in
     * both flows — staff login must refuse before issuing any token, not only
     * later, on first use (CustomerJwtStrategy/JwtStrategy already block the
     * token itself, but the login contract must not say "OK" to an account
     * that will not be able to use anything).
     */
    it('should return 401 for an externally-only account (role null), never issuing a token', async () => {
      const passwordHash = await bcrypt.hash('External@123', 10);
      await ctx.prisma.user.create({
        data: {
          name: 'Cliente Externo',
          email: 'externo-login@e2e.test',
          cpf: '11144477735',
          passwordHash,
          role: null,
          isActive: true,
        },
      });

      await request(httpServer)
        .post('/api/auth/login')
        .send({ email: 'externo-login@e2e.test', password: 'External@123' })
        .expect(401);
    });
  });

  // ─── POST /api/auth/refresh ───────────────────────────────────────────────

  describe('POST /api/auth/refresh', () => {
    it('should refresh tokens successfully', async () => {
      const auth = await registerAndLogin(httpServer, {}, ctx.prisma);

      const res = await request(httpServer)
        .post('/api/auth/refresh')
        .send({ refreshToken: auth.refreshToken })
        .expect(200);

      expect(res.body.data).toEqual(
        expect.objectContaining({
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
        }),
      );
    });

    it('should return 401 with invalid refresh token', async () => {
      await request(httpServer)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid.token.here' })
        .expect(401);
    });

    it('should return 400 when refreshToken is missing', async () => {
      await request(httpServer).post('/api/auth/refresh').send({}).expect(400);
    });

    it('should return 401 when the user was deleted after the token was issued', async () => {
      const auth = await registerAndLogin(
        httpServer,
        { name: 'Refresh Deleted', email: 'refresh-deleted@e2e.test' },
        ctx.prisma,
      );

      await ctx.prisma.user.delete({ where: { id: auth.user.id } });

      await request(httpServer)
        .post('/api/auth/refresh')
        .send({ refreshToken: auth.refreshToken })
        .expect(401);
    });

    it('should return 401 when user is deactivated after token issued', async () => {
      const auth = await registerAndLogin(
        httpServer,
        {
          name: 'Refresh Inactive',
          email: 'refresh-inactive@e2e.test',
        },
        ctx.prisma,
      );

      await ctx.prisma.user.update({
        where: { id: auth.user.id },
        data: { isActive: false },
      });

      await request(httpServer)
        .post('/api/auth/refresh')
        .send({ refreshToken: auth.refreshToken })
        .expect(401);
    });

    /**
     * Login already refuses role null accounts (see the suite above), so in
     * practice none of them ever holds a legitimate refresh token. This test
     * covers the other side of the defense: if such a token existed (signed
     * by hand here with the same test key, simulating a token issued before
     * this fix, or through any other path), refresh must still refuse it —
     * the barrier must not depend on login alone.
     */
    it('should return 401 for an externally-only account (role null), never renewing the token', async () => {
      const passwordHash = await bcrypt.hash('External@123', 10);
      const user = await ctx.prisma.user.create({
        data: {
          name: 'Cliente Externo Refresh',
          email: 'externo-refresh@e2e.test',
          cpf: '52998224725',
          passwordHash,
          role: null,
          isActive: true,
        },
      });

      const forgedRefreshToken = signTestRefreshToken({
        sub: user.id,
        email: user.email,
        name: user.name,
        role: null,
      });

      await request(httpServer)
        .post('/api/auth/refresh')
        .send({ refreshToken: forgedRefreshToken })
        .expect(401);
    });
  });

  // ─── Staff token profile (RS256) ─────────────────────────────────────────

  describe('Staff token profile', () => {
    const staffClaims = {
      sub: '00000000-0000-4000-8000-000000000001',
      email: 'profile@e2e.test',
      name: 'Profile User',
      role: 'ADMIN',
    };

    const otherKey = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    }).privateKey;

    it('issues an access token that a service validates with only the public key and kid', async () => {
      const auth = await registerAndLogin(
        httpServer,
        { name: 'Contract User', email: 'contract@e2e.test' },
        ctx.prisma,
      );

      const { header } = decode(auth.accessToken, { complete: true })!;

      const claims = verify(auth.accessToken, STAFF_JWT_TEST_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'oficina-identity',
        audience: 'oficina-services',
      }) as JwtPayload;

      expect(header).toMatchObject({
        alg: 'RS256',
        kid: STAFF_JWT_TEST_KEY_ID,
      });

      expect(claims).toMatchObject({
        sub: auth.user.id,
        email: 'contract@e2e.test',
        name: 'Contract User',
        role: 'ADMIN',
        typ: 'access',
      });
      expect(claims.exp! - claims.iat!).toBe(600);
    });

    it('issues a refresh token with its own audience and type', async () => {
      const auth = await registerAndLogin(
        httpServer,
        { email: 'refresh-profile@e2e.test' },
        ctx.prisma,
      );

      const claims = verify(auth.refreshToken, STAFF_REFRESH_TEST_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'oficina-identity',
        audience: 'oficina-identity',
      }) as JwtPayload;

      expect(claims.typ).toBe('refresh');
      expect(claims.exp! - claims.iat!).toBe(604800);
    });

    it.each([
      ['HS256', () => sign({ ...staffClaims, typ: 'access' }, 'secret', { algorithm: 'HS256' })],
      [
        'without kid',
        () =>
          sign({ ...staffClaims, typ: 'access' }, STAFF_JWT_TEST_PRIVATE_KEY, {
            algorithm: 'RS256',
            issuer: 'oficina-identity',
            audience: 'oficina-services',
            expiresIn: 600,
          }),
      ],
      ['with another kid', () => signTestStaffToken(staffClaims, { keyid: 'other-kid' })],
      ['signed by another RS256 key', () => signTestStaffToken(staffClaims, {}, otherKey)],
      ['with another issuer', () => signTestStaffToken(staffClaims, { issuer: 'other' })],
      ['with another audience', () => signTestStaffToken(staffClaims, { audience: 'oficina-api' })],
      ['from the customer flow', () => signTestCustomerToken(staffClaims.sub)],
      ['refresh sent as access', () => signTestRefreshToken(staffClaims)],
    ])('rejects a token %s on a staff route with 401', async (_case, token) => {
      await ctx.prisma.user.create({
        data: {
          id: staffClaims.sub,
          name: staffClaims.name,
          email: staffClaims.email,
          passwordHash: 'x',
          role: 'ADMIN',
        },
      });

      await request(httpServer)
        .get('/api/unmarked-test-route')
        .set('Authorization', `Bearer ${token()}`)
        .expect(401);
    });

    it('rejects an access token sent to POST /api/auth/refresh', async () => {
      const auth = await registerAndLogin(
        httpServer,
        { email: 'access-as-refresh@e2e.test' },
        ctx.prisma,
      );

      const res = await request(httpServer)
        .post('/api/auth/refresh')
        .send({ refreshToken: auth.accessToken })
        .expect(401);

      expect(res.body.data).toBeUndefined();
    });
  });

  // ─── Changing the password invalidates tokens issued before it ─────────────

  describe('Password change invalidates previously issued tokens', () => {
    it('rejects the old access and refresh tokens after PATCH /api/me/password, while the new password logs in fine', async () => {
      const auth = await registerAndLogin(
        httpServer,
        { name: 'Password Rotation', email: 'password-rotation@e2e.test', password: 'Old@Pass1' },
        ctx.prisma,
      );

      // iat has one-second granularity; make the change land in the second
      // after the login, so rounding does not make them collide.
      await new Promise((resolve) => setTimeout(resolve, 1100));

      await request(httpServer)
        .patch('/api/me/password')
        .set('Authorization', `Bearer ${auth.accessToken}`)
        .send({ currentPassword: 'Old@Pass1', newPassword: 'New@Pass2' })
        .expect(204);

      await request(httpServer)
        .get('/api/me')
        .set('Authorization', `Bearer ${auth.accessToken}`)
        .expect(401);

      await request(httpServer)
        .post('/api/auth/refresh')
        .send({ refreshToken: auth.refreshToken })
        .expect(401);

      await request(httpServer)
        .post('/api/auth/login')
        .send({ email: 'password-rotation@e2e.test', password: 'New@Pass2' })
        .expect(200);
    });
  });

  // ─── GET /api/me ──────────────────────────────────────────────────────────

  describe('GET /api/me', () => {
    it('should return current user data for an internal principal', async () => {
      const auth = await registerAndLogin(
        httpServer,
        { name: 'Me User', email: 'me@e2e.test' },
        ctx.prisma,
      );

      const res = await request(httpServer)
        .get('/api/me')
        .set('Authorization', `Bearer ${auth.accessToken}`)
        .expect(200);

      expect(res.body.data).toEqual(
        expect.objectContaining({
          id: auth.user.id,
          name: 'Me User',
          email: 'me@e2e.test',
          role: 'ADMIN',
          customers: [],
        }),
      );
    });

    it('should return 401 without token', async () => {
      await request(httpServer).get('/api/me').expect(401);
    });

    it('should return 401 with invalid token', async () => {
      await request(httpServer)
        .get('/api/me')
        .set('Authorization', 'Bearer invalid.token.here')
        .expect(401);
    });

    it('should return 401 when user is deactivated after token issued', async () => {
      const auth = await registerAndLogin(
        httpServer,
        {
          name: 'Me Inactive',
          email: 'me-inactive@e2e.test',
        },
        ctx.prisma,
      );

      await ctx.prisma.user.update({
        where: { id: auth.user.id },
        data: { isActive: false },
      });

      await request(httpServer)
        .get('/api/me')
        .set('Authorization', `Bearer ${auth.accessToken}`)
        .expect(401);
    });
  });

  // ─── POST /api/users/:userId/password-resets + POST /api/auth/password-reset-confirmations ─

  describe('Password reset by numeric code', () => {
    it('should let an admin issue a code and the user confirm a new password with it', async () => {
      const adminAuth = await registerAndLogin(
        httpServer,
        { name: 'Admin Reset', email: `admin-reset-${Date.now()}@e2e.test`, role: 'ADMIN' },
        ctx.prisma,
      );
      const targetEmail = `target-reset-${Date.now()}@e2e.test`;

      const createRes = await request(httpServer)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: 'Target User', email: targetEmail, role: 'ATTENDANT' })
        .expect(201);

      const targetUserId = createRes.body.data.id;

      // Token signed for the target before the reset — proves that confirming
      // by code also invalidates old sessions, not only the authenticated change.
      const tokenIssuedBeforeReset = signTestStaffToken({
        sub: targetUserId,
        email: targetEmail,
        name: 'Target User',
        role: 'ATTENDANT',
      });

      // iat has one-second granularity; make the reset confirmation land in
      // the second after the signing, so rounding does not make them collide
      // (the MailHog fetch can be too fast for that to happen naturally).
      await new Promise((resolve) => setTimeout(resolve, 1100));

      await request(httpServer)
        .post(`/api/users/${targetUserId}/password-resets`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(204);

      const code = await fetchLatestResetCode(ctx.mailhogContainer, targetEmail);

      await request(httpServer)
        .post('/api/auth/password-reset-confirmations')
        .send({ email: targetEmail, code, newPassword: 'NewPass@789' })
        .expect(204);

      await request(httpServer)
        .post('/api/auth/login')
        .send({ email: targetEmail, password: 'NewPass@789' })
        .expect(200);

      await request(httpServer)
        .get('/api/me')
        .set('Authorization', `Bearer ${tokenIssuedBeforeReset}`)
        .expect(401);
    });

    it('should exhaust the code after 5 wrong confirmation attempts', async () => {
      const adminAuth = await registerAndLogin(
        httpServer,
        { name: 'Admin Reset 2', email: `admin-reset2-${Date.now()}@e2e.test`, role: 'ADMIN' },
        ctx.prisma,
      );
      const targetEmail = `target-exhaust-${Date.now()}@e2e.test`;

      const createRes = await request(httpServer)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: 'Target User 2', email: targetEmail, role: 'ATTENDANT' })
        .expect(201);

      const targetUserId = createRes.body.data.id;

      await request(httpServer)
        .post(`/api/users/${targetUserId}/password-resets`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(204);

      const code = await fetchLatestResetCode(ctx.mailhogContainer, targetEmail);

      for (let i = 0; i < 5; i++) {
        await request(httpServer)
          .post('/api/auth/password-reset-confirmations')
          .send({ email: targetEmail, code: '999999', newPassword: 'NewPass@789' })
          .expect(401);
      }

      // The code is now exhausted, even with the correct value.
      await request(httpServer)
        .post('/api/auth/password-reset-confirmations')
        .send({ email: targetEmail, code, newPassword: 'NewPass@789' })
        .expect(401);
    });

    /**
     * The attempt counter must be an atomic increment in the database — a
     * plain in-memory read-modify-write (read attempts, add 1, write the
     * absolute value) loses increments under concurrency: N simultaneous
     * requests read the same initial value and all write N+1, never N+N.
     * Without that atomicity, the 5-attempt ceiling is never reached.
     */
    it('should exhaust the code after 10 concurrent wrong confirmation attempts', async () => {
      const adminAuth = await registerAndLogin(
        httpServer,
        {
          name: 'Admin Reset Race',
          email: `admin-reset-race-${Date.now()}@e2e.test`,
          role: 'ADMIN',
        },
        ctx.prisma,
      );
      const targetEmail = `target-race-${Date.now()}@e2e.test`;

      const createRes = await request(httpServer)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: 'Target User Race', email: targetEmail, role: 'ATTENDANT' })
        .expect(201);

      const targetUserId = createRes.body.data.id;

      await request(httpServer)
        .post(`/api/users/${targetUserId}/password-resets`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(204);

      const code = await fetchLatestResetCode(ctx.mailhogContainer, targetEmail);

      await Promise.all(
        Array.from({ length: 10 }, () =>
          request(httpServer)
            .post('/api/auth/password-reset-confirmations')
            .send({ email: targetEmail, code: '999999', newPassword: 'NewPass@789' })
            .expect(401),
        ),
      );

      // Even the correct code must no longer work — the counter must have
      // reached the 5-attempt ceiling despite the concurrent requests.
      await request(httpServer)
        .post('/api/auth/password-reset-confirmations')
        .send({ email: targetEmail, code, newPassword: 'NewPass@789' })
        .expect(401);
    });

    it('should invalidate a previously issued code when a new one is issued', async () => {
      const adminAuth = await registerAndLogin(
        httpServer,
        { name: 'Admin Reset 3', email: `admin-reset3-${Date.now()}@e2e.test`, role: 'ADMIN' },
        ctx.prisma,
      );
      const targetEmail = `target-invalidate-${Date.now()}@e2e.test`;

      const createRes = await request(httpServer)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: 'Target User 3', email: targetEmail, role: 'ATTENDANT' })
        .expect(201);

      const targetUserId = createRes.body.data.id;

      await request(httpServer)
        .post(`/api/users/${targetUserId}/password-resets`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(204);

      const oldCode = await fetchLatestResetCode(ctx.mailhogContainer, targetEmail);

      await request(httpServer)
        .post(`/api/users/${targetUserId}/password-resets`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(204);

      const newCode = await fetchLatestResetCode(ctx.mailhogContainer, targetEmail);

      await request(httpServer)
        .post('/api/auth/password-reset-confirmations')
        .send({ email: targetEmail, code: oldCode, newPassword: 'NewPass@789' })
        .expect(401);

      await request(httpServer)
        .post('/api/auth/password-reset-confirmations')
        .send({ email: targetEmail, code: newCode, newPassword: 'NewPass@789' })
        .expect(204);
    });

    /**
     * Expiry comes from the persisted timestamp, not the test clock: moving
     * `expires_at` in the database is the only way to exercise the window
     * without waiting for the real validity period.
     */
    it('should return 401 for a code that has already expired', async () => {
      const adminAuth = await registerAndLogin(
        httpServer,
        { name: 'Admin Reset 6', email: `admin-reset6-${Date.now()}@e2e.test`, role: 'ADMIN' },
        ctx.prisma,
      );
      const targetEmail = `target-reset6-${Date.now()}@e2e.test`;

      const createRes = await request(httpServer)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: 'Target User 6', email: targetEmail, role: 'ATTENDANT' })
        .expect(201);

      await request(httpServer)
        .post(`/api/users/${createRes.body.data.id}/password-resets`)
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(204);

      const code = await fetchLatestResetCode(ctx.mailhogContainer, targetEmail);

      await ctx.prisma.passwordResetCode.update({
        where: { userId: createRes.body.data.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      await request(httpServer)
        .post('/api/auth/password-reset-confirmations')
        .send({ email: targetEmail, code, newPassword: 'NewPass@789' })
        .expect(401);
    });

    it('should return 404 when issuing a code for a non-existent user', async () => {
      const adminAuth = await registerAndLogin(
        httpServer,
        { name: 'Admin Reset 4', email: `admin-reset4-${Date.now()}@e2e.test`, role: 'ADMIN' },
        ctx.prisma,
      );

      await request(httpServer)
        .post('/api/users/00000000-0000-0000-0000-000000000000/password-resets')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .expect(404);
    });

    /**
     * Confirmation is anonymous: an unknown e-mail and a never-issued code must
     * answer the **same** `401` as a wrong code, or the route becomes an
     * account existence oracle.
     */
    it('should return 401 for an unknown e-mail', async () => {
      await request(httpServer)
        .post('/api/auth/password-reset-confirmations')
        .send({
          email: `desconhecido-${Date.now()}@e2e.test`,
          code: '123456',
          newPassword: 'NewPass@789',
        })
        .expect(401);
    });

    it('should return 401 when no code was ever issued for the user', async () => {
      const adminAuth = await registerAndLogin(
        httpServer,
        { name: 'Admin Reset 5', email: `admin-reset5-${Date.now()}@e2e.test`, role: 'ADMIN' },
        ctx.prisma,
      );
      const targetEmail = `target-reset5-${Date.now()}@e2e.test`;

      await request(httpServer)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminAuth.accessToken}`)
        .send({ name: 'Target User 5', email: targetEmail, role: 'ATTENDANT' })
        .expect(201);

      await request(httpServer)
        .post('/api/auth/password-reset-confirmations')
        .send({ email: targetEmail, code: '123456', newPassword: 'NewPass@789' })
        .expect(401);
    });
  });
});
