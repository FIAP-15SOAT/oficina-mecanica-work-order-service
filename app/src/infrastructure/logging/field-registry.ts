import { LogicalFieldName } from '@application/logging/log-field';

export type FieldType = 'string' | 'number' | 'boolean' | 'string[]';

export type FieldCardinality = 'fixed' | 'low' | 'medium' | 'high';

/**
 * `pii` is the only classification that changes runtime behavior: the adapter
 * masks the value before emitting. The others are catalog metadata —
 * `identifier` marks an id that correlates records, `sanitized` marks text that
 * goes through the content scrubber, `clear` marks unrestricted data.
 */
export type FieldSensitivity = 'clear' | 'sanitized' | 'identifier' | 'pii';

export type FieldOwner =
  | 'envelope'
  | 'resource'
  | 'access-log'
  | 'interceptor'
  | 'exception-filter'
  | 'adapter'
  | 'instrumentation'
  | 'use-case'
  | 'infrastructure-service';

export interface FieldDefinition {
  name: string;
  type: FieldType;
  cardinality: FieldCardinality;
  owner: FieldOwner;
  sensitivity: FieldSensitivity;
  conditional: boolean;
}

interface LogicalFieldDefinition {
  key: string;
  type: FieldType;
  cardinality: FieldCardinality;
  owner: FieldOwner;
  sensitivity: FieldSensitivity;
}

function field(
  name: string,
  type: FieldType,
  cardinality: FieldCardinality,
  owner: FieldOwner,
  sensitivity: FieldSensitivity,
  conditional = false,
): FieldDefinition {
  return { name, type, cardinality, owner, sensitivity, conditional };
}

