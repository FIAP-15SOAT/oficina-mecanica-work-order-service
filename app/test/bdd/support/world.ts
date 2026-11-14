import assert from 'node:assert/strict';
import type { SNSClient } from '@aws-sdk/client-sns';
import type { SQSClient } from '@aws-sdk/client-sqs';
import { World, setWorldConstructor } from '@cucumber/cucumber';
import request from 'supertest';

import { MessageEnvelope } from '@application/messaging/message-envelope';
import { MessageType } from '@domain/messaging/message-catalog';
import { readInternalQuoteFixture } from '../../helpers/billing-quotes-gateway-mock.factory';
import {
  InternalServicesStub,
  stubPartSupply,
  stubService,
} from '../../helpers/internal-services-stub';
import { receiveCommands } from '../../helpers/sqs-commands.helper';
import { TestContext } from '../../helpers/test-app.helper';
import { waitFor } from '../../helpers/wait-for.helper';
import { publishEvent } from './sns-events.helper';

export interface BddContext {
  ctx: TestContext;
  stub: InternalServicesStub;
  sns: SNSClient;
  sqs: SQSClient;
  queueUrls: { billing: string; inventory: string; notification: string };
  staffToken: string;
  staffUserId: string;
  customerId: string;
  vehicleId: string;
}

/** Started once per run by the BeforeAll hook and shared by every scenario. */
export const bdd = {} as { context: BddContext };

type StubQuote = Record<string, unknown> & { workOrderId: string };

const SERVICE_PRICE = 150;
const PART_SUPPLY_PRICE = 45;
const PART_SUPPLY_QUANTITY = 2;

/** One per scenario: the work order the scenario drives and the items of its quote. */
export class OficinaWorld extends World {
  workOrderId!: string;
  workOrderNumber!: string;
  quoteId!: string;
  payment!: { id: string; amount: string; checkoutUrl: string };
  service!: { id: string; name: string; basePrice: number };
  partSupply?: { id: string; name: string; salePrice: number };

  async openWorkOrder(withPartSupply: boolean): Promise<void> {
    const { ctx, stub, staffToken, customerId, vehicleId } = bdd.context;

    this.service = stubService(stub, { basePrice: SERVICE_PRICE });
    this.partSupply = withPartSupply
      ? stubPartSupply(stub, { salePrice: PART_SUPPLY_PRICE })
      : undefined;

    const res = await request(ctx.httpServer)
      .post('/api/work-orders')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        customerId,
        vehicleId,
        problemDescription: 'Revisão geral',
        services: [{ serviceId: this.service.id, quantity: 1 }],
        partsSupplies: this.partSupply
          ? [{ partSupplyId: this.partSupply.id, quantity: PART_SUPPLY_QUANTITY }]
          : [],
      })
      .expect(201);

    this.workOrderId = res.body.data.id;
    this.workOrderNumber = res.body.data.number;
  }

  async startDiagnosis(): Promise<void> {
    const { ctx, staffToken } = bdd.context;

    await request(ctx.httpServer)
      .patch(`/api/work-orders/${this.workOrderId}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ status: 'IN_DIAGNOSIS' })
      .expect(200);
  }

  /** Sends the initial quote the opening created and stores it with its items for the approval. */
  async sendQuote(): Promise<void> {
    const { stub, sns, staffUserId } = bdd.context;

    const initialQuote = ([...stub.quotes.values()] as StubQuote[]).find(
      (quote) => quote.workOrderId === this.workOrderId,
    );

    assert.ok(initialQuote, `no quote in the Billing stub for work order ${this.workOrderId}`);

    const fixture = readInternalQuoteFixture().data;

    this.quoteId = initialQuote.id as string;

    stub.quotes.set(this.quoteId, {
      ...fixture,
      id: this.quoteId,
      workOrderId: this.workOrderId,
      decidedBy: staffUserId,
      services: [
        { ...fixture.services[0], id: this.service.id, quantity: 1, unitPrice: SERVICE_PRICE },
      ],
      partsSupplies: this.partSupply
        ? [
            {
              ...fixture.partsSupplies[0],
              id: this.partSupply.id,
              quantity: PART_SUPPLY_QUANTITY,
              unitPrice: PART_SUPPLY_PRICE,
            },
          ]
        : [],
    });

    await publishEvent(sns, 'billing.quote.sent', this.workOrderId, {
      quoteId: this.quoteId,
      sentBy: staffUserId,
      total: this.quoteTotal(),
      items: [
        { name: this.service.name, quantity: 1, unitPrice: SERVICE_PRICE.toFixed(2) },
        ...(this.partSupply
          ? [
              {
                name: this.partSupply.name,
                quantity: PART_SUPPLY_QUANTITY,
                unitPrice: PART_SUPPLY_PRICE.toFixed(2),
              },
            ]
          : []),
      ],
    });
  }

  async approveQuote(): Promise<void> {
    const { sns, staffUserId } = bdd.context;

    await publishEvent(sns, 'billing.quote.approved', this.workOrderId, {
      quoteId: this.quoteId,
      decidedBy: staffUserId,
      total: this.quoteTotal(),
      services: [{ serviceId: this.service.id, quantity: 1, unitPrice: SERVICE_PRICE.toFixed(2) }],
      partsSupplies: this.partSupply
        ? [
            {
              partSupplyId: this.partSupply.id,
              quantity: PART_SUPPLY_QUANTITY,
              unitPrice: PART_SUPPLY_PRICE.toFixed(2),
            },
          ]
        : [],
    });
  }

  async waitForWorkOrderStatus(status: string): Promise<void> {
    const { ctx } = bdd.context;

    await waitFor(
      async () =>
        (await ctx.prisma.workOrder.findUniqueOrThrow({ where: { id: this.workOrderId } }))
          .status === status,
    );
  }

  async waitForSagaStatus(type: string, status: string): Promise<void> {
    const { ctx } = bdd.context;

    await waitFor(async () =>
      (await ctx.prisma.sagaInstance.findMany({ where: { workOrderId: this.workOrderId } })).some(
        (saga) => saga.type === type && saga.status === status,
      ),
    );
  }

  async expectCommand<T extends MessageType>(
    queue: 'billing' | 'inventory',
    type: T,
  ): Promise<MessageEnvelope<T>> {
    const { sqs, queueUrls } = bdd.context;

    const commands = await receiveCommands(sqs, queueUrls[queue], this.workOrderId, 1);
    const command = commands.find((envelope) => envelope.type === type);

    assert.ok(command, `no ${type} for work order ${this.workOrderId} in the ${queue} queue`);

    return command as MessageEnvelope<T>;
  }

  private quoteTotal(): string {
    const partsTotal = this.partSupply ? PART_SUPPLY_PRICE * PART_SUPPLY_QUANTITY : 0;

    return (SERVICE_PRICE + partsTotal).toFixed(2);
  }
}

setWorldConstructor(OficinaWorld);
