import { When } from '@cucumber/cucumber';

import { OficinaWorld } from '../support/world';

When('o Billing aprova o orçamento', async function (this: OficinaWorld) {
  await this.approveQuote();
});
