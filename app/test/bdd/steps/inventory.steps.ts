import assert from 'node:assert/strict';
import { Then, When } from '@cucumber/cucumber';

import { publishEvent } from '../support/sns-events.helper';
import { OficinaWorld, bdd } from '../support/world';

Then('o work-order pede ao Inventory a reserva da peça', async function (this: OficinaWorld) {
  const command = await this.expectCommand('inventory', 'inventory.stock.reserve');

  assert.deepEqual(command.payload, {
    quoteId: this.quoteId,
    items: [{ partSupplyId: this.partSupply?.id, quantity: 2 }],
  });
});

When('o Inventory confirma a reserva', async function (this: OficinaWorld) {
  await publishEvent(bdd.context.sns, 'inventory.stock.reserved', this.workOrderId, {
    quoteId: this.quoteId,
  });
});
