# language: pt
Funcionalidade: Aprovação do orçamento com reserva de estoque
  O work-order aprova a OS só depois que o Inventory reserva as peças do orçamento aprovado no Billing

  Contexto:
    Dado uma OS aguardando a aprovação do orçamento com uma peça

  Cenário: Reserva confirmada aprova a OS
    Quando o Billing aprova o orçamento
    Então o work-order pede ao Inventory a reserva da peça
    Quando o Inventory confirma a reserva
    Então a OS fica "APPROVED"

  Cenário: Falta de estoque devolve o orçamento e a reaprovação conclui a Saga
    Quando o Billing aprova o orçamento
    Então o work-order pede ao Inventory a reserva da peça
    Quando o Inventory recusa a reserva por falta de estoque
    Então o work-order pede ao Billing a reversão da aprovação para "SENT"
    Quando o Billing confirma a reversão da aprovação
    Então a Saga "QUOTE_APPROVAL" fica "COMPENSATED"
    E a OS fica "AWAITING_APPROVAL"
    Quando o Billing aprova o orçamento
    Então o work-order pede ao Inventory a reserva da peça
    Quando o Inventory confirma a reserva
    Então a mesma Saga "QUOTE_APPROVAL" fica "COMPLETED"
    E a OS fica "APPROVED"
