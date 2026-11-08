import { validate as isUuid } from 'uuid';
import { DomainValidationException } from '../exceptions/domain-validation.exception';
import { LineItemPrice } from '../value-objects/line-item-price.vo';

export interface CreateQuotePartSupplyProps {
  quoteId: string;
  partSupplyId: string;
  quantity: number;
  unitPrice: number;
}

interface QuotePartSupplyProps {
  quoteId: string;
  partSupplyId: string;
  lineItem: LineItemPrice;
  createdAt: Date;
  updatedAt: Date;
}

interface ReconstitueQuotePartSupplyProps {
  quoteId: string;
  partSupplyId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  createdAt: Date;
  updatedAt: Date;
}

export class QuotePartSupply {
  readonly quoteId: string;
  readonly partSupplyId: string;
  private _lineItem: LineItemPrice;
  readonly createdAt: Date;
  updatedAt: Date;

  private constructor(props: QuotePartSupplyProps) {
    this.quoteId = props.quoteId;
    this.partSupplyId = props.partSupplyId;
    this._lineItem = props.lineItem;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static reconstitute(props: ReconstitueQuotePartSupplyProps): QuotePartSupply {
    return new QuotePartSupply({
      quoteId: props.quoteId,
      partSupplyId: props.partSupplyId,
      lineItem: LineItemPrice.reconstitute(props.quantity, props.unitPrice, props.totalPrice),
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    });
  }

  static create(props: CreateQuotePartSupplyProps): QuotePartSupply {
    QuotePartSupply.validateQuoteId(props.quoteId);
    QuotePartSupply.validatePartSupplyId(props.partSupplyId);

    const now = new Date();

    return new QuotePartSupply({
      quoteId: props.quoteId,
      partSupplyId: props.partSupplyId,
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

  private static validatePartSupplyId(partSupplyId: string): void {
    if (!partSupplyId?.trim()) {
      throw new DomainValidationException('ID da peça/insumo é obrigatório');
    }

    if (!isUuid(partSupplyId.trim())) {
      throw new DomainValidationException('ID da peça/insumo deve ser um UUID válido');
    }
  }
}
