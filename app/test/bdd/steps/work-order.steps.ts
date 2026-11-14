import assert from 'node:assert/strict';
import { Given, Then, When } from '@cucumber/cucumber';
import request from 'supertest';

import { MessageEnvelope } from '@application/messaging/message-envelope';
import { receiveCommands } from '../../helpers/sqs-commands.helper';
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
  const emails: EmailEnvelope[] = [];

  await waitFor(async () => {
    emails.push(...(await receiveEmails(this)));

    return countPaymentEmails(this, emails) > 0;
  }, 10_000);

  assert.equal(countPaymentEmails(this, emails), 1);
});

Then('nenhum e-mail com o link de pagamento é enviado', async function (this: OficinaWorld) {
  assert.equal(countPaymentEmails(this, await receiveEmails(this)), 0);
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

type EmailEnvelope = MessageEnvelope<'notification.email.send'>;

// The notification queue only receives e-mails, and receiving deletes them, so a caller that
// polls keeps what each call returns.
async function receiveEmails(world: OficinaWorld): Promise<EmailEnvelope[]> {
  const { sqs, queueUrls } = bdd.context;

  return (await receiveCommands(
    sqs,
    queueUrls.notification,
    world.workOrderId,
    0,
  )) as EmailEnvelope[];
}

// The link is unique per payment, so it tells this payment's e-mail apart from a repeated one.
function countPaymentEmails(world: OficinaWorld, emails: EmailEnvelope[]): number {
  return emails.filter(
    ({ payload }) =>
      payload.purpose === 'payment_link' &&
      payload.to.includes(ACCESS_USER_EMAIL) &&
      payload.text.includes(world.payment.checkoutUrl),
  ).length;
}