export const LOGICAL_FIELDS: Readonly<Record<LogicalFieldName, LogicalFieldDefinition>> = {
  subjectId: {
    key: 'oficina.auth.subject.id',
    type: 'string',
    cardinality: 'high',
    owner: 'use-case',
    sensitivity: 'identifier',
  },
  subjectName: {
    key: 'oficina.auth.subject.name',
    type: 'string',
    cardinality: 'high',
    owner: 'use-case',
    sensitivity: 'pii',
  },
  subjectEmail: {
    key: 'oficina.auth.subject.email',
    type: 'string',
    cardinality: 'high',
    owner: 'use-case',
    sensitivity: 'pii',
  },
  failureReason: {
    key: 'oficina.auth.failure.reason',
    type: 'string',
    cardinality: 'fixed',
    owner: 'use-case',
    sensitivity: 'clear',
  },
  quoteId: {
    key: 'oficina.quote.id',
    type: 'string',
    cardinality: 'high',
    owner: 'use-case',
    sensitivity: 'identifier',
  },
  previousQuoteStatus: {
    key: 'oficina.quote.status.previous',
    type: 'string',
    cardinality: 'low',
    owner: 'use-case',
    sensitivity: 'clear',
  },
  workOrderId: {
    key: 'oficina.work_order.id',
    type: 'string',
    cardinality: 'high',
    owner: 'use-case',
    sensitivity: 'identifier',
  },
  workOrderNumber: {
    key: 'oficina.work_order.number',
    type: 'string',
    cardinality: 'high',
    owner: 'use-case',
    sensitivity: 'identifier',
  },
  workOrderStatusChanged: {
    key: 'oficina.work_order.status.changed',
    type: 'boolean',
    cardinality: 'fixed',
    owner: 'use-case',
    sensitivity: 'clear',
  },
  previousWorkOrderStatus: {
    key: 'oficina.work_order.status.previous',
    type: 'string',
    cardinality: 'low',
    owner: 'use-case',
    sensitivity: 'clear',
  },
  currentWorkOrderStatus: {
    key: 'oficina.work_order.status.current',
    type: 'string',
    cardinality: 'low',
    owner: 'use-case',
    sensitivity: 'clear',
  },
  workOrderServiceId: {
    key: 'oficina.work_order.service.id',
    type: 'string',
    cardinality: 'high',
    owner: 'use-case',
    sensitivity: 'identifier',
  },
  workOrderServiceName: {
    key: 'oficina.work_order.service.name',
    type: 'string',
    cardinality: 'medium',
    owner: 'use-case',
    sensitivity: 'clear',
  },
  previousWorkOrderServiceStatus: {
    key: 'oficina.work_order.service.status.previous',
    type: 'string',
    cardinality: 'low',
    owner: 'use-case',
    sensitivity: 'clear',
  },
  currentWorkOrderServiceStatus: {
    key: 'oficina.work_order.service.status.current',
    type: 'string',
    cardinality: 'low',
    owner: 'use-case',
    sensitivity: 'clear',
  },
  partSupplyId: {
    key: 'oficina.part_supply.id',
    type: 'string',
    cardinality: 'high',
    owner: 'use-case',
    sensitivity: 'identifier',
  },
  partSupplyName: {
    key: 'oficina.part_supply.name',
    type: 'string',
    cardinality: 'medium',
    owner: 'use-case',
    sensitivity: 'clear',
  },
  movementType: {
    key: 'oficina.stock.movement.type',
    type: 'string',
    cardinality: 'fixed',
    owner: 'use-case',
    sensitivity: 'clear',
  },
  movementQuantity: {
    key: 'oficina.stock.movement.quantity',
    type: 'number',
    cardinality: 'medium',
    owner: 'use-case',
    sensitivity: 'clear',
  },
  currentQuantity: {
    key: 'oficina.stock.quantity.current',
    type: 'number',
    cardinality: 'medium',
    owner: 'use-case',
    sensitivity: 'clear',
  },
  reservedItemCount: {
    key: 'oficina.stock.reservation.item_count',
    type: 'number',
    cardinality: 'low',
    owner: 'use-case',
    sensitivity: 'clear',
  },
  reservedQuantity: {
    key: 'oficina.stock.reservation.quantity',
    type: 'number',
    cardinality: 'medium',
    owner: 'use-case',
    sensitivity: 'clear',
  },
  consumedItemCount: {
    key: 'oficina.stock.consumption.item_count',
    type: 'number',
    cardinality: 'low',
    owner: 'use-case',
    sensitivity: 'clear',
  },
  consumedQuantity: {
    key: 'oficina.stock.consumption.quantity',
    type: 'number',
    cardinality: 'medium',
    owner: 'use-case',
    sensitivity: 'clear',
  },
  targetUserId: {
    key: 'oficina.target.user.id',
    type: 'string',
    cardinality: 'high',
    owner: 'use-case',
    sensitivity: 'identifier',
  },
  targetUserActive: {
    key: 'oficina.target.user.active',
    type: 'boolean',
    cardinality: 'fixed',
    owner: 'use-case',
    sensitivity: 'clear',
  },
  port: {
    key: 'oficina.app.port',
    type: 'number',
    cardinality: 'fixed',
    owner: 'infrastructure-service',
    sensitivity: 'clear',
  },
  signal: {
    key: 'oficina.process.signal',
    type: 'string',
    cardinality: 'fixed',
    owner: 'infrastructure-service',
    sensitivity: 'clear',
  },
  mailOperation: {
    key: 'oficina.mail.operation',
    type: 'string',
    cardinality: 'fixed',
    owner: 'infrastructure-service',
    sensitivity: 'clear',
  },
  mailDestinationSystem: {
    key: 'oficina.mail.destination_system',
    type: 'string',
    cardinality: 'fixed',
    owner: 'infrastructure-service',
    sensitivity: 'clear',
  },
  mailOutcome: {
    key: 'oficina.mail.outcome',
    type: 'string',
    cardinality: 'fixed',
    owner: 'infrastructure-service',
    sensitivity: 'clear',
  },
  mailRecipient: {
    key: 'oficina.mail.recipient',
    type: 'string',
    cardinality: 'high',
    owner: 'infrastructure-service',
    sensitivity: 'pii',
  },
  mailDurationMs: {
    key: 'oficina.mail.duration_ms',
    type: 'number',
    cardinality: 'high',
    owner: 'infrastructure-service',
    sensitivity: 'clear',
  },
  mailErrorCategory: {
    key: 'oficina.mail.error.category',
    type: 'string',
    cardinality: 'low',
    owner: 'infrastructure-service',
    sensitivity: 'clear',
  },
  dependencyName: {
    key: 'oficina.dependency.name',
    type: 'string',
    cardinality: 'fixed',
    owner: 'infrastructure-service',
    sensitivity: 'clear',
  },
  healthFailureCategory: {
    key: 'oficina.health.failure.category',
    type: 'string',
    cardinality: 'fixed',
    owner: 'infrastructure-service',
    sensitivity: 'clear',
  },
  healthDegradedDurationMs: {
    key: 'oficina.health.degraded.duration_ms',
    type: 'number',
    cardinality: 'high',
    owner: 'infrastructure-service',
    sensitivity: 'clear',
  },
  customerId: {
    key: 'oficina.customer.id',
    type: 'string',
    cardinality: 'high',
    owner: 'use-case',
    sensitivity: 'identifier',
  },
  customerActive: {
    key: 'oficina.customer.active',
    type: 'boolean',
    cardinality: 'fixed',
    owner: 'use-case',
    sensitivity: 'clear',
  },
  accessUserCreated: {
    key: 'oficina.customer.access.user_created',
    type: 'boolean',
    cardinality: 'fixed',
    owner: 'use-case',
    sensitivity: 'clear',
  },
  initialPasswordSent: {
    key: 'oficina.user.initial_password_sent',
    type: 'boolean',
    cardinality: 'fixed',
    owner: 'use-case',
    sensitivity: 'clear',
  },
  externalAccessFailureReason: {
    key: 'oficina.customer.access.failure.reason',
    type: 'string',
    cardinality: 'fixed',
    owner: 'use-case',
    sensitivity: 'clear',
  },
  resetOutcome: {
    key: 'oficina.user.password_reset.outcome',
    type: 'string',
    cardinality: 'fixed',
    owner: 'use-case',
    sensitivity: 'clear',
  },
};

