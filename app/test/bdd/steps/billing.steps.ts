import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Then, When } from '@cucumber/cucumber';

import { publishEvent } from '../support/sns-events.helper';
import { OficinaWorld, bdd } from '../support/world';

When('o Billing envia o orçamento', async function (this: OficinaWorld) {
  await this.sendQuote();
});

When('o Billing aprova o orçamento', async function (this: OficinaWorld) {
  await this.approveQuote();
});

Then(
  'o work-order pede ao Billing a reversão da aprovação para {string}',
  async function (this: OficinaWorld, revertTo: string) {
    const command = await this.expectCommand('billing', 'billing.quote.revert_approval');

    assert.deepEqual(command.payload, { quoteId: this.quoteId, revertTo });
  },
);

When('o Billing confirma a reversão da aprovação', async function (this: OficinaWorld) {
  await publishEvent(bdd.context.sns, 'billing.quote.approval_reverted', this.workOrderId, {
    quoteId: this.quoteId,
    revertTo: 'SENT',
  });
});

When('o Billing pede o pagamento de {string}', async function (this: OficinaWorld, amount: string) {
  const id = randomUUID();

  this.payment = { id, amount, checkoutUrl: `https://pagamento.bdd.test/checkout/${id}` };

  await publishEvent(bdd.context.sns, 'billing.payment.requested', this.workOrderId, {
    paymentId: id,
    amount,
    checkoutUrl: this.payment.checkoutUrl,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
});

When('o Billing confirma o pagamento', async function (this: OficinaWorld) {
  await publishEvent(bdd.context.sns, 'billing.payment.approved', this.workOrderId, {
    paymentId: this.payment.id,
    amount: this.payment.amount,
    paidAt: new Date().toISOString(),
  });
});

When('o Billing informa que a cobrança expirou', async function (this: OficinaWorld) {
  await publishEvent(bdd.context.sns, 'billing.payment.failed', this.workOrderId, {
    paymentId: this.payment.id,
    reason: 'EXPIRED',
  });
});

Then(
  'o work-order pede ao Billing o cancelamento da cobrança',
  async function (this: OficinaWorld) {
    const command = await this.expectCommand('billing', 'billing.payment.cancel');

    assert.deepEqual(command.payload, {
      paymentId: this.payment.id,
      reason: 'WORK_ORDER_NOT_PAYABLE',
    });
  },
);

When('o Billing confirma o cancelamento da cobrança', async function (this: OficinaWorld) {
  await publishEvent(bdd.context.sns, 'billing.payment.failed', this.workOrderId, {
    paymentId: this.payment.id,
    reason: 'CANCELLED',
  });
});
