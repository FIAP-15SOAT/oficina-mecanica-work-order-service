import { Email } from '@domain/value-objects/email.vo';
import { DomainValidationException } from '@domain/exceptions/domain-validation.exception';

describe('Email VO', () => {
  describe('create', () => {
    it.each([
      ['a valid email', 'user@example.com', 'user@example.com'],
      ['an email with surrounding whitespace', '  user@example.com  ', 'user@example.com'],
      ['a mixed-case email', 'User@Example.COM', 'user@example.com'],
    ])('should create from %s', (_description, raw, expected) => {
      const email = Email.create(raw);
      expect(email.value).toBe(expected);
    });

    it.each([null, undefined, '', '   '])('should throw when value is %p', (raw) => {
      expect(() => Email.create(raw as string)).toThrow(DomainValidationException);
      expect(() => Email.create(raw as string)).toThrow('E-mail é obrigatório');
    });

    it.each(['invalid', 'no-at-sign.com', 'spaces in@email.com', 'no-domain@'])(
      'throws on malformed email %p',
      (raw) => {
        expect(() => Email.create(raw)).toThrow(DomainValidationException);
        expect(() => Email.create(raw)).toThrow('E-mail inválido');
      },
    );

    it('should throw when email exceeds 150 chars', () => {
      const local = 'a'.repeat(140);
      const longEmail = `${local}@example.com`;
      expect(() => Email.create(longEmail)).toThrow(/no máximo 150 caracteres/);
    });
  });

  describe('equals', () => {
    it('should return true for same value', () => {
      expect(Email.create('a@b.com').equals(Email.create('a@b.com'))).toBe(true);
    });

    it('should return false for different values', () => {
      expect(Email.create('a@b.com').equals(Email.create('c@d.com'))).toBe(false);
    });

    it('should return false for non-Email instance', () => {
      expect(Email.create('a@b.com').equals({ value: 'a@b.com' } as unknown as Email)).toBe(false);
    });
  });

  describe('toString', () => {
    it('should return the value', () => {
      expect(Email.create('a@b.com').toString()).toBe('a@b.com');
    });
  });
});
