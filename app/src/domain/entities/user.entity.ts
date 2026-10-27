import { randomUUID } from 'node:crypto';
import { DomainValidationException } from '../exceptions/domain-validation.exception';
import { BusinessRuleViolationException } from '../exceptions/business-rule-violation.exception';
import { UserRole } from '../enums/user-role.enum';
import { Email } from '../value-objects/email.vo';
import { Cpf } from '../value-objects/cpf.vo';

import { PASSWORD_REGEX } from '../constants/regex/password.regex';
import {
  MIN_NAME_LENGTH,
  MAX_NAME_LENGTH,
  PASSWORD_REQUIREMENTS_MESSAGE,
} from '../constants/validation/user.constants';

const VALID_ROLES = Object.values(UserRole);

export interface CreateUserProps {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole | null;
  cpf?: string | null;
}

interface UserProps {
  id: string;
  name: string;
  email: Email;
  passwordHash: string;
  role: UserRole | null;
  cpf: Cpf | null;
  isActive: boolean;
  passwordChangedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class User {
  readonly id: string;
  name: string;
  email: Email;
  passwordHash: string;
  role: UserRole | null;
  cpf: Cpf | null;
  isActive: boolean;
  passwordChangedAt: Date;
  readonly createdAt: Date;
  updatedAt: Date;

  private constructor(props: UserProps) {
    this.id = props.id;
    this.name = props.name;
    this.email = props.email;
    this.passwordHash = props.passwordHash;
    this.role = props.role;
    this.cpf = props.cpf;
    this.isActive = props.isActive;
    this.passwordChangedAt = props.passwordChangedAt;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static reconstitute(props: UserProps): User {
    return new User(props);
  }

  static create(props: CreateUserProps): User {
    User.validateName(props.name);
    User.validatePasswordHash(props.passwordHash);
    User.validateRole(props.role);

    const hasCpfInput = typeof props.cpf === 'string' && props.cpf.trim().length > 0;
    const cpf = hasCpfInput ? Cpf.create(props.cpf as string) : null;

    const now = new Date();

    return new User({
      id: randomUUID(),
      name: props.name.trim(),
      email: Email.create(props.email),
      passwordHash: props.passwordHash,
      role: props.role,
      cpf,
      isActive: true,
      passwordChangedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  static validatePasswordStrength(password: string): void {
    if (!PASSWORD_REGEX.test(password)) {
      throw new DomainValidationException(PASSWORD_REQUIREMENTS_MESSAGE);
    }
  }

  changeName(name: string): void {
    User.validateName(name);
    this.name = name.trim();
    this.updatedAt = new Date();
  }

  changeEmail(email: string): void {
    this.email = Email.create(email);
    this.updatedAt = new Date();
  }

  changeRole(role: UserRole): void {
    User.validateRole(role);
    this.role = role;
    this.updatedAt = new Date();
  }

  changePassword(passwordHash: string): void {
    User.validatePasswordHash(passwordHash);
    this.passwordHash = passwordHash;
    this.passwordChangedAt = new Date();
    this.updatedAt = new Date();
  }

  /**
   * Granting access can fill a CPF that is still null, but never replace
   * one already registered — a correction needs an administrative route
   * outside this delivery.
   */
  assignCpf(cpf: string): void {
    if (this.cpf) {
      throw new BusinessRuleViolationException('Usuário já possui CPF cadastrado');
    }

    this.cpf = Cpf.create(cpf);
    this.updatedAt = new Date();
  }

  activate(): void {
    if (this.isActive) {
      throw new DomainValidationException('Usuário já está ativo');
    }
    this.isActive = true;
    this.updatedAt = new Date();
  }

  deactivate(): void {
    if (!this.isActive) {
      throw new DomainValidationException('Usuário já está desativado');
    }
    this.isActive = false;
    this.updatedAt = new Date();
  }

  toPublicView(): UserPublicView {
    return {
      id: this.id,
      name: this.name,
      email: this.email.value,
      role: this.role,
      isActive: this.isActive,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  private static validateName(name: string): void {
    if (!name || name.trim().length < MIN_NAME_LENGTH) {
      throw new DomainValidationException(`Nome deve ter no mínimo ${MIN_NAME_LENGTH} caracteres`);
    }

    if (name.trim().length > MAX_NAME_LENGTH) {
      throw new DomainValidationException(`Nome deve ter no máximo ${MAX_NAME_LENGTH} caracteres`);
    }
  }

  private static validatePasswordHash(passwordHash: string): void {
    if (!passwordHash || passwordHash.length === 0) {
      throw new DomainValidationException('Hash de senha não pode ser vazio');
    }
  }

  private static validateRole(role: UserRole | null): void {
    if (role === null) {
      return;
    }

    if (!VALID_ROLES.includes(role)) {
      throw new DomainValidationException(
        `Role inválida. Valores aceitos: ${VALID_ROLES.join(', ')}`,
      );
    }
  }
}

export interface UserPublicView {
  id: string;
  name: string;
  email: string;
  role: UserRole | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
