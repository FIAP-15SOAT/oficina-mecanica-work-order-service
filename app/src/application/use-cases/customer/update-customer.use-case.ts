import { Customer } from '@domain/entities/customer.entity';
import { CustomerType } from '@domain/enums/customer-type.enum';
import { Email } from '@domain/value-objects/email.vo';
import { Document } from '@domain/value-objects/document.vo';

import { ICustomerRepository } from '@domain/interfaces/repositories/customer.repository.interface';
import { IUserCustomerRepository } from '@domain/interfaces/repositories/user-customer.repository.interface';
import { IUpdateCustomerUseCase } from '@application/ports/input/customer/update-customer.use-case.interface';
import { UpdateCustomerDto } from '@application/ports/input/customer/dto/update-customer.dto';

import { ResourceConflictException } from '@application/exceptions/resource-conflict.exception';
import { ResourceNotFoundException } from '@application/exceptions/resource-not-found.exception';
import { BusinessRuleViolationException } from '@domain/exceptions/business-rule-violation.exception';
import { ICache } from '@application/ports/output/services/cache.service.interface';
import { workOrderCacheKey } from '@application/keys/work-order-cache-key';
import { IWorkOrderRepository } from '@domain/interfaces/repositories/work-order.repository.interface';

export class UpdateCustomerUseCase implements IUpdateCustomerUseCase {
  constructor(
    private readonly customerRepository: ICustomerRepository,
    private readonly userCustomerRepository: IUserCustomerRepository,
    private readonly workOrderRepository: IWorkOrderRepository,
    private readonly cache: ICache,
  ) {}

  async execute(id: string, input: UpdateCustomerDto): Promise<Customer> {
    const existing = await this.customerRepository.findById(id);

    if (!existing) {
      throw new ResourceNotFoundException('Cliente', id);
    }

    await this.ensureIdentityCanChange(existing, input);
    await this.validateExistenceByDocument(existing, input);
    await this.validateExistenceByEmail(existing, input);

    existing.update(input);

    // Read before the write: a failed lookup must fail the request before anything is stored.
    const cacheKeys = await this.findWorkOrderCacheKeys(id);

    const updated = await this.customerRepository.update(existing);

    await this.cache.delete(cacheKeys);

    return updated;
  }

  private async validateExistenceByDocument(
    existing: Customer,
    input: UpdateCustomerDto,
  ): Promise<void> {
    const newDocument = Document.create(input.document, input.type);

    if (newDocument.equals(existing.document)) {
      return;
    }

    const existingByDocument = await this.customerRepository.findByDocument(newDocument.value);

    if (existingByDocument) {
      throw new ResourceConflictException(`Documento '${newDocument.value}' já está cadastrado.`);
    }
  }

  private async validateExistenceByEmail(
    existing: Customer,
    input: UpdateCustomerDto,
  ): Promise<void> {
    const newEmail = Email.create(input.email);

    if (newEmail.equals(existing.email)) {
      return;
    }

    const existingByEmail = await this.customerRepository.findByEmail(newEmail.value);

    if (existingByEmail) {
      throw new ResourceConflictException(`E-mail '${newEmail.value}' já está cadastrado.`);
    }
  }

  private async findWorkOrderCacheKeys(customerId: string): Promise<string[]> {
    const workOrders = await this.workOrderRepository.findByCustomerId(customerId);

    return workOrders.map((workOrder) => workOrderCacheKey(workOrder.id));
  }

  /**
   * Changing the type always rewrites the meaning of the link. Changing the
   * document only breaks the identity when the customer is INDIVIDUAL, because
   * then the customer's document IS the holder user's CPF — a COMPANY's CNPJ
   * does not identify who represents it, so correcting it should not be blocked.
   */
  private async ensureIdentityCanChange(
    existing: Customer,
    input: UpdateCustomerDto,
  ): Promise<void> {
    const newDocument = Document.create(input.document, input.type);

    const isTypeChange = input.type !== existing.type;
    const isDocumentChange = !newDocument.equals(existing.document);

    const breaksAccessIdentity =
      isTypeChange || (isDocumentChange && existing.type === CustomerType.INDIVIDUAL);

    if (!breaksAccessIdentity) {
      return;
    }

    const linkedUsers = await this.userCustomerRepository.findUsersByCustomerId(existing.id);

    if (linkedUsers.length > 0) {
      throw new BusinessRuleViolationException(
        'Não é possível alterar o tipo do cliente, nem o documento de um cliente pessoa física, enquanto houver vínculos de acesso.',
      );
    }

    const hasWorkOrders = await this.customerRepository.hasWorkOrders(existing.id);

    if (hasWorkOrders) {
      throw new BusinessRuleViolationException(
        'Não é possível alterar o tipo do cliente, nem o documento de um cliente pessoa física, enquanto houver ordens de serviço vinculadas.',
      );
    }
  }
}
