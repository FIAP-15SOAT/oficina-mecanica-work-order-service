import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Context,
  Counter,
  metrics,
  propagation,
  ROOT_CONTEXT,
  Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { GetQueueUrlCommand, Message, SQSClient } from '@aws-sdk/client-sqs';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PinoLogger } from 'nestjs-pino';
import { Consumer } from 'sqs-consumer';

import { MessageEnvelope } from '@application/messaging/message-envelope';
import { ILogger } from '@application/ports/output/logger.service.interface';
import { TECHNICAL_EVENTS } from '@infrastructure/logging/technical-event.catalog';

import { MessageEnvelopeDto } from './message-envelope.dto';
import { MessageHandlerRegistry } from './message-handler.registry';
import { messagingLogBindings } from './messaging-log-bindings';

export const MAX_RECEIVE_COUNT = 5;

type ConsumeOutcome = 'success' | 'retry' | 'dead_lettered';

class UnhandledMessageError extends Error {}

@Injectable()
export class SqsConsumerService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly queueName: string;
  private readonly consumedMessagesCounterMetric: Counter;
  private consumer?: Consumer;

  constructor(
    private readonly sqs: SQSClient,
    private readonly registry: MessageHandlerRegistry,
    config: ConfigService,
    private readonly pinoLogger: PinoLogger,
    @Inject('ILogger') private readonly logger: ILogger,
  ) {
    this.queueName = config.getOrThrow<string>('WORK_ORDER_QUEUE_NAME');
    this.consumedMessagesCounterMetric = metrics
      .getMeter('oficina.messaging')
      .createCounter('oficina.messaging.consumed', { unit: '{message}' });
  }

  async onApplicationBootstrap(): Promise<void> {
    const { QueueUrl } = await this.sqs.send(new GetQueueUrlCommand({ QueueName: this.queueName }));

    this.consumer = Consumer.create({
      queueUrl: QueueUrl as string,
      sqs: this.sqs,
      batchSize: 1,
      waitTimeSeconds: 20,
      messageSystemAttributeNames: ['ApproximateReceiveCount'],
      messageAttributeNames: ['All'],
      suppressFifoWarning: true,
      useQueueUrlAsEndpoint: false,
      pollingCompleteWaitTimeMs: 5_000,
      handleMessage: (message) => this.handleMessage(message),
    });

    this.consumer.on('error', (error) => this.logger.error('sqs receive failed', error));
    this.consumer.start();
  }

  beforeApplicationShutdown(): Promise<void> {
    const consumer = this.consumer;

    if (!consumer) {
      return Promise.resolve();
    }

    // abort also cancels a pending DeleteMessage; the redelivery is absorbed by handler idempotency.
    return new Promise((resolve) => {
      consumer.once('stopped', () => resolve());
      consumer.stop({ abort: true });
    });
  }

  handleMessage(message: Message): Promise<Message> {
    return trace.getTracer('oficina.messaging').startActiveSpan(
      `process ${this.queueName}`,
      {
        kind: SpanKind.CONSUMER,
        attributes: {
          'messaging.system': 'aws_sqs',
          'messaging.destination.name': this.queueName,
          'messaging.operation.type': 'process',
        },
      },
      this.extractParentContext(message),
      (span) => this.handleInSpan(message, span),
    );
  }

  private async handleInSpan(message: Message, span: Span): Promise<Message> {
    const receiveCount = Number(message.Attributes?.ApproximateReceiveCount ?? 1);

    try {
      await this.process(message, receiveCount, span);
      this.recordSuccess();
      return message;
    } catch (error) {
      this.recordFailure(span, error, receiveCount);
      throw error;
    } finally {
      span.end();
    }
  }

  private extractParentContext(message: Message): Context {
    const carrier = Object.fromEntries(
      Object.entries(message.MessageAttributes ?? {}).map(([key, value]) => [
        key,
        value.StringValue,
      ]),
    );

    return propagation.extract(ROOT_CONTEXT, carrier);
  }

  private recordSuccess(): void {
    this.consumedMessagesCounterMetric.add(1, this.outcomeAttributes('success'));
  }

  private recordFailure(span: Span, error: unknown, receiveCount: number): void {
    span.recordException(error as Error);
    span.setStatus({ code: SpanStatusCode.ERROR });

    this.consumedMessagesCounterMetric.add(
      1,
      this.outcomeAttributes(receiveCount >= MAX_RECEIVE_COUNT ? 'dead_lettered' : 'retry'),
    );
  }

  private async process(message: Message, receiveCount: number, span: Span): Promise<void> {
    let envelope: MessageEnvelopeDto | undefined;
    let invalid: unknown;

    try {
      envelope = await this.parseEnvelope(message.Body);
    } catch (error) {
      invalid = error;
    }

    // SQS always sets MessageId on a received message.
    const messageId = envelope ? envelope.messageId : (message.MessageId as string);
    span.setAttribute('messaging.message.id', messageId);

    const bindings = messagingLogBindings({
      system: 'aws_sqs',
      destination: this.queueName,
      messageId,
      operation: 'process',
      type: envelope?.type,
      workOrderId: envelope?.workOrderId,
    });

    await this.pinoLogger.runInContext(
      async () => {
        try {
          if (!envelope) {
            throw invalid;
          }

          await this.dispatch(envelope);
        } catch (error) {
          this.logFailure(error, receiveCount);
          throw error;
        }
      },
      { bindings },
    );
  }

  private async dispatch(envelope: MessageEnvelopeDto): Promise<void> {
    const entry = this.registry.find(envelope.type);

    if (!entry) {
      throw new UnhandledMessageError(`no handler registered for ${envelope.type}`);
    }

    if (entry.payloadClass) {
      await this.validateOrThrow(entry.payloadClass, envelope.payload, 'invalid message payload');
    }

    await entry.handler(envelope as MessageEnvelope);
  }

  private logFailure(error: unknown, receiveCount: number): void {
    if (receiveCount >= MAX_RECEIVE_COUNT) {
      this.logger.event(TECHNICAL_EVENTS.MESSAGING_MESSAGE_DEAD_LETTERED, {}, error);
    } else if (error instanceof UnhandledMessageError) {
      this.logger.event(TECHNICAL_EVENTS.MESSAGING_MESSAGE_UNHANDLED, {});
    } else {
      this.logger.event(TECHNICAL_EVENTS.MESSAGING_MESSAGE_FAILED, {}, error);
    }
  }

  private async parseEnvelope(body: string | undefined): Promise<MessageEnvelopeDto> {
    const envelope = JSON.parse(body ?? '') as object;
    return this.validateOrThrow(MessageEnvelopeDto, envelope, 'invalid message envelope');
  }

  // Only property names reach the error: payload values may carry PII.
  private async validateOrThrow<T extends object>(
    target: new () => T,
    plain: object,
    reason: string,
  ): Promise<T> {
    const instance = plainToInstance(target, plain);
    const errors = await validate(instance);

    if (errors.length > 0) {
      throw new Error(`${reason}: ${errors.map((error) => error.property).join(', ')}`);
    }

    return instance;
  }

  private outcomeAttributes(outcome: ConsumeOutcome): Record<string, string> {
    return { 'messaging.destination.name': this.queueName, outcome };
  }
}
