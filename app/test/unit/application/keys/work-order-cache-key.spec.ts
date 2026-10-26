import { workOrderCacheKey } from '@application/keys/work-order-cache-key';

describe('workOrderCacheKey', () => {
  it('should build the work order key as work-order:work-order:<id>', () => {
    expect(workOrderCacheKey('3f1c')).toBe('work-order:work-order:3f1c');
  });
});
