import { LOGICAL_FIELDS } from '@infrastructure/logging/field-registry';
import { messagingLogBindings } from '@infrastructure/messaging/messaging-log-bindings';

describe('messagingLogBindings', () => {
  it('should build bindings with request.id equal to the message id and the work order key from the registry', () => {
    expect(
      messagingLogBindings({
        system: 'aws_sqs',
        destination: 'work-order.fifo',
        messageId: 'msg-1',
        operation: 'process',
        type: 'inventory.stock.reserved',
        workOrderId: 'wo-1',
      }),
    ).toEqual({
      'messaging.system': 'aws_sqs',
      'messaging.destination.name': 'work-order.fifo',
      'messaging.message.id': 'msg-1',
      'messaging.operation': 'process',
      'oficina.messaging.message.type': 'inventory.stock.reserved',
      'request.id': 'msg-1',
      [LOGICAL_FIELDS.workOrderId.key]: 'wo-1',
    });
  });

  it('should omit work order and type when absent', () => {
    expect(
      messagingLogBindings({
        system: 'aws_sns',
        destination: 'oficina-events.fifo',
        messageId: 'msg-1',
        operation: 'publish',
        workOrderId: null,
      }),
    ).toEqual({
      'messaging.system': 'aws_sns',
      'messaging.destination.name': 'oficina-events.fifo',
      'messaging.message.id': 'msg-1',
      'messaging.operation': 'publish',
      'request.id': 'msg-1',
    });
  });
});
