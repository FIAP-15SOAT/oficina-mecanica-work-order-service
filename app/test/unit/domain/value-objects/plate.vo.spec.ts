import { Plate } from '@domain/value-objects/plate.vo';
import { DomainValidationException } from '@domain/exceptions/domain-validation.exception';

describe('Plate VO', () => {
  describe('create', () => {
    it.each([
      ['ABC-1234', 'ABC1234'],
      ['ABC1234', 'ABC1234'],
      ['abc-1234', 'ABC1234'],
      ['  ABC-1234  ', 'ABC1234'],
      ['ABC1D23', 'ABC1D23'],
    ])('should sanitize and create from %p → %p', (input, expected) => {
      expect(Plate.create(input).value).toBe(expected);
    });

    it.each([null, undefined, '', '   '])('should throw when value is %p', (value) => {
      expect(() => Plate.create(value as string)).toThrow(DomainValidationException);
      expect(() => Plate.create(value as string)).toThrow('Placa é obrigatória');
    });

    it.each(['1234ABC', 'ABCD1234', 'AB-1234', 'ABC-12345'])(
      'throws on malformed plate %p',
      (value) => {
        expect(() => Plate.create(value)).toThrow(DomainValidationException);
        expect(() => Plate.create(value)).toThrow(/Placa inválida/);
      },
    );
  });

  describe('equals', () => {
    it('should return true for same value (regardless of input formatting)', () => {
      expect(Plate.create('ABC-1234').equals(Plate.create('abc1234'))).toBe(true);
    });

    it('should return false for different values', () => {
      expect(Plate.create('ABC-1234').equals(Plate.create('XYZ-5678'))).toBe(false);
    });

    it('should return false for non-Plate instance', () => {
      expect(Plate.create('ABC-1234').equals({ value: 'ABC1234' } as unknown as Plate)).toBe(false);
    });
  });

  describe('toString', () => {
    it('should return the sanitized value', () => {
      expect(Plate.create('ABC-1234').toString()).toBe('ABC1234');
    });
  });
});
