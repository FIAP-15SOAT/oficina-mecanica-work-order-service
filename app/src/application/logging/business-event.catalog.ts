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

export type AuthenticationFailureReason =
  | 'unknown_user'
  | 'inactive_user'
  | 'wrong_password'
  | 'no_internal_role';

export type RefreshFailureReason =
  | 'invalid_token'
  | 'unknown_user'
  | 'inactive_user'
  | 'no_internal_role'
  | 'password_changed';

interface AuthenticatedSubjectFields {
  subjectId: string;
  subjectName: string;
  subjectEmail: string;
}

export const BUSINESS_EVENTS = {
  AUTHENTICATION_SUCCEEDED: defineLogEvent<AuthenticatedSubjectFields>({
    name: 'auth.authentication.succeeded',
    message: 'credentials accepted and token pair issued',
    level: 'info',
  }),
  AUTHENTICATION_FAILED: defineLogEvent<
    Partial<AuthenticatedSubjectFields> & { failureReason: AuthenticationFailureReason }
  >({
    name: 'auth.authentication.failed',
    message: 'credentials rejected',
    level: 'warn',
  }),
  REFRESH_TOKEN_FAILED: defineLogEvent<
    Partial<AuthenticatedSubjectFields> & { failureReason: RefreshFailureReason }
  >({
    name: 'auth.refresh.failed',
    message: 'refresh token rejected',
    level: 'warn',
  }),
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
  USER_STATUS_UPDATED: defineLogEvent<{ targetUserId: string; targetUserActive: boolean }>({
    name: 'user.status.updated',
    message: 'user account activation changed',
    level: 'info',
  }),
  USER_INITIAL_PASSWORD_SEND_FAILED: defineLogEvent<{ targetUserId: string }>({
    name: 'user.initial_password.send_failed',
    message: 'initial password e-mail could not be delivered',
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
  USER_PASSWORD_CHANGED: defineLogEvent<{ subjectId: string }>({
    name: 'user.password.changed',
    message: 'user changed their own password',
    level: 'info',
  }),
  USER_PASSWORD_RESET_ISSUED: defineLogEvent<{ subjectId: string; targetUserId: string }>({
    name: 'user.password_reset.issued',
    message: 'admin issued a password reset code',
    level: 'info',
  }),
  USER_PASSWORD_RESET_COMPLETED: defineLogEvent<{
    targetUserId: string;
    resetOutcome: string;
  }>({
    name: 'user.password_reset.completed',
    message: 'password reset confirmed with a valid code',
    level: 'info',
  }),
  USER_PASSWORD_RESET_REJECTED: defineLogEvent<{ resetOutcome: string }>({
    name: 'user.password_reset.rejected',
    message: 'password reset confirmation rejected',
    level: 'warn',
  }),
} as const;
