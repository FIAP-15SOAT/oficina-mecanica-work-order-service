import { Controller, Get } from '@nestjs/common';
import type { Server } from 'http';
import type { StartedTestContainer } from 'testcontainers';
import * as bcrypt from 'bcrypt';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { TestContext, setupTestApp, teardownTestApp } from '../helpers/test-app.helper';
import { cleanDatabase } from '../helpers/db-cleanup.helper';
import { registerAndLogin } from '../helpers/auth.helper';

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
        message: 'Token de autenticação inválido ou ausente.',
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
     * Uma conta puramente externa (role null) usa o mesmo hash de senha nos
     * dois fluxos — o login interno precisa recusar antes de emitir qualquer
     * token, e não só depois, no primeiro uso (CustomerJwtStrategy/JwtStrategy
     * já bloqueiam o token em si, mas o contrato de login não pode dizer "OK"
     * para uma conta que não vai conseguir usar nada).
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
     * Login já recusa contas role null (ver suite acima), então uma delas
     * nunca tem, na prática, um refresh token legítimo em mãos. Este teste
     * cobre o outro lado da defesa: se um token desses existisse (assinado
     * manualmente aqui com o mesmo secret de teste, simulando um token
     * emitido antes desta correção, ou por qualquer outro caminho), o refresh
     * ainda assim tem que recusar — a barreira não pode depender só do login.
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

      const forgedRefreshToken = sign(
        { sub: user.id, email: user.email, role: null },
        process.env.JWT_REFRESH_SECRET!,
        { expiresIn: '7d' },
      );

      await request(httpServer)
        .post('/api/auth/refresh')
        .send({ refreshToken: forgedRefreshToken })
        .expect(401);
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

      // iat tem granularidade de segundo; garante que a troca cai num segundo
      // seguinte ao do login, para não colidir por arredondamento.
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

      // Token assinado para o alvo antes do reset — prova que a confirmação
      // por código também invalida sessões antigas, não só a troca autenticada.
      const tokenIssuedBeforeReset = sign(
        { sub: targetUserId, email: targetEmail, role: 'ATTENDANT' },
        process.env.JWT_SECRET!,
        { expiresIn: '15m' },
      );

      // iat tem granularidade de segundo; garante que a confirmação do reset
      // cai num segundo seguinte ao da assinatura, para não colidir por
      // arredondamento (o fetch no MailHog pode ser rápido demais para isso
      // acontecer naturalmente).
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
     * O contador de tentativas precisa ser um incremento atômico no banco —
     * um simples read-modify-write em memória (ler attempts, somar 1, gravar
     * o valor absoluto) perde incrementos sob concorrência: N requisições
     * simultâneas leem o mesmo valor inicial e todas gravam N+1, nunca N+N.
     * Sem essa atomicidade, o teto de 5 tentativas nunca é alcançado.
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
     * A expiração é do carimbo persistido, não do relógio do teste: adiantar
     * `expires_at` no banco é a única forma de exercitar a janela sem esperar
     * o prazo real de validade.
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
     * A confirmação é anônima: e-mail desconhecido e código nunca emitido têm
     * de responder o **mesmo** `401` de um código errado, ou a rota vira um
     * oráculo de existência de conta.
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
