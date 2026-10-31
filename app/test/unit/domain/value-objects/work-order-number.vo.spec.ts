import { WorkOrderNumber } from '@domain/value-objects/work-order-number.vo';
import { DomainValidationException } from '@domain/exceptions/domain-validation.exception';

describe('WorkOrderNumber VO', () => {
  describe('create', () => {
    it.each([
      ['42', '000042'],
      ['1', '000001'],
      ['  42  ', '000042'],
    ])('should zero-pad and create from %p → %p', (input, expected) => {
      expect(WorkOrderNumber.create(input).value).toBe(expected);
    });

    it('should be idempotent for an already-canonical value', () => {
      expect(WorkOrderNumber.create('000042').toString()).toBe('000042');
    });

    it('should keep digits beyond the minimum width', () => {
      expect(WorkOrderNumber.create('1000000').value).toBe('1000000');
    });

    it.each([null, undefined, '', '   '])('should throw when value is %p', (value) => {
      expect(() => WorkOrderNumber.create(value as string)).toThrow(DomainValidationException);
      expect(() => WorkOrderNumber.create(value as string)).toThrow(
        'Número da ordem de serviço é obrigatório',
      );
    });

    it.each(['12a456', 'abcdef', '12 34 56', '12.456'])(
      'should throw on non-digit value %p',
      (value) => {
        expect(() => WorkOrderNumber.create(value)).toThrow(DomainValidationException);
        expect(() => WorkOrderNumber.create(value)).toThrow(/Número da ordem de serviço inválido/);
      },
    );
  });

  describe('equals', () => {
    it('should return true for the same canonical value (regardless of padding on input)', () => {
      expect(WorkOrderNumber.create('42').equals(WorkOrderNumber.create('000042'))).toBe(true);
    });

    it('should return false for different values', () => {
      expect(WorkOrderNumber.create('42').equals(WorkOrderNumber.create('43'))).toBe(false);
    });

    it('should return false for a non-WorkOrderNumber instance', () => {
      expect(
        WorkOrderNumber.create('42').equals({ value: '000042' } as unknown as WorkOrderNumber),
      ).toBe(false);
    });
  });

  describe('toString', () => {
    it('should return the canonical value', () => {
      expect(WorkOrderNumber.create('42').toString()).toBe('000042');
    });
  });
});