export function resolveLogicalField(logicalName: string): LogicalFieldDefinition | undefined {
  return LOGICAL_FIELDS[logicalName as LogicalFieldName];
}

export const ENVELOPE_FIELDS: readonly FieldDefinition[] = [
  field('timestamp', 'string', 'high', 'envelope', 'clear'),
  field('level', 'string', 'fixed', 'envelope', 'clear'),
  field('message', 'string', 'low', 'envelope', 'clear'),
];

export const RESOURCE_FIELDS: readonly FieldDefinition[] = [
  field('service.name', 'string', 'fixed', 'resource', 'clear'),
  field('service.namespace', 'string', 'fixed', 'resource', 'clear'),
  field('service.version', 'string', 'fixed', 'resource', 'clear'),
  field('service.instance.id', 'string', 'low', 'resource', 'identifier'),
  field('deployment.environment.name', 'string', 'fixed', 'resource', 'clear'),
  field('host.name', 'string', 'low', 'resource', 'clear'),
  field('process.pid', 'number', 'low', 'resource', 'clear'),
];

export const CORRELATION_FIELDS: readonly FieldDefinition[] = [
  field('request.id', 'string', 'high', 'access-log', 'identifier'),
  field('otel.scope.name', 'string', 'low', 'adapter', 'clear', true),
  field('trace_id', 'string', 'high', 'instrumentation', 'identifier', true),
  field('span_id', 'string', 'high', 'instrumentation', 'identifier', true),
  field('trace_flags', 'string', 'high', 'instrumentation', 'identifier', true),
];

