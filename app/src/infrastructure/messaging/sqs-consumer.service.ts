import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  context,
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
import { suppressTracing } from '@opentelemetry/core';
import { GetQueueUrlCommand, Message, SQSClient } from '@aws-sdk/client-sqs';
import { plainToInstance } from 'class-transformer';
import { validate, ValidatorOptions } from 'class-validator';
import { PinoLogger } from 'nestjs-pino';
import { Consumer } from 'sqs-consumer';

import { MessageEnvelope } from '@application/messaging/message-envelope';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { InvalidMessageException } from '@infrastructure/exceptions/invalid-message.exception';
import { UnhandledMessageException } from '@infrastructure/exceptions/unhandled-message.exception';
import { resolveErrorType } from '@infrastructure/logging/error-serializer';
import { TECHNICAL_EVENTS } from '@infrastructure/logging/technical-event.catalog';

import { MessageEnvelopeDto } from './message-envelope.dto';
import { MessageHandlerRegistry } from './message-handler.registry';
import { messagingLogBindings } from './messaging-log-bindings';

export const MAX_RECEIVE_COUNT = 5;
// The library polls again at once after a failed receive (it pauses only on credential and
// throttling errors), so an unreachable endpoint would log dozens of errors per second.
export const RECEIVE_FAILURE_PAUSE_MS = 10_000;

type ConsumeOutcome = 'success' | 'retry' | 'dead_lettered';

@Injectable()
export class SqsConsumerService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly queueName: string;
  private readonly consumedMessagesCounterMetric: Counter;
  private consumer?: Consumer;
  private stopping = false;
  private receiveFailed = false;
  private pause?: { timer: NodeJS.Timeout; end: () => void };

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

    const consumer = Consumer.create({
      queueUrl: QueueUrl as string,
      sqs: this.sqs,
      batchSize: 1,
      waitTimeSeconds: 20,
      messageSystemAttributeNames: ['ApproximateReceiveCount'],
      messageAttributeNames: ['All'],
      suppressFifoWarning: true,
      pollingCompleteWaitTimeMs: 5_000,
      // The pause below is the single rule; the library's own pause would add to it.
      authenticationErrorTimeout: 0,
      preReceiveMessageCallback: () => this.pauseAfterReceiveFailure(),
      handleMessage: (message) => this.handleMessage(message),
    });

    // Receive and delete failures; the requests the shutdown abort cancels are expected, not errors.
    // Only a failed receive comes without the message.
    consumer.on('error', (error, message) => {
      if (!message) {
        this.receiveFailed = true;
      }

      if (!this.stopping) {
        this.logger.error('sqs consumer error', error);
      }
    });
    // Each empty long poll would be a root trace every 20 s per replica; the CONSUMER span below
    // starts from the message's own context, so it escapes the suppression.
    context.with(suppressTracing(context.active()), () => consumer.start());
    this.consumer = consumer;
  }

  beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.endPause();
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

  private pauseAfterReceiveFailure(): Promise<void> {
    if (!this.receiveFailed) {
      return Promise.resolve();
    }

    this.receiveFailed = false;

    return new Promise((resolve) => {
      this.pause = { timer: setTimeout(resolve, RECEIVE_FAILURE_PAUSE_MS), end: resolve };
    });
  }

  private endPause(): void {
    if (this.pause) {
      clearTimeout(this.pause.timer);
      this.pause.end();
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
    span.setAttribute('error.type', resolveErrorType(error));
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
      throw new UnhandledMessageException(`nenhum handler registrado para ${envelope.type}`);
    }

    // A payload class without fields declares an empty payload; by default class-validator rejects
    // an instance with no validation metadata.
    await this.validateOrThrow(
      entry.payloadClass,
      envelope.payload,
      'payload da mensagem inválido',
      { forbidUnknownValues: false },
    );

    await entry.handler(envelope as MessageEnvelope);
  }

  private logFailure(error: unknown, receiveCount: number): void {
    if (receiveCount >= MAX_RECEIVE_COUNT) {
      this.logger.event(TECHNICAL_EVENTS.MESSAGING_MESSAGE_DEAD_LETTERED, {}, error);
    } else if (error instanceof UnhandledMessageException) {
      this.logger.event(TECHNICAL_EVENTS.MESSAGING_MESSAGE_UNHANDLED, {});
    } else {
      this.logger.event(TECHNICAL_EVENTS.MESSAGING_MESSAGE_FAILED, {}, error);
    }
  }

  private async parseEnvelope(body: string | undefined): Promise<MessageEnvelopeDto> {
    let envelope: unknown;

    try {
      envelope = JSON.parse(body ?? '');
    } catch (error) {
      throw new InvalidMessageException('corpo da mensagem não é um JSON válido', { cause: error });
    }

    // class-validator throws a TypeError on null and on a string instead of a validation error.
    if (envelope === null || typeof envelope !== 'object') {
      throw new InvalidMessageException(
        'envelope da mensagem inválido: o corpo não é um objeto JSON',
      );
    }

    return this.validateOrThrow(MessageEnvelopeDto, envelope, 'envelope da mensagem inválido');
  }

  // Only property names reach the error: payload values may carry PII.
  private async validateOrThrow<T extends object>(
    target: new () => T,
    plain: object,
    reason: string,
    options?: ValidatorOptions,
  ): Promise<T> {
    const instance = plainToInstance(target, plain);
    const errors = await validate(instance, options);

    if (errors.length > 0) {
      throw new InvalidMessageException(
        `${reason}: ${errors.map((error) => error.property).join(', ')}`,
      );
    }

    return instance;
  }

  private outcomeAttributes(outcome: ConsumeOutcome): Record<string, string> {
    return { 'messaging.destination.name': this.queueName, outcome };
  }
}
