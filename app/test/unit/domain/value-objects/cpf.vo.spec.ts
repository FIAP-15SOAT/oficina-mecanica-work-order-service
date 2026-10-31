import { Cpf } from '@domain/value-objects/cpf.vo';
import { DomainValidationException } from '@domain/exceptions/domain-validation.exception';

describe('Cpf VO', () => {
  describe('create', () => {
    it.each([
      ['123.456.789-09', '12345678909'],
      ['12345678909', '12345678909'],
      ['  123.456.789-09  ', '12345678909'],
    ])('should sanitize and create from %p → %p', (input, expected) => {
      const cpf = Cpf.create(input);
      expect(cpf.value).toBe(expected);
    });

    it.each(['000.000.000-00', '111.111.111-11', '12345', 'abc'])(
      'throws on invalid CPF %p',
      (value) => {
        expect(() => Cpf.create(value)).toThrow(DomainValidationException);
        expect(() => Cpf.create(value)).toThrow('CPF inválido');
      },
    );
  });

  describe('equals', () => {
    it('should return true for the same value (regardless of input formatting)', () => {
      const a = Cpf.create('123.456.789-09');
      const b = Cpf.create('12345678909');
      expect(a.equals(b)).toBe(true);
    });

    it('should return false for different values', () => {
      const a = Cpf.create('123.456.789-09');
      const b = Cpf.create('529.982.247-25');
      expect(a.equals(b)).toBe(false);
    });

    it('should return false for non-Cpf instance', () => {
      const a = Cpf.create('123.456.789-09');
      expect(a.equals({ value: '12345678909' } as unknown as Cpf)).toBe(false);
    });
  });

  describe('toString', () => {
    it('should return the sanitized value', () => {
      expect(Cpf.create('123.456.789-09').toString()).toBe('12345678909');
    });
  });
});
