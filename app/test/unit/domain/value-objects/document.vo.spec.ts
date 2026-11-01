import { Document } from '@domain/value-objects/document.vo';
import { CustomerType } from '@domain/enums/customer-type.enum';
import { DomainValidationException } from '@domain/exceptions/domain-validation.exception';

describe('Document VO', () => {
  describe('create — INDIVIDUAL (CPF)', () => {
    it.each([
      ['123.456.789-09', '12345678909'],
      ['12345678909', '12345678909'],
      ['  123.456.789-09  ', '12345678909'],
    ])('should sanitize and create from %p → %p', (input, expected) => {
      const doc = Document.create(input, CustomerType.INDIVIDUAL);
      expect(doc.value).toBe(expected);
      expect(doc.type).toBe(CustomerType.INDIVIDUAL);
    });

    it.each(['000.000.000-00', '111.111.111-11', '12345', 'abc'])(
      'throws on invalid CPF %p',
      (value) => {
        expect(() => Document.create(value, CustomerType.INDIVIDUAL)).toThrow(
          DomainValidationException,
        );
        expect(() => Document.create(value, CustomerType.INDIVIDUAL)).toThrow(
          'Pessoa física deve informar um CPF válido',
        );
      },
    );
  });

  describe('create — COMPANY (CNPJ)', () => {
    it.each([
      ['12.345.678/0001-95', '12345678000195'],
      ['12345678000195', '12345678000195'],
    ])('should sanitize and create from %p → %p', (input, expected) => {
      const doc = Document.create(input, CustomerType.COMPANY);
      expect(doc.value).toBe(expected);
      expect(doc.type).toBe(CustomerType.COMPANY);
    });

    it.each(['00.000.000/0000-00', '12345', 'abc'])('should throw on invalid CNPJ %p', (value) => {
      expect(() => Document.create(value, CustomerType.COMPANY)).toThrow(DomainValidationException);
      expect(() => Document.create(value, CustomerType.COMPANY)).toThrow(
        'Pessoa jurídica deve informar um CNPJ válido',
      );
    });
  });

  describe('create — presence', () => {
    it.each([null, undefined, '', '   '])('should throw when value is %p', (value) => {
      expect(() => Document.create(value as string, CustomerType.INDIVIDUAL)).toThrow(
        'Documento é obrigatório',
      );
    });
  });

  describe('equals', () => {
    it('should return true for same value and type (regardless of input formatting)', () => {
      const a = Document.create('123.456.789-09', CustomerType.INDIVIDUAL);
      const b = Document.create('12345678909', CustomerType.INDIVIDUAL);
      expect(a.equals(b)).toBe(true);
    });

    it('should return false for different values', () => {
      const a = Document.create('123.456.789-09', CustomerType.INDIVIDUAL);
      const b = Document.create('529.982.247-25', CustomerType.INDIVIDUAL);
      expect(a.equals(b)).toBe(false);
    });

    it('should return false for non-Document instance', () => {
      const a = Document.create('123.456.789-09', CustomerType.INDIVIDUAL);
      expect(a.equals({ value: '12345678909' } as unknown as Document)).toBe(false);
    });
  });

  describe('toString', () => {
    it('should return the sanitized value', () => {
      expect(Document.create('123.456.789-09', CustomerType.INDIVIDUAL).toString()).toBe(
        '12345678909',
      );
    });
  });
});
