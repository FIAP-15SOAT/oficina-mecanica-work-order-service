# language: pt
Funcionalidade: Aprovação do orçamento com reserva de estoque
  O work-order aprova a OS só depois que o Inventory reserva as peças do orçamento aprovado no Billing

  Cenário: Reserva confirmada aprova a OS
    Dado uma OS aguardando a aprovação do orçamento com uma peça
    Quando o Billing aprova o orçamento
    Então o work-order pede ao Inventory a reserva da peça
    Quando o Inventory confirma a reserva
    Então a OS fica "APPROVED"
