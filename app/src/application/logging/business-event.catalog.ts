import { defineLogEvent } from './log-event';

// Type and status together name the step; the correlation is the quote or the payment.
interface SagaEventFields {
  sagaId: string;
  sagaType: string;
  sagaStatus: string;
  workOrderId: string;
  workOrderNumber: string;
  quoteId?: string;
  paymentId?: string;
}

export const BUSINESS_EVENTS = {
  SAGA_STARTED: defineLogEvent<SagaEventFields>({
    name: 'saga.started',
    message: 'saga created or reopened for a new attempt',
    level: 'info',
  }),
  SAGA_COMPENSATION_STARTED: defineLogEvent<
    SagaEventFields & { sagaFailureReason?: string; missingItemCount?: number }
  >({
    name: 'saga.compensation.started',
    message: 'saga compensation started and the undo requested from the participant',
    level: 'info',
  }),
  SAGA_COMPLETED: defineLogEvent<SagaEventFields>({
    name: 'saga.completed',
    message: 'saga completed and its result applied to the work order',
    level: 'info',
  }),
  SAGA_COMPENSATED: defineLogEvent<SagaEventFields & { sagaFailureReason?: string }>({
    name: 'saga.compensated',
    message: 'saga compensated after the participant confirmed the undo',
    level: 'info',
  }),
  SAGA_STEP_SKIPPED: defineLogEvent<{
    sagaType: string;
    quoteId?: string;
    paymentId?: string;
    sagaStatus?: string;
  }>({
    name: 'saga.step_skipped',
    message: 'saga message skipped because it does not match the saga status',
    level: 'info',
  }),
  QUOTE_EVENT_SKIPPED: defineLogEvent<{
    quoteId: string;
    workOrderId: string;
    currentWorkOrderStatus: string;
  }>({
    name: 'quote_event.skipped',
    message: 'billing quote event skipped because the work order is not in an expected status',
    level: 'info',
  }),
  WORK_ORDER_STATUS_UPDATED: defineLogEvent<{
    workOrderId: string;
    workOrderNumber: string;
    previousWorkOrderStatus: string;
    currentWorkOrderStatus: string;
  }>({
    name: 'work_order.status.updated',
    message: 'work order moved to a new status',
    level: 'info',
  }),
  WORK_ORDER_SERVICE_STATUS_UPDATED: defineLogEvent<{
    workOrderId: string;
    workOrderNumber: string;
    workOrderServiceId: string;
    previousWorkOrderServiceStatus?: string;
    currentWorkOrderServiceStatus: string;
    previousWorkOrderStatus: string;
    currentWorkOrderStatus: string;
  }>({
    name: 'work_order.service.status.updated',
    message: 'work order service item moved to a new status',
    level: 'info',
  }),
  WORK_ORDER_OPENING_COMPENSATION_FAILED: defineLogEvent<{
    quoteId: string;
    workOrderId: string;
  }>({
    name: 'work_order.opening.compensation_failed',
    message: 'initial quote left in the billing after the work order write failed',
    level: 'warn',
  }),
  CUSTOMER_ACCESS_GRANTED: defineLogEvent<{
    subjectId: string;
    targetUserId: string;
    customerId: string;
    accessUserCreated: boolean;
    initialPasswordSent: boolean;
  }>({
    name: 'customer.access.granted',
    message: 'customer access granted to a user',
    level: 'info',
  }),
  CUSTOMER_ACCESS_REVOKED: defineLogEvent<{
    subjectId: string;
    targetUserId: string;
    customerId: string;
  }>({
    name: 'customer.access.revoked',
    message: 'customer access revoked from a user',
    level: 'info',
  }),
  CUSTOMER_STATUS_UPDATED: defineLogEvent<{
    subjectId: string;
    customerId: string;
    customerActive: boolean;
  }>({
    name: 'customer.status.updated',
    message: 'customer active flag changed',
    level: 'info',
  }),
  CUSTOMER_ACCESS_DENIED: defineLogEvent<{
    subjectId: string;
    customerId: string;
    externalAccessFailureReason: string;
  }>({
    name: 'customer.access.denied',
    message: 'authenticated user denied access to a customer-scoped resource',
    level: 'warn',
  }),
} as const;
