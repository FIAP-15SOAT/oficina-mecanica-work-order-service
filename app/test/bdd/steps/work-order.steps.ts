import assert from 'node:assert/strict';
import { Given, Then, When } from '@cucumber/cucumber';
import request from 'supertest';

import { findEmails } from '../../helpers/mailhog.helper';
import { waitFor } from '../../helpers/wait-for.helper';
import { OficinaWorld, bdd } from '../support/world';

const ACCESS_USER_EMAIL = 'acesso@bdd.test';

Given('uma OS aberta com um serviço e uma peça', async function (this: OficinaWorld) {
  await this.openWorkOrder(true);
});

Given(
  'uma OS aguardando a aprovação do orçamento com uma peça',
  async function (this: OficinaWorld) {
    await this.openWorkOrder(true);
    await this.startDiagnosis();
    await this.sendQuote();
    await this.waitForWorkOrderStatus('AWAITING_APPROVAL');
  },
);

Given('uma OS aprovada com um serviço e sem peças', async function (this: OficinaWorld) {
  await this.openWorkOrder(false);
  await this.startDiagnosis();
  await this.sendQuote();
  await this.waitForWorkOrderStatus('AWAITING_APPROVAL');

  await this.approveQuote();
  await this.waitForWorkOrderStatus('APPROVED');
});

When('o atendente inicia o diagnóstico', async function (this: OficinaWorld) {
  await this.startDiagnosis();
});

When('o mecânico inicia o serviço', async function (this: OficinaWorld) {
  await changeServiceStatus(this, 'IN_PROGRESS');
});

When('o mecânico conclui o serviço', async function (this: OficinaWorld) {
  await changeServiceStatus(this, 'COMPLETED');
});

When('o atendente entrega a OS', async function (this: OficinaWorld) {
  const { ctx, staffToken } = bdd.context;

  await request(ctx.httpServer)
    .patch(`/api/work-orders/${this.workOrderId}`)
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ status: 'DELIVERED' })
    .expect(200);
});

Then('a OS fica {string}', async function (this: OficinaWorld, status: string) {
  await this.waitForWorkOrderStatus(status);
});

Then(
  'a Saga {string} fica {string}',
  async function (this: OficinaWorld, type: string, status: string) {
    await this.waitForSagaStatus(type, status);
  },
);

Then(
  'a mesma Saga {string} fica {string}',
  async function (this: OficinaWorld, type: string, status: string) {
    await this.waitForSagaStatus(type, status);

    const sagas = await bdd.context.ctx.prisma.sagaInstance.findMany({
      where: { workOrderId: this.workOrderId },
    });

    assert.equal(sagas.filter((saga) => saga.type === type).length, 1);
  },
);

Then('o histórico da OS mostra {string}', async function (this: OficinaWorld, statuses: string) {
  const history = await bdd.context.ctx.prisma.statusHistory.findMany({
    where: { workOrderId: this.workOrderId },
    orderBy: { createdAt: 'asc' },
  });

  assert.equal(history.map(({ newStatus }) => newStatus).join(', '), statuses);
});

Then('o cliente recebe o e-mail com o link de pagamento', async function (this: OficinaWorld) {
  await waitFor(async () => (await countPaymentEmails(this)) === 1, 10_000);
});

Then('nenhum e-mail com o link de pagamento é enviado', async function (this: OficinaWorld) {
  assert.equal(await countPaymentEmails(this), 0);
});

async function changeServiceStatus(
  world: OficinaWorld,
  status: 'IN_PROGRESS' | 'COMPLETED',
): Promise<void> {
  const { ctx, staffToken } = bdd.context;

  await request(ctx.httpServer)
    .patch(`/api/work-orders/${world.workOrderId}/services/${world.service.id}`)
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ status })
    .expect(200);
}

// The subject is RFC 2047 encoded and may split the work order number, so the e-mail is found by
// its link, which is unique per payment.
async function countPaymentEmails(world: OficinaWorld): Promise<number> {
  const emails = await findEmails(bdd.context.ctx.mailhogContainer, ACCESS_USER_EMAIL);

  return emails.filter(({ body }) => body.includes(world.payment.checkoutUrl)).length;
}
