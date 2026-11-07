import { validate as isUuid } from 'uuid';
import { DomainValidationException } from '../exceptions/domain-validation.exception';
import { LineItemPrice } from '../value-objects/line-item-price.vo';

export interface CreateQuoteServiceProps {
  quoteId: string;
  serviceId: string;
  quantity: number;
  unitPrice: number;
}

interface QuoteServiceProps {
  quoteId: string;
  serviceId: string;
  lineItem: LineItemPrice;
  createdAt: Date;
  updatedAt: Date;
}

interface ReconstitueQuoteServiceProps {
  quoteId: string;
  serviceId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  createdAt: Date;
  updatedAt: Date;
}

export class QuoteService {
  readonly quoteId: string;
  readonly serviceId: string;
  private _lineItem: LineItemPrice;
  readonly createdAt: Date;
  updatedAt: Date;

  private constructor(props: QuoteServiceProps) {
    this.quoteId = props.quoteId;
    this.serviceId = props.serviceId;
    this._lineItem = props.lineItem;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static reconstitute(props: ReconstitueQuoteServiceProps): QuoteService {
    return new QuoteService({
      quoteId: props.quoteId,
      serviceId: props.serviceId,
      lineItem: LineItemPrice.reconstitute(props.quantity, props.unitPrice, props.totalPrice),
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    });
  }

  static create(props: CreateQuoteServiceProps): QuoteService {
    QuoteService.validateQuoteId(props.quoteId);
    QuoteService.validateServiceId(props.serviceId);

    const now = new Date();

    return new QuoteService({
      quoteId: props.quoteId,
      serviceId: props.serviceId,
      lineItem: LineItemPrice.create(props.quantity, props.unitPrice),
      createdAt: now,
      updatedAt: now,
    });
  }

  updateQuantity(quantity: number): void {
    this._lineItem = this._lineItem.withQuantity(quantity);
    this.updatedAt = new Date();
  }

  get lineItem(): LineItemPrice {
    return this._lineItem;
  }

  get quantity(): number {
    return this._lineItem.quantity;
  }

  get unitPrice(): number {
    return this._lineItem.unitPrice;
  }

  get totalPrice(): number {
    return this._lineItem.totalPrice;
  }

  private static validateQuoteId(quoteId: string): void {
    if (!quoteId?.trim()) {
      throw new DomainValidationException('ID do orçamento é obrigatório');
    }

    if (!isUuid(quoteId.trim())) {
      throw new DomainValidationException('ID do orçamento deve ser um UUID válido');
    }
  }

  private static validateServiceId(serviceId: string): void {
    if (!serviceId?.trim()) {
      throw new DomainValidationException('ID do serviço é obrigatório');
    }

    if (!isUuid(serviceId.trim())) {
      throw new DomainValidationException('ID do serviço deve ser um UUID válido');
    }
  }
}
