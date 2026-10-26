import { context, propagation } from '@opentelemetry/api';

import { PrismaService } from '@infrastructure/persistence/prisma/prisma.service';
import { IOutboxRepository } from '@domain/interfaces/repositories/outbox.repository.interface';
import { OutboxMessage } from '@domain/messaging/message-catalog';

export class PrismaOutboxRepository implements IOutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  async add(message: OutboxMessage): Promise<void> {
    const traceContext: Record<string, string> = {};
    propagation.inject(context.active(), traceContext);

    await this.prisma.outboxMessage.create({
      data: {
        type: message.type,
        workOrderId: message.workOrderId,
        payload: message.payload,
        traceContext,
      },
    });
  }
}
