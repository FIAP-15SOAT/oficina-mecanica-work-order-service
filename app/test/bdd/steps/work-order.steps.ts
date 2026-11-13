import { Given, Then } from '@cucumber/cucumber';

import { OficinaWorld } from '../support/world';

Given(
  'uma OS aguardando a aprovação do orçamento com uma peça',
  async function (this: OficinaWorld) {
    await this.openWorkOrder(true);
    await this.startDiagnosis();
    await this.sendQuote();
    await this.waitForWorkOrderStatus('AWAITING_APPROVAL');
  },
);

Then('a OS fica {string}', async function (this: OficinaWorld, status: string) {
  await this.waitForWorkOrderStatus(status);
});
