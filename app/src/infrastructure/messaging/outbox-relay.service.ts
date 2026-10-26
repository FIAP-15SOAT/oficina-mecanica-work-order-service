import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { context, propagation, ROOT_CONTEXT } from '@opentelemetry/api';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { PinoLogger } from 'nestjs-pino';

import { ILogger } from '@application/ports/output/logger.service.interface';
import { TECHNICAL_EVENTS } from '@infrastructure/logging/technical-event.catalog';
import { PrismaService } from '@infrastructure/persistence/prisma/prisma.service';

import { messagingLogBindings } from './messaging-log-bindings';

// Any bigint unique within this database; every replica must use the same one.
export const OUTBOX_RELAY_LOCK_KEY = 7_310_001;

// Small enough that a backlog batch fits the 5 s interactive transaction timeout.
export const OUTBOX_BATCH_SIZE = 10;

export const OUTBOX_POLL_INTERVAL_MS = 500;

// No publish starts after it: plus one SNS request timeout, the deletes still commit inside 5 s.
export const OUTBOX_BATCH_BUDGET_MS = 2_000;

interface OutboxRow {
  messageId: string;
  type: string;
  workOrderId: string | null;
  payload: unknown;
  traceContext: unknown;
  createdAt: Date;
}

@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly topicArn: string;
  private readonly topicName: string;
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sns: SNSClient,
    config: ConfigService,
    private readonly pinoLogger: PinoLogger,
    @Inject('ILogger') private readonly logger: ILogger,
  ) {
    this.topicArn = config.getOrThrow<string>('MESSAGING_TOPIC_ARN');
    this.topicName = this.topicArn.slice(this.topicArn.lastIndexOf(':') + 1);
  }

  onApplicationBootstrap(): void {
    this.schedule();
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.inFlight;
  }

  async runBatch(): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const deadline = Date.now() + OUTBOX_BATCH_BUDGET_MS;

      // Only one replica publishes at a time; the others skip the tick instead of waiting.
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${OUTBOX_RELAY_LOCK_KEY}::bigint) AS locked`;

      if (!locked) {
        return;
      }

      const rows = await tx.outboxMessage.findMany({
        orderBy: { id: 'asc' },
        take: OUTBOX_BATCH_SIZE,
      });

      const published: bigint[] = [];

      for (const row of rows) {
        if (Date.now() >= deadline || !(await this.publish(row))) {
          break;
        }

        published.push(row.id);
      }

      if (published.length > 0) {
        await tx.outboxMessage.deleteMany({ where: { id: { in: published } } });
      }
    });
  }

  // setTimeout re-armed after each batch, never setInterval, so batches never overlap.
  private schedule(): void {
    this.timer = setTimeout(() => {
      this.inFlight = this.runBatch()
        // shortcut: one error line per tick while the database is down, add backoff if it floods
        .catch((error: unknown) => this.logger.error('outbox relay batch failed', error))
        .finally(() => {
          this.inFlight = undefined;

          if (!this.stopped) {
            this.schedule();
          }
        });
    }, OUTBOX_POLL_INTERVAL_MS);
  }

  private publish(row: OutboxRow): Promise<boolean> {
    const parent = propagation.extract(ROOT_CONTEXT, row.traceContext as Record<string, string>);

    return context.with(parent, async () => {
      try {
        await this.sns.send(
          new PublishCommand({
            TopicArn: this.topicArn,
            Message: JSON.stringify({
              messageId: row.messageId,
              type: row.type,
              occurredAt: row.createdAt.toISOString(),
              workOrderId: row.workOrderId,
              payload: row.payload,
            }),
            MessageGroupId: row.workOrderId ?? row.messageId,
            MessageDeduplicationId: row.messageId,
            MessageAttributes: { type: { DataType: 'String', StringValue: row.type } },
          }),
        );

        return true;
      } catch (error) {
        this.logPublishFailed(row, error);

        return false;
      }
    });
  }

  private logPublishFailed(row: OutboxRow, error: unknown): void {
    const bindings = messagingLogBindings({
      system: 'aws_sns',
      destination: this.topicName,
      messageId: row.messageId,
      operation: 'publish',
      type: row.type,
      workOrderId: row.workOrderId,
    });

    this.pinoLogger.runInContext(
      () => this.logger.event(TECHNICAL_EVENTS.MESSAGING_OUTBOX_PUBLISH_FAILED, {}, error),
      { bindings },
    );
  }
}
