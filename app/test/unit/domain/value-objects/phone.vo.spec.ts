import { Phone } from '@domain/value-objects/phone.vo';
import { DomainValidationException } from '@domain/exceptions/domain-validation.exception';

describe('Phone VO', () => {
  describe('create', () => {
    it.each([
      ['11999999999', '11999999999'],
      ['(11) 99999-9999', '11999999999'],
      ['99999-9999', '999999999'],
      ['11 99999-9999', '11999999999'],
    ])('should sanitize and create from %p → %p', (input, expected) => {
      expect(Phone.create(input).value).toBe(expected);
    });

    it.each([null, undefined, '', '   '])('should throw when value is %p', (value) => {
      expect(() => Phone.create(value as string)).toThrow(DomainValidationException);
      expect(() => Phone.create(value as string)).toThrow('Telefone é obrigatório');
    });

    it.each(['abc', '123', '99999-9'])('should throw on malformed phone %p', (value) => {
      expect(() => Phone.create(value)).toThrow(DomainValidationException);
      expect(() => Phone.create(value)).toThrow(/Telefone inválido/);
    });
  });

  describe('equals', () => {
    it('should return true for same value', () => {
      expect(Phone.create('11999999999').equals(Phone.create('(11) 99999-9999'))).toBe(true);
    });

    it('should return false for different values', () => {
      expect(Phone.create('11999999999').equals(Phone.create('11888888888'))).toBe(false);
    });

    it('should return false for non-Phone instance', () => {
      expect(Phone.create('11999999999').equals({ value: '11999999999' } as unknown as Phone)).toBe(
        false,
      );
    });
  });

  describe('toString', () => {
    it('should return the value', () => {
      expect(Phone.create('11999999999').toString()).toBe('11999999999');
    });
  });
});
