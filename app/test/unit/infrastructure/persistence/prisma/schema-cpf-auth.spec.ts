import { Prisma, Customer } from '@generated/client';

describe('Prisma schema — CPF auth models', () => {
  it('should expose UserCustomer as a generated model name', () => {
    expect(Prisma.ModelName.UserCustomer).toBe('UserCustomer');
  });

  it('should type Customer.isActive as a boolean on the generated client', () => {
    const sample: Pick<Customer, 'isActive'> = { isActive: true };

    expect(sample.isActive).toBe(true);
  });
});
