import { IsUUID } from 'class-validator';

import { MessageHandlerRegistry } from '@infrastructure/messaging/message-handler.registry';

class ReservedPayload {
  @IsUUID('4')
  quoteId!: string;
}

describe('MessageHandlerRegistry', () => {
  let registry: MessageHandlerRegistry;

  beforeEach(() => {
    registry = new MessageHandlerRegistry();
  });

  describe('register', () => {
    it('should reject a second handler for the same type', () => {
      registry.register('inventory.stock.reserved', jest.fn(), ReservedPayload);

      expect(() =>
        registry.register('inventory.stock.reserved', jest.fn(), ReservedPayload),
      ).toThrow('inventory.stock.reserved');
    });
  });

  describe('find', () => {
    it('should find a registered handler with its payload class', () => {
      const handler = jest.fn();
      registry.register('inventory.stock.reserved', handler, ReservedPayload);

      expect(registry.find('inventory.stock.reserved')).toEqual({
        handler,
        payloadClass: ReservedPayload,
      });
    });

    it('should return undefined for a type without handler', () => {
      expect(registry.find('billing.quote.sent')).toBeUndefined();
    });
  });
});
