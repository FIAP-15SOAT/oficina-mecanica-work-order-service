import { defineLogEvent } from './log-event';

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
  QUOTE_SUBMITTED: defineLogEvent<{
    quoteId: string;
    previousQuoteStatus: string;
    workOrderId: string;
    workOrderNumber: string;
  }>({
    name: 'quote.submitted',
    message: 'quote submitted to the customer for decision',
    level: 'info',
  }),
  QUOTE_APPROVED: defineLogEvent<{
    quoteId: string;
    previousQuoteStatus: string;
    workOrderId: string;
    workOrderNumber: string;
    previousWorkOrderStatus: string;
    customerId: string;
  }>({
    name: 'quote.approved',
    message: 'quote approved and work order items applied',
    level: 'info',
  }),
  QUOTE_REJECTED: defineLogEvent<{
    quoteId: string;
    previousQuoteStatus: string;
    workOrderId: string;
    workOrderNumber: string;
    previousWorkOrderStatus?: string;
    workOrderStatusChanged: boolean;
    customerId: string;
  }>({
    name: 'quote.rejected',
    message: 'quote rejected by customer decision',
    level: 'info',
  }),
  QUOTE_APPROVAL_COMPLETED: defineLogEvent<{
    sagaId: string;
    quoteId: string;
    workOrderId: string;
    workOrderNumber: string;
  }>({
    name: 'quote_approval.completed',
    message: 'stock reserved and work order approved with the quote items',
    level: 'info',
  }),
  QUOTE_APPROVAL_COMPENSATED: defineLogEvent<{
    sagaId: string;
    quoteId: string;
    workOrderId: string;
    workOrderNumber: string;
    missingItemCount: number;
  }>({
    name: 'quote_approval.compensated',
    message: 'stock reservation refused and quote approval undone',
    level: 'info',
  }),
  QUOTE_APPROVAL_STEP_SKIPPED: defineLogEvent<{ quoteId: string; sagaStatus?: string }>({
    name: 'quote_approval.step_skipped',
    message: 'stock reservation reply skipped because the saga is not reserving stock',
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
