import { Prisma, User, Customer } from '@generated/client';

describe('Prisma schema — CPF auth models', () => {
  it('should expose UserCustomer and PasswordResetCode as generated model names', () => {
    expect(Prisma.ModelName.UserCustomer).toBe('UserCustomer');
    expect(Prisma.ModelName.PasswordResetCode).toBe('PasswordResetCode');
  });

  it('should type User.cpf and User.role as nullable on the generated client', () => {
    const sample: Pick<User, 'cpf' | 'role'> = { cpf: null, role: null };

    expect(sample.cpf).toBeNull();
    expect(sample.role).toBeNull();
  });

  it('should type Customer.isActive as a boolean on the generated client', () => {
    const sample: Pick<Customer, 'isActive'> = { isActive: true };

    expect(sample.isActive).toBe(true);
  });
});
