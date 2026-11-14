import { Customer } from '@domain/entities/customer.entity';
import { UserCustomer } from '@domain/entities/user-customer.entity';
import { Email } from '@domain/value-objects/email.vo';
import { Document } from '@domain/value-objects/document.vo';
import { CustomerType } from '@domain/enums/customer-type.enum';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';

import { IUnitOfWork, IRepositories } from '@domain/interfaces/repositories/unit-of-work.interface';
import { ICreateCustomerUseCase } from '@application/ports/input/customer/create-customer.use-case.interface';
import { ILogger } from '@application/ports/output/services/logger.service.interface';
import { CustomerAccessUserProvisioner } from '@application/services/customer-access-user-provisioner';

import { CreateCustomerDto } from '@application/ports/input/customer/dto/create-customer.dto';
import { ResourceConflictException } from '@application/exceptions/resource-conflict.exception';
import { BUSINESS_EVENTS } from '@application/logging/business-event.catalog';

export class CreateCustomerUseCase implements ICreateCustomerUseCase {
  constructor(
    private readonly unitOfWork: IUnitOfWork,
    private readonly customerAccessUserProvisioner: CustomerAccessUserProvisioner,
    private readonly logger: ILogger,
  ) {}

  async execute(input: CreateCustomerDto, actingUserId: string): Promise<Customer> {
    const document = Document.create(input.document, input.type);
    const email = Email.create(input.email);

    if (input.createAccess === true && input.type === CustomerType.COMPANY) {
      throw new BusinessRuleViolationException(
        'createAccess não pode ser true para clientes do tipo COMPANY — crie o cliente ' +
          'primeiro e conceda acesso separadamente em POST /customers/:customerId/users',
      );
    }

    const shouldCreateAccess = input.createAccess ?? input.type === CustomerType.INDIVIDUAL;

    await this.unitOfWork.executeTransaction((repos) =>
      this.validateExistence(repos, document, email),
    );

    const customer = Customer.create(input);

    // A conflict on the insert below leaves this user in the identity; a retry reuses it by the CPF.
    const access = shouldCreateAccess
      ? await this.customerAccessUserProvisioner.ensureUser(customer)
      : null;

    const created = await this.unitOfWork.executeTransaction(async (repos) => {
      const saved = await repos.customer.create(customer);

      if (access) {
        await repos.userCustomer.create(
          UserCustomer.create({ userId: access.userId, customerId: saved.id }),
        );
      }

      return saved;
    });

    if (access) {
      this.logger.event(BUSINESS_EVENTS.CUSTOMER_ACCESS_GRANTED, {
        subjectId: actingUserId,
        targetUserId: access.userId,
        customerId: created.id,
        accessUserCreated: access.created,
        initialPasswordSent: access.created,
      });
    }

    return created;
  }

  private async validateExistence(
    repos: IRepositories,
    document: Document,
    email: Email,
  ): Promise<void> {
    const existingByDocument = await repos.customer.findByDocument(document.value);

    if (existingByDocument) {
      throw new ResourceConflictException(`Documento '${document.value}' já está cadastrado.`);
    }

    const existingByEmail = await repos.customer.findByEmail(email.value);

    if (existingByEmail) {
      throw new ResourceConflictException(`E-mail '${email.value}' já está cadastrado.`);
    }
  }
}