export const HTTP_FIELDS: readonly FieldDefinition[] = [
  field('http.request.method', 'string', 'fixed', 'access-log', 'clear'),
  field('http.route', 'string', 'low', 'access-log', 'clear', true),
  field('http.response.status_code', 'number', 'low', 'access-log', 'clear', true),
  field('url.path', 'string', 'medium', 'access-log', 'sanitized'),
  field('url.scheme', 'string', 'fixed', 'access-log', 'clear'),
  field('url.query', 'string', 'high', 'access-log', 'sanitized', true),
  field('client.address', 'string', 'high', 'access-log', 'identifier', true),
  field('user_agent.original', 'string', 'medium', 'access-log', 'sanitized', true),
  field('network.protocol.version', 'string', 'fixed', 'access-log', 'clear', true),
  field('http.request.header.content-type', 'string[]', 'low', 'access-log', 'sanitized', true),
  field('http.request.header.content-length', 'string[]', 'high', 'access-log', 'clear', true),
  field(
    'http.request.header.accept-language',
    'string[]',
    'medium',
    'access-log',
    'sanitized',
    true,
  ),
  field('code.function.name', 'string', 'medium', 'interceptor', 'clear', true),
  field('oficina.http.server.request.duration_ms', 'number', 'high', 'access-log', 'clear', true),
  field('oficina.http.request.body_json', 'string', 'high', 'access-log', 'sanitized', true),
  field('oficina.http.request.body_truncated', 'boolean', 'fixed', 'access-log', 'clear', true),
];

export const IDENTITY_FIELDS: readonly FieldDefinition[] = [
  field('user.id', 'string', 'high', 'access-log', 'identifier', true),
  field('user.roles', 'string[]', 'fixed', 'access-log', 'clear', true),
];

export const ERROR_FIELDS: readonly FieldDefinition[] = [
  field('error.type', 'string', 'low', 'exception-filter', 'clear', true),
  field('oficina.error.message', 'string', 'medium', 'exception-filter', 'sanitized', true),
  field('exception.type', 'string', 'low', 'adapter', 'clear', true),
  field('exception.message', 'string', 'medium', 'adapter', 'sanitized', true),
  field('exception.stacktrace', 'string', 'high', 'adapter', 'sanitized', true),
];

export const MESSAGING_FIELDS: readonly FieldDefinition[] = [
  field('messaging.system', 'string', 'fixed', 'adapter', 'clear', true),
  field('messaging.destination.name', 'string', 'low', 'adapter', 'clear', true),
  field('messaging.message.id', 'string', 'high', 'adapter', 'identifier', true),
  field('messaging.operation', 'string', 'fixed', 'adapter', 'clear', true),
  field('oficina.messaging.message.type', 'string', 'low', 'adapter', 'clear', true),
];

export const EVENT_NAME_FIELD = field('oficina.event.name', 'string', 'low', 'adapter', 'clear');

const CATALOG_FIELDS: readonly FieldDefinition[] = Object.values(LOGICAL_FIELDS).map((definition) =>
  field(
    definition.key,
    definition.type,
    definition.cardinality,
    definition.owner,
    definition.sensitivity,
    true,
  ),
);

export const FIELD_DICTIONARY: readonly FieldDefinition[] = [
  ...ENVELOPE_FIELDS,
  ...RESOURCE_FIELDS,
  ...CORRELATION_FIELDS,
  ...HTTP_FIELDS,
  ...IDENTITY_FIELDS,
  ...ERROR_FIELDS,
  ...MESSAGING_FIELDS,
  EVENT_NAME_FIELD,
  ...CATALOG_FIELDS,
];

export const DECLARED_FIELD_NAMES: ReadonlySet<string> = new Set(
  FIELD_DICTIONARY.map((definition) => definition.name),
);

export function isDeclaredField(name: string): boolean {
  return DECLARED_FIELD_NAMES.has(name);
}

export const ALLOWED_REQUEST_HEADERS: readonly string[] = [
  'content-type',
  'content-length',
  'accept-language',
];
