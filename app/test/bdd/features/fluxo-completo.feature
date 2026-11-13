# language: pt
Funcionalidade: Fluxo completo da OS
  A OS vai da abertura à entrega: orçamento enviado e aprovado no Billing, peça reservada no Inventory,
  cobrança do valor total paga antes da execução, execução com baixa do estoque e entrega com o saldo quitado

  Contexto:
    Dado uma OS aberta com um serviço e uma peça

  Cenário: OS da abertura à entrega com a cobrança total paga
    Então a OS fica "RECEIVED"
    Quando o atendente inicia o diagnóstico
    Então a OS fica "IN_DIAGNOSIS"
    Quando o Billing envia o orçamento
    Então a OS fica "AWAITING_APPROVAL"
    Quando o Billing aprova o orçamento
    Então o work-order pede ao Inventory a reserva da peça
    Quando o Inventory confirma a reserva
    Então a OS fica "APPROVED"
    E a Saga "QUOTE_APPROVAL" fica "COMPLETED"
    Quando o Billing pede o pagamento de "240.00"
    Então a OS fica "AWAITING_PAYMENT"
    E o cliente recebe o e-mail com o link de pagamento
    Quando o Billing confirma o pagamento
    Então a Saga "PAYMENT" fica "COMPLETED"
    E a OS fica "APPROVED"
    Quando o mecânico inicia o serviço
    Então a OS fica "IN_PROGRESS"
    E o work-order pede ao Inventory a baixa do estoque
    Quando o mecânico conclui o serviço
    Então a OS fica "COMPLETED"
    Quando o atendente entrega a OS
    Então a OS fica "DELIVERED"
    E o histórico da OS mostra "RECEIVED, IN_DIAGNOSIS, AWAITING_APPROVAL, APPROVED, AWAITING_PAYMENT, APPROVED, IN_PROGRESS, COMPLETED, DELIVERED"
