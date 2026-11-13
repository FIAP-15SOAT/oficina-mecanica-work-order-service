# language: pt
Funcionalidade: Cobrança da OS
  O work-order segura a OS em AWAITING_PAYMENT enquanto o Billing cobra; a cobrança que não chega ao
  pagamento devolve a OS ao status de origem, e a que chega com a OS fora de status é cancelada no Billing

  Contexto:
    Dado uma OS aprovada com um serviço e sem peças

  Cenário: Cobrança expirada devolve a OS ao status de origem
    Quando o Billing pede o pagamento de "100.00"
    Então a OS fica "AWAITING_PAYMENT"
    Quando o Billing informa que a cobrança expirou
    Então a Saga "PAYMENT" fica "COMPENSATED"
    E a OS fica "APPROVED"

  Cenário: Cobrança com a OS já em execução é cancelada
    Quando o mecânico inicia o serviço
    Então a OS fica "IN_PROGRESS"
    Quando o Billing pede o pagamento de "100.00"
    Então o work-order pede ao Billing o cancelamento da cobrança
    E a Saga "PAYMENT" fica "COMPENSATING"
    Quando o Billing confirma o cancelamento da cobrança
    Então a Saga "PAYMENT" fica "COMPENSATED"
    E a OS fica "IN_PROGRESS"
    E nenhum e-mail com o link de pagamento é enviado
