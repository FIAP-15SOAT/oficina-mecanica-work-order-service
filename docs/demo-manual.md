# 🎬 Manual de demonstração e teste ponta a ponta

Este manual leva quem não conhece a solução a executar, no ambiente no ar, a vida de uma ordem de serviço (OS) da abertura à entrega e as falhas com compensação que dá para provocar de fora. Cada passo traz a requisição, com o nome dela nas collections Postman da solução, de onde vem cada id e o que conferir: a resposta HTTP, o status da OS, o status do orçamento ou da cobrança, o e-mail no MailHog e o que mostrar no Datadog. No fim, o manual mostra o deploy automatizado de um serviço, com os testes que o liberam.

A solução tem quatro serviços e duas funções Lambda, todos atrás de um único API Gateway, a porta pública da solução:

- o **work-order**, este serviço, dono dos clientes, dos veículos e das OS, que coordena as Sagas (as sequências de passos entre serviços, com compensação quando um passo falha);
- o **Identity**, dono dos usuários e do login dos funcionários;
- o **Billing**, dono dos orçamentos e das cobranças, que cria cada cobrança no Mercado Pago, o provedor de pagamento;
- o **Inventory**, dono do catálogo de serviços e peças e do estoque;
- a **customer-auth**, a função Lambda que faz o login do cliente por CPF e senha;
- a **notification**, a função Lambda que envia os e-mails da solução ao MailHog, um servidor de e-mail de teste que guarda as mensagens e as mostra numa página web, sem entregá-las a ninguém.

## Índice

- [Preparação do ambiente](#preparação-do-ambiente)
- [Fluxo completo, da abertura à entrega](#fluxo-completo-da-abertura-à-entrega)
- [Pagamento no sandbox do Mercado Pago](#pagamento-no-sandbox-do-mercado-pago)
- [Falhas com compensação provocadas de fora](#falhas-com-compensação-provocadas-de-fora)
- [Outras falhas da matriz F1 a F14](#outras-falhas-da-matriz-f1-a-f14)
- [Deploy automatizado de um serviço](#deploy-automatizado-de-um-serviço)
- [Documentos relacionados](#documentos-relacionados)

## Preparação do ambiente

### Subida do ambiente

O ambiente sobe pelo script `scripts/environment-up.sh` do [`oficina-mecanica-infra-base`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-base), com as credenciais AWS da sessão gravadas nos secrets da organização, como descreve o [Runbook da Sessão](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-base/blob/main/docs/runbook.md). O script sobe as camadas na ordem, roda as migrations, roda o seed do work-order, do Identity e do Inventory e termina conferindo a saúde dos quatro serviços pelo API Gateway.

O seed cria os dados que este manual usa, com ids fixos listados em [Ids canônicos do seed](seed-ids.md):

| Dado | Valor |
| --- | --- |
| Funcionário `ADMIN` | e-mail `guilhermedarochasalvador@gmail.com`, senha `Tech@2026`; os outros três `ADMIN` do seed, `lucas.almeida-silva@hotmail.com`, `ramooncamacho@hotmail.com` e `camacho.renan@gmail.com`, com a mesma senha, também servem |
| Cliente | João da Silva, CPF `12345678909`, id `70bb2668-aa3a-4412-afca-198286ca98db` |
| Usuário de acesso do cliente | `joao.silva@email.com`, CPF `12345678909`, senha `Tech@2026`, vinculado ao cliente acima; é ele quem recebe os e-mails |
| Veículos do cliente | `ABC-1234`, id `4074d524-911a-4e03-a827-d3d0dd01447e`, e `DEF-5678`, id `89a190fc-770f-456b-ac45-9e6287accd5a` |
| Serviço `Troca de óleo` | id `3551b3f8-625e-4f2b-b777-a1d0ec4e4585`, R$ 150,00 |
| Peça `FILT-OL-001` (Filtro de Óleo) | id `361b050f-c441-429d-8a73-dfc12415dc62`, R$ 45,00, estoque inicial 50 |
| Serviço `Troca de bateria` | id `c992d344-7f2b-45d4-b854-770734140531` |
| Peça `BAT-60AH-001` (Bateria 60Ah) | id `be2df5a7-92bd-4f4b-b0d5-7953157c48f0`, estoque inicial 15 |

### Collections e environment do Postman

Os passos usam requisições de três collections Postman, que também podem ser importadas no Insomnia. Importe as três collections e o environment do work-order para o ambiente implantado:

| Collection | Arquivo | O que este manual usa dela |
| --- | --- | --- |
| **Work Order API** | [`collections/oficina-collection.json`](../collections/oficina-collection.json) | Os logins, a OS, a área do cliente e a pasta **Fluxo ponta a ponta** |
| **Billing API** | [`collections/billing-collection.json`](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/collections/billing-collection.json), no repositório do Billing | A consulta do orçamento e da cobrança e o cancelamento da cobrança |
| **Inventory Service** | [`collections/inventory-collection.json`](https://github.com/FIAP-15SOAT/oficina-mecanica-inventory-service/blob/main/collections/inventory-collection.json), no repositório do Inventory | A consulta da peça e a entrada de estoque |

| Environment | Arquivo |
| --- | --- |
| **Work Order API · Gateway** | [`collections/oficina-gateway-environment.json`](../collections/oficina-gateway-environment.json) |

Selecione o **Work Order API · Gateway** também ao rodar as requisições das collections do Billing e do Inventory: elas leem as mesmas variáveis (`baseUrl`, `authToken`, `quoteId`, `paymentId` e `partSupplyId`), então o id que uma requisição grava serve às das outras collections. O Billing e o Inventory também têm o próprio environment para o API Gateway, [Billing API · Gateway](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/collections/billing-gateway-environment.json) e [Inventory · Gateway](https://github.com/FIAP-15SOAT/oficina-mecanica-inventory-service/blob/main/collections/inventory-gateway-environment.json), que servem para testar cada serviço sozinho e não são usados aqui.

Cada passo indica a requisição como **Postman:** collection › pasta › requisição. As requisições da pasta **Fluxo ponta a ponta** da collection do work-order gravam no environment os ids que as seguintes usam e, nos passos que mudam a OS por mensagem, repetem a consulta sozinhas até o status esperado, uma vez por segundo, por até 15 segundos (60 na espera do pagamento). Na ordem da pasta, elas refazem o fluxo deste manual com uma cobrança só ([Testes › Fluxo ponta a ponta](testing.md#fluxo-ponta-a-ponta)).

### URL pública e variáveis

Todas as requisições passam pelo API Gateway. A URL dele muda a cada subida do ambiente:

```bash
# Ler a URL pública do API Gateway da solução
aws apigatewayv2 get-apis --query "Items[?Name=='apigw-oficina-mecanica'].ApiEndpoint | [0]" --output text
```

Preencha `baseUrl` no environment com essa URL; `identityBaseUrl` já vale `{{baseUrl}}`, porque o gateway encaminha `/api/auth` ao Identity. As outras variáveis são preenchidas ao longo do manual:

| Variável | Valor |
| --- | --- |
| `authToken` | Token do funcionário, do login do funcionário |
| `customerJwtToken` | Token do cliente, do login do cliente |
| `workOrderId` | Id da OS, da resposta da abertura |
| `quoteId` e `quoteTotalAmount` | Id e valor total do orçamento, da lista de orçamentos da OS |
| `paymentId`, `checkoutId` e `checkoutUrl` | Id da cobrança, id da order dela no Mercado Pago e link de pagamento, da resposta da criação da cobrança |
| `myCustomerId`, `myVehicleId`, `serviceId` e `partSupplyId` | Já vêm preenchidas com os ids do cliente, do veículo `ABC-1234`, da `Troca de óleo` e do `FILT-OL-001` |

Para conferir que os quatro serviços respondem, chame sem token `GET {{baseUrl}}/health/work-order`, `/health/identity`, `/health/billing` e `/health/inventory`: cada uma responde **200**.

### Conta e aplicação no Mercado Pago

O Billing cria as cobranças com as credenciais de uma aplicação do Mercado Pago, numa conta de teste do sandbox (o ambiente de teste do Mercado Pago, com contas e cartões fictícios). A configuração é feita uma vez:

1. **Aplicação e contas de teste.** Numa conta real do Mercado Pago, abra **Suas integrações**, no [painel de desenvolvedor](https://www.mercadopago.com.br/developers/panel/app), e crie uma aplicação para o Checkout Pro, a página de pagamento hospedada pelo Mercado Pago. O Mercado Pago cria junto a conta de teste vendedora, dona da aplicação que o Billing usa. Na seção **Contas de teste**, crie também uma conta compradora, do mesmo país: uma conta de teste não pode vender e comprar ao mesmo tempo.
2. **Credenciais.** Numa janela anônima, entre com o usuário e a senha da conta vendedora; o código de verificação de 6 dígitos fica na tabela de **Contas de teste**. Na aplicação dela, em **Suas integrações**, o access token fica em **Credenciais**, e a chave secreta do webhook, em **Configuração de webhooks**, onde o evento **Order (Mercado Pago)** precisa estar marcado.
3. **Secrets do Billing.** Grave o access token em `MERCADOPAGO_ACCESS_TOKEN` e a chave secreta em `MERCADOPAGO_WEBHOOK_SECRET`, secrets do environment `production` do repositório do Billing, e rode o CD do Billing, como em [Runbook do Mercado Pago › Credenciais no GitHub](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/runbook.md#credenciais-no-github).

O runbook também mostra como conferir o dono do token antes de gravá-lo e como trocar a chave secreta ([Runbook do Mercado Pago › Contas de teste](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/runbook.md#contas-de-teste)).

### URL do webhook no painel do Mercado Pago

O webhook é a notificação que o Mercado Pago envia ao Billing, em `POST /webhooks/mercadopago`, a cada mudança de uma cobrança. O Mercado Pago só a envia à URL cadastrada no painel da aplicação, e essa URL muda a cada subida do ambiente. **A cada sessão em que se demonstra pagamento**, cadastre `<URL do API Gateway>/webhooks/mercadopago` no painel, logado como a conta vendedora de teste, como em [Runbook do Mercado Pago › URL do webhook no painel](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/runbook.md#url-do-webhook-no-painel).

Antes de seguir o fluxo, faça um pagamento inteiro no sandbox para conferir a configuração. Sem pagamento a OS não é entregue: a entrega exige saldo zero, e só uma cobrança paga pelo Mercado Pago reduz o saldo.

### MailHog

O MailHog roda no cluster EKS (o Kubernetes gerenciado da AWS onde os serviços rodam), no namespace `platform` (o agrupamento de recursos do Kubernetes onde ficam os componentes de plataforma), e a página dele não é pública. Abra um túnel da máquina local até ele:

```bash
# Configurar o kubectl para o cluster da solução
aws eks update-kubeconfig --name eks-oficina-mecanica --region us-east-1

# Abrir um túnel da porta 8025 local até a página web do MailHog
kubectl port-forward -n platform svc/mailhog 8025:8025
```

Com o túnel aberto, a página fica em `http://localhost:8025`. Os e-mails do cliente do seed chegam para `joao.silva@email.com`.

### Datadog

O Datadog é a plataforma de monitoramento que recebe os logs, as métricas e os traces da solução (o trace é o caminho de uma requisição pelos serviços, com o tempo de cada trecho). Os quatro serviços enviam a telemetria ao Datadog Agent, o coletor que roda no namespace `platform` do cluster, e as duas Lambdas, pela extensão do Datadog que roda junto de cada função. Este manual usa três áreas do Datadog:

- **Dashboards** (menu **Dashboards**, busca por `Oficina Mecânica`): os painéis declarados no repositório [`oficina-mecanica-custom-monitoring`](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring). A **Visão Geral** mostra a saúde de cada serviço e de cada Lambda e tem os links para os outros: um por serviço, **Ordens de Serviço**, **Sagas**, **Pagamentos**, **Mensageria** e **Kubernetes**. O que cada gráfico mostra está em [Dashboards](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring/blob/main/docs/dashboards.md).
- **APM → Traces**: os traces, filtrados pelo serviço. Cada serviço aparece como `oficina-mecanica-<serviço>-service` (por exemplo, `oficina-mecanica-work-order-service`), e a Lambda de e-mail como `oficina-mecanica-lambda-notification`. Uma chamada interna e uma mensagem pela fila continuam o trace no serviço seguinte, porque levam junto o contexto do trace (o cabeçalho `traceparent`). A consulta de cada trace das Sagas e dos spans das filas está em [Observabilidade › Consultas no Datadog](observability.md#consultas-no-datadog).
- **Logs**: os logs JSON de todos os serviços. O nome de cada evento de negócio fica no campo `@oficina.event.name`, e os eventos de uma OS levam o id dela em `@oficina.work_order.id`: a busca `@oficina.work_order.id:<workOrderId>` mostra, em ordem, o que cada serviço registrou sobre a OS. No painel de uma linha de log, a aba **Trace** abre o trace dela.

Uma métrica leva um ou dois minutos para chegar aos dashboards, e os de Ordens de Serviço, Sagas e Pagamentos mostram os últimos 7 dias. Consulte os logs e os traces logo depois de cada passo, porque o modo Live do Trace Explorer mostra todos os spans só dos últimos 15 minutos, e os dashboards no fim do fluxo.

### Login do funcionário

O funcionário entra pelo Identity:

```http
POST {{identityBaseUrl}}/api/auth/login
Content-Type: application/json

{
  "email": "guilhermedarochasalvador@gmail.com",
  "password": "Tech@2026"
}
```

**Postman:** Work Order API › Autenticação › `TC-AUTH-01 — Login com credenciais válidas — Identity`, ou `E2E-01 — Login do funcionário (Identity)` na pasta Fluxo ponta a ponta. As duas gravam `data.accessToken` em `authToken` e `data.refreshToken` em `refreshToken`.

**Conferir:** **200** com `data.accessToken`, `data.refreshToken` e `data.user.role` `ADMIN`. Toda requisição de funcionário leva `Authorization: Bearer {{authToken}}`, que as três collections já enviam.

O token do funcionário vale 10 minutos. Quando uma requisição responder **401**, repita o login (na pasta Fluxo ponta a ponta, `E2E-10A — Login do funcionário de novo (Identity)`) ou troque o refresh token por um par novo em `POST {{identityBaseUrl}}/api/auth/refresh`, com o corpo `{ "refreshToken": "{{refreshToken}}" }` (Work Order API › Autenticação › `TC-AUTH-03 — Renovar tokens com refreshToken válido (sucesso) — Identity`).

### Login do cliente

O cliente entra pela customer-auth, publicada no API Gateway. A função confere a senha no Identity e o vínculo do usuário com um cliente ativo no work-order, e só então emite o token:

```http
POST {{baseUrl}}/customer-auth/login
Content-Type: application/json

{
  "cpf": "12345678909",
  "password": "Tech@2026"
}
```

**Postman:** Work Order API › Autenticação › `TC-AUTH-06 — Login de cliente via API Gateway (sucesso)`, ou `E2E-02 — Login do cliente (Lambda customer-auth)` na pasta Fluxo ponta a ponta. As duas enviam o CPF e a senha das variáveis `customerCpf` e `customerPassword`, que já vêm com os do cliente do seed, e gravam `data.accessToken` em `customerJwtToken`.

**Conferir:** **200** com `data.accessToken` e `data.expiresIn` `3600` (uma hora). As rotas do cliente, em `/api/me/...`, levam `Authorization: Bearer {{customerJwtToken}}`. Credencial errada responde **401** com a mesma mensagem para qualquer causa.

## Fluxo completo, da abertura à entrega

O fluxo segue a OS por estes status: `RECEIVED` → `IN_DIAGNOSIS` → `AWAITING_APPROVAL` → `APPROVED` → `AWAITING_PAYMENT` → `APPROVED` → `IN_PROGRESS` → `COMPLETED` → `AWAITING_PAYMENT` → `COMPLETED` → `DELIVERED`. Ele usa duas cobranças, o sinal antes da execução e o restante depois dela. Para uma cobrança só, como na pasta Fluxo ponta a ponta, cobre o valor total no passo 6, pule o passo 10 e entregue a OS direto.

Vários passos mudam a OS por mensagem entre os serviços, segundos depois da resposta. Nesses passos, o manual diz o que consultar e o status esperado: repita a consulta a cada um ou dois segundos até o status aparecer. As requisições da pasta Fluxo ponta a ponta já fazem essa espera; fora dela, consulte a OS com Work Order API › Gestão de Ordens de Serviço › `TC-WO-04 — Buscar Ordem de Serviço por ID`.

### 1. Abrir a OS com um serviço e uma peça

A abertura cria a OS no work-order e o orçamento inicial, com os mesmos itens, no Billing. O preço de cada item vem do catálogo do Inventory.

```http
POST {{baseUrl}}/api/work-orders
Authorization: Bearer {{authToken}}
Content-Type: application/json

{
  "customerId": "{{myCustomerId}}",
  "vehicleId": "{{myVehicleId}}",
  "problemDescription": "Revisão com troca de óleo e filtro",
  "mileageAtService": 55000,
  "services": [{ "serviceId": "{{serviceId}}", "quantity": 1 }],
  "partsSupplies": [{ "partSupplyId": "{{partSupplyId}}", "quantity": 1 }]
}
```

**Postman:** Work Order API › Fluxo ponta a ponta › `E2E-03 — Abrir a OS com um serviço e uma peça`, que grava `data.id` em `workOrderId`.

**Ids:** `myCustomerId` e `myVehicleId` são o cliente e o veículo `ABC-1234` do seed; `serviceId` é a `Troca de óleo` e `partSupplyId`, o `FILT-OL-001`.

**Conferir:** **201** com `data.status` `RECEIVED`. Anote `data.number`, o número da OS que aparece nos e-mails.

**Datadog:** em **APM → Traces**, o trace de `POST /api/work-orders` no `oficina-mecanica-work-order-service` ([consulta](observability.md#traces-das-sagas)) mostra a Saga de abertura numa requisição só: a chamada `POST /internal/quotes` ao Billing e, dentro dela, as leituras do catálogo no Inventory, antes da gravação da OS.

### 2. Iniciar o diagnóstico

```http
PATCH {{baseUrl}}/api/work-orders/{{workOrderId}}
Authorization: Bearer {{authToken}}
Content-Type: application/json

{
  "status": "IN_DIAGNOSIS",
  "notes": "Iniciando diagnóstico técnico"
}
```

**Postman:** Work Order API › Fluxo ponta a ponta › `E2E-04 — Iniciar o diagnóstico`.

**Conferir:** **200** com `data.status` `IN_DIAGNOSIS`.

### 3. Enviar o orçamento ao cliente

Primeiro, pegue o id do orçamento inicial na lista de orçamentos da OS, que fica no Billing:

```http
GET {{baseUrl}}/api/work-orders/{{workOrderId}}/quotes
Authorization: Bearer {{authToken}}
```

**Postman:** Work Order API › Fluxo ponta a ponta › `E2E-05 — Ler o orçamento inicial da OS (Billing)`, que grava `data[0].id` em `quoteId` e o total em `quoteTotalAmount`.

**Conferir:** **200** com um orçamento em `data`, `status` `PENDING` e `totalAmount` 195 com os preços do seed (150,00 do serviço mais 45,00 da peça).

Depois, envie o orçamento:

```http
POST {{baseUrl}}/api/quotes/{{quoteId}}/submissions
Authorization: Bearer {{authToken}}
```

**Postman:** Work Order API › Fluxo ponta a ponta › `E2E-06 — Enviar o orçamento ao cliente (Billing)`, que já espera a OS em `AWAITING_APPROVAL`.

**Conferir:**

- **200** com `data.status` `SENT`;
- **espera:** `GET {{baseUrl}}/api/work-orders/{{workOrderId}}` até `data.status` `AWAITING_APPROVAL`;
- **MailHog:** e-mail para `joao.silva@email.com` com o assunto `Orçamento para Ordem de Serviço <número> - Aguardando sua aprovação`, os itens e o valor total;
- **Datadog:** nos Logs, o evento `quote.submitted` do Billing. O trace de `POST /api/quotes/{id}/submissions` no `oficina-mecanica-billing-service` ([consulta](observability.md#traces-das-sagas)) continua no work-order, no span `process work-order.fifo` (o consumo da mensagem `billing.quote.sent`), e na Lambda notification, que envia o e-mail.

### 4. O cliente consulta e aprova o orçamento

Se ainda não fez, faça aqui o [login do cliente](#login-do-cliente). Com o token do cliente, consulte o orçamento com os itens:

```http
GET {{baseUrl}}/api/me/quotes/{{quoteId}}
Authorization: Bearer {{customerJwtToken}}
```

**Postman:** Work Order API › Fluxo ponta a ponta › `E2E-07 — O cliente consulta o orçamento`.

**Conferir:** **200** com o orçamento `SENT`, o serviço e a peça.

Depois, o cliente aprova:

```http
POST {{baseUrl}}/api/me/quotes/{{quoteId}}/decisions
Authorization: Bearer {{customerJwtToken}}
Content-Type: application/json

{
  "action": "approve"
}
```

**Postman:** Work Order API › Fluxo ponta a ponta › `E2E-08 — O cliente aprova o orçamento`, que já espera a OS em `APPROVED`.

**Conferir:** **200** com `data.status` `APPROVED`. A aprovação começa a Saga de aprovação: o work-order pede ao Inventory a reserva da peça e só aprova a OS quando a reserva é confirmada.

### 5. Conferir a OS aprovada e a reserva do estoque

- **Espera:** `GET {{baseUrl}}/api/work-orders/{{workOrderId}}` até `data.status` `APPROVED`.
- **Reserva no Inventory:** `GET {{baseUrl}}/api/stock-reservations?workOrderId={{workOrderId}}`, com o token do funcionário (Work Order API › Fluxo ponta a ponta › `E2E-09 — Conferir a reserva da peça (Inventory)`), responde **200** com uma reserva do `FILT-OL-001`, `quantity` 1. Em `GET {{baseUrl}}/api/parts-supplies/{{partSupplyId}}` (Inventory Service › Gestão de Peças e Insumos › `TC-PS-10 — Buscar Peça ou Insumo por ID (sucesso)`), o `reservedStock` da peça subiu 1; o disponível é `stock - reservedStock`.
- **Datadog:** nos Logs, `@oficina.work_order.id:<workOrderId>` mostra a Saga de aprovação passo a passo: `quote.approved` no Billing, `saga.started` no work-order (com `@oficina.saga.type:QUOTE_APPROVAL`), `stock.reserved` no Inventory e `saga.completed` no work-order. O trace de `POST /api/me/quotes/{quoteId}/decisions` atravessa os três serviços ([consulta](observability.md#traces-das-sagas)).

### 6. Cobrar o sinal

```http
POST {{baseUrl}}/api/payments
Authorization: Bearer {{authToken}}
Content-Type: application/json

{
  "workOrderId": "{{workOrderId}}",
  "amount": 50
}
```

O valor tem no máximo duas casas decimais e não passa do saldo da OS (o total do orçamento aprovado menos o que já foi pago).

**Postman:** Work Order API › Fluxo ponta a ponta › `E2E-10 — Cobrar o valor total (Billing)`, trocando no corpo o `{{quoteTotalAmount}}` por `50`. Ela grava `data.id` em `paymentId`, `data.checkoutId` em `checkoutId` e `data.checkoutUrl` em `checkoutUrl`, e já espera a OS em `AWAITING_PAYMENT`.

**Conferir:**

- **201** com `data.status` `PENDING`, `data.checkoutUrl` (o link de pagamento no Checkout Pro, a página de pagamento hospedada pelo Mercado Pago) e `data.checkoutId` (o id da order, a ordem de pagamento no Mercado Pago, que começa com `ORDTST` no sandbox);
- **espera:** `GET {{baseUrl}}/api/work-orders/{{workOrderId}}` até `data.status` `AWAITING_PAYMENT`. Com a OS nesse status, iniciar serviço, entregar e cancelar respondem **409**;
- **MailHog:** e-mail `Pagamento da Ordem de Serviço <número>`, com o valor, o link **Pagar agora** e a validade. O cliente também vê a cobrança, com o link, em `GET {{baseUrl}}/api/me/work-orders/{{workOrderId}}/payments` (Work Order API › Minha Conta › `TC-ME-13 — Cobranças de uma ordem de serviço vinculada`).

### 7. Pagar o sinal

Pague a cobrança e simule a notificação como em [Pagamento no sandbox do Mercado Pago](#pagamento-no-sandbox-do-mercado-pago).

**Postman:** Work Order API › Fluxo ponta a ponta › `E2E-11 — Conferir a cobrança paga (Billing)`, que espera a cobrança paga por até 60 segundos e, depois, a OS de volta a `APPROVED`.

**Conferir:**

- `GET {{baseUrl}}/api/payments/{{paymentId}}` responde **200** com `data.status` `APPROVED`;
- **espera:** `GET {{baseUrl}}/api/work-orders/{{workOrderId}}` até `data.status` `APPROVED`, o status de antes da cobrança;
- `GET {{baseUrl}}/api/work-orders/{{workOrderId}}/status-history` (Work Order API › Gestão de Ordens de Serviço › `TC-WO-10 — Histórico de Status da OS`) mostra as entradas `Aguardando o pagamento da cobrança <paymentId>` e `Cobrança <paymentId> paga`;
- **Datadog:** nos Logs, `payment.requested` no Billing e `saga.started` (com `@oficina.saga.type:PAYMENT`) no work-order; depois do pagamento, `payment.approved` e `saga.completed`. No trace do webhook (`POST /webhooks/mercadopago` no `oficina-mecanica-billing-service`, [consulta](observability.md#traces-das-sagas)) aparece a chamada ao Mercado Pago (`api.mercadopago.com`) que consulta a order.

### 8. Executar o serviço, com a baixa do estoque

O mecânico inicia o serviço, pelo id do serviço no catálogo:

```http
PATCH {{baseUrl}}/api/work-orders/{{workOrderId}}/services/{{serviceId}}
Authorization: Bearer {{authToken}}
Content-Type: application/json

{
  "status": "IN_PROGRESS"
}
```

**Postman:** Work Order API › Fluxo ponta a ponta › `E2E-12 — Iniciar o serviço`, que já espera a baixa da peça no Inventory.

**Conferir:**

- **200** com o serviço `IN_PROGRESS`; `GET {{baseUrl}}/api/work-orders/{{workOrderId}}` mostra a OS em `IN_PROGRESS`;
- **baixa no Inventory (espera):** `GET {{baseUrl}}/api/stock-movements?workOrderId={{workOrderId}}&type=EXIT` até aparecer uma movimentação `EXIT` do `FILT-OL-001`, `quantity` 1, com o motivo `Saída por Ordem de Serviço <workOrderId>`. A reserva some de `GET {{baseUrl}}/api/stock-reservations?workOrderId={{workOrderId}}` (`E2E-09`);
- **Datadog:** nos Logs, o evento `stock.consumed` do Inventory.

### 9. Concluir o serviço

```http
PATCH {{baseUrl}}/api/work-orders/{{workOrderId}}/services/{{serviceId}}
Authorization: Bearer {{authToken}}
Content-Type: application/json

{
  "status": "COMPLETED"
}
```

**Postman:** Work Order API › Fluxo ponta a ponta › `E2E-13 — Concluir o serviço`, que já espera a OS em `COMPLETED`.

**Conferir:** **200** com o serviço `COMPLETED`. Como era o último serviço, a OS vai a `COMPLETED`.

### 10. Ver o saldo e cobrar o restante

Tente entregar a OS antes de cobrar o restante, para mostrar a regra do saldo zero:

```http
PATCH {{baseUrl}}/api/work-orders/{{workOrderId}}
Authorization: Bearer {{authToken}}
Content-Type: application/json

{
  "status": "DELIVERED",
  "notes": "Veículo entregue para o cliente"
}
```

**Postman:** Work Order API › Gestão de Ordens de Serviço › `TC-WO-07 — Entregar a OS com saldo a pagar (409)`.

**Conferir:** **409** com `Ordem de serviço com saldo a pagar de R$ <saldo>: a entrega é liberada depois que o saldo for quitado` (R$ 145.00 com os valores deste manual). A OS segue em `COMPLETED`.

Cobre o saldo com o `E2E-10` do passo 6, com `amount` igual ao saldo da mensagem, como número e sem aspas (`"amount": 145.00`; o valor entre aspas responde **400**), e pague como no passo 7. A requisição grava a nova cobrança em `paymentId`. Desta vez, a OS vai de `COMPLETED` a `AWAITING_PAYMENT` e volta a `COMPLETED` depois do pagamento. Confira a cobrança com Billing API › Cobranças › `Detalhar a cobrança (200)` e a OS com `TC-WO-04`: o `E2E-11` espera a OS de volta a `APPROVED` e não serve aqui.

### 11. Entregar a OS

Repita a entrega do passo 10.

**Postman:** Work Order API › Fluxo ponta a ponta › `E2E-14 — Entregar a OS`.

**Conferir:**

- **200** com `data.status` `DELIVERED`;
- `GET {{baseUrl}}/api/work-orders/{{workOrderId}}/status-history` (`E2E-15 — Histórico de status da OS`) mostra a vida inteira da OS, de `RECEIVED` a `DELIVERED`, com as duas passagens por `AWAITING_PAYMENT`.

**Datadog, no fim do fluxo:**

- **Ordens de Serviço:** a OS em **Ordens de serviço criadas na janela**, o tempo em cada status e o lead time (o tempo da abertura à entrega);
- **Sagas:** em **Sagas finalizadas por tipo e resultado**, uma Saga `quote_approval` e duas `payment` como `completed` (as métricas levam o tipo em minúsculas; nos logs, ele aparece em maiúsculas);
- **Pagamentos:** as duas cobranças em **Cobranças resolvidas por status** como `approved`, e as notificações do Mercado Pago no grupo **Webhooks**: as simuladas com a assinatura `valid` e as automáticas com `invalid_signature` ([Pagamento no sandbox do Mercado Pago](#pagamento-no-sandbox-do-mercado-pago));
- **Mensageria:** as mensagens consumidas por fila, todas com o resultado `success`;
- **Visão Geral:** os quatro serviços e as duas Lambdas, com as requisições do fluxo e nenhum monitor em alerta além do **Pagamentos · Webhook com assinatura inválida**, que as notificações automáticas disparam.

## Pagamento no sandbox do Mercado Pago

O sandbox usa duas contas de teste: a vendedora, dona da aplicação que o Billing usa, e a compradora, que paga. As credenciais das duas ficam em **Suas integrações → Contas de teste**, na conta real do grupo no Mercado Pago ([Runbook do Mercado Pago › Contas de teste](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/runbook.md#contas-de-teste)).

1. **Pegar o link e o id da order.** O link de pagamento (`checkoutUrl`) e o id da order no Mercado Pago (`checkoutId`) vêm na resposta da criação da cobrança, e o `E2E-10` os grava nas variáveis `checkoutUrl` e `checkoutId` do environment. O link também chega ao cliente no e-mail `Pagamento da Ordem de Serviço <número>`, no botão **Pagar agora**, e aparece na área do cliente, em `TC-ME-13 — Cobranças de uma ordem de serviço vinculada`.
2. **Pagar.** Numa janela anônima, abra o `checkoutUrl`, entre com a conta compradora de teste e pague com o cartão Mastercard de teste `5480 8328 0103 3311`, código de segurança `123`, vencimento `11/30`, nome do titular `APRO` (que faz o Mercado Pago aprovar) e CPF `12345678909`.
3. **Simular a notificação.** Numa janela logada como a conta vendedora de teste, abra **Suas integrações → aplicação → Configuração de webhooks**, clique em **Simular notificação**, escolha o evento **Order (Mercado Pago)**, preencha o **Data ID** com o `checkoutId` e envie. O Mercado Pago manda a notificação assinada à URL cadastrada, e o Billing consulta a order e encerra a cobrança pelo status real dela.
4. **Conferir.** `GET {{baseUrl}}/api/payments/{{paymentId}}` (Billing API › Cobranças › `Detalhar a cobrança (200)`, ou o `E2E-11`) responde `data.status` `APPROVED`, e a OS volta ao status de antes da cobrança.

**As notificações automáticas são recusadas.** O Mercado Pago também envia notificações sozinho, quando a cobrança é criada, paga ou cancelada, mas o Billing as recusa com **401** porque a assinatura delas não confere, e só a notificação simulada encerra a cobrança. Cada recusa registra `payment.webhook.invalid_signature` no log do Billing, aparece como `invalid_signature` no grupo **Webhooks** do dashboard **Pagamentos** e dispara o monitor **Pagamentos · Webhook com assinatura inválida**.

Se a cobrança continuar `PENDING` depois da simulação, a URL do webhook no painel está desatualizada ou a chave secreta está errada: veja [Runbook do Mercado Pago › URL do webhook no painel](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/runbook.md#url-do-webhook-no-painel) e [Cobrança presa](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/runbook.md#cobrança-presa).

## Falhas com compensação provocadas de fora

As duas falhas desta seção usam uma segunda OS, aberta com o veículo `DEF-5678` do mesmo cliente. Os passos sobrescrevem `workOrderId`, `quoteId` e `paymentId`.

### F2: estoque insuficiente na aprovação

O orçamento pede mais baterias do que o estoque tem. A reserva falha, e a Saga de aprovação compensa: desfaz a aprovação no Billing, que devolve o orçamento a `SENT`, e a OS continua aguardando aprovação.

Nesta OS, alguns testes das requisições da pasta Fluxo ponta a ponta falham, como deve ser: o do `E2E-08` espera a OS aprovada, e o do `E2E-09`, a reserva do filtro de óleo de `partSupplyId`. Confira pela resposta de cada requisição.

1. **Abrir a OS** com 100 baterias (o seed tem 15):

   ```http
   POST {{baseUrl}}/api/work-orders
   Authorization: Bearer {{authToken}}
   Content-Type: application/json

   {
     "customerId": "{{myCustomerId}}",
     "vehicleId": "89a190fc-770f-456b-ac45-9e6287accd5a",
     "problemDescription": "Troca de bateria",
     "services": [{ "serviceId": "c992d344-7f2b-45d4-b854-770734140531", "quantity": 1 }],
     "partsSupplies": [{ "partSupplyId": "be2df5a7-92bd-4f4b-b0d5-7953157c48f0", "quantity": 100 }]
   }
   ```

   **Postman:** o `E2E-03 — Abrir a OS com um serviço e uma peça` com este corpo, que grava o novo `workOrderId`.

   **Conferir:** **201**. Anote o `data.number`, que identifica os e-mails desta OS no MailHog.
2. **Diagnóstico e envio:** repita os passos 2 e 3 do fluxo completo (`E2E-04`, `E2E-05` e `E2E-06`); o `E2E-05` grava o novo `quoteId`. Nesta OS, o `totalAmount` do orçamento é 42080 com os preços do seed (R$ 80,00 da troca de bateria mais 100 × R$ 420,00 da bateria), e não 195. A OS fica `AWAITING_APPROVAL`, e o e-mail do orçamento chega ao MailHog.
3. **Aprovação pelo cliente:** repita o segundo pedido do passo 4 (`POST {{baseUrl}}/api/me/quotes/{{quoteId}}/decisions` com `"action": "approve"`, no `E2E-08`). **Conferir:** **200** com `data.status` `APPROVED`.
4. **Conferir a compensação:**
   - **espera:** `GET {{baseUrl}}/api/quotes/{{quoteId}}`, com o token do funcionário (Billing API › Orçamentos › `Detalhar o orçamento com os itens (200)`), até `data.status` voltar a `SENT`;
   - `GET {{baseUrl}}/api/work-orders/{{workOrderId}}` (`TC-WO-04`) continua em `AWAITING_APPROVAL`, e o histórico de status (`TC-WO-10`) registra `Aprovação do orçamento <quoteId> desfeita por falta de estoque`;
   - `GET {{baseUrl}}/api/stock-reservations?workOrderId={{workOrderId}}` (`E2E-09`) não tem reserva: a reserva é tudo ou nada;
   - **MailHog:** e-mail `Orçamento da Ordem de Serviço <número> - Estoque insuficiente`, dizendo que o orçamento voltou a aguardar aprovação;
   - **Datadog:** nos Logs, `stock.reservation_failed` no Inventory, `saga.compensation.started` no work-order (com `@oficina.saga.failure_reason:INSUFFICIENT_STOCK` e, em `@oficina.stock.reservation.missing_item_count`, quantos itens faltaram), `quote.approval_reverted` no Billing e `saga.compensated` no work-order. No dashboard **Sagas**, a Saga aparece como `compensated` em **Sagas finalizadas por tipo e resultado** e com o motivo em **Compensações por motivo**. O monitor **Sagas · Compensações da aprovação de orçamento** alerta só acima de uma compensação por hora, então esta não o dispara.

   Enquanto a compensação não termina, uma nova decisão do cliente responde **409** `Ordem de serviço com aprovação de orçamento em andamento: aguarde a conclusão e tente novamente`.
5. **Repor o estoque e aprovar de novo.** A entrada manual soma 100 ao estoque da bateria:

   ```http
   PATCH {{baseUrl}}/api/parts-supplies/be2df5a7-92bd-4f4b-b0d5-7953157c48f0
   Authorization: Bearer {{authToken}}
   Content-Type: application/json

   {
     "type": "ENTRY",
     "quantity": 100,
     "reason": "Reposição de estoque para a demonstração"
   }
   ```

   **Postman:** Inventory Service › Gestão de Peças e Insumos › `TC-PS-14 — Entrada de Peças e Insumos (ENTRY)`, trocando na URL o `{{partSupplyId}}` pelo id da bateria e, no corpo, a `quantity` por 100.

   **Conferir:** **200** com `data.stock` 100 unidades maior. Depois, repita a aprovação do item 3: a mesma Saga é reaberta, a reserva passa e a OS vai a `APPROVED`. A reserva das 100 baterias aparece em `GET {{baseUrl}}/api/stock-reservations?workOrderId={{workOrderId}}` (`E2E-09`). Nos Logs do Datadog, a Saga reaberta registra `saga.started` de novo e termina em `saga.completed`.

### F7: cobrança cancelada pelo funcionário

O funcionário cancela uma cobrança pendente antes de o cliente abrir o link. O Billing cancela a order no Mercado Pago, e a Saga de cobrança devolve a OS ao status de antes da cobrança. Use a OS da F2, já `APPROVED`.

1. **Cobrar:** a requisição do passo 6 do fluxo completo, o `E2E-10` com `"amount": 10`, que grava o novo `paymentId` e espera a OS em `AWAITING_PAYMENT`. **Conferir:** **201** com `data.status` `PENDING`. **MailHog:** o e-mail do link de pagamento.
2. **Cancelar:**

   ```http
   POST {{baseUrl}}/api/payments/{{paymentId}}/cancellations
   Authorization: Bearer {{authToken}}
   ```

   **Postman:** Billing API › Cobranças › `Cancelar a cobrança (200)`.

   **Conferir:** **200** com `data.status` `CANCELLED`.
3. **Conferir a compensação:**
   - **espera:** `GET {{baseUrl}}/api/work-orders/{{workOrderId}}` (`TC-WO-04`) até `data.status` voltar a `APPROVED`;
   - o histórico de status (`TC-WO-10`) registra `Cobrança <paymentId> cancelada`;
   - a OS aceita uma cobrança nova, porque não tem mais cobrança `PENDING`;
   - **Datadog:** nos Logs, `payment.cancelled` no Billing e `saga.compensated` no work-order, com `@oficina.saga.failure_reason:PAYMENT_CANCELLED`. No dashboard **Pagamentos**, a cobrança aparece em **Cobranças resolvidas por status** como `cancelled`.

## Outras falhas da matriz F1 a F14

A solução numera de F1 a F14 os cenários de falha das Sagas e da mensageria. Só a F2 e a F7 são provocadas de fora sem mexer na infraestrutura; as outras dependem de concorrência, de queda de um serviço ou de mensagem repetida, e são mostradas pelos testes automatizados: os unitários, que testam cada classe isolada, e os E2E (ponta a ponta), que sobem o serviço com banco e filas reais em containers e o exercitam por HTTP e por mensagem. A tabela [Cenários de falha F1 a F14](testing.md#cenários-de-falha-f1-a-f14) liga cada uma ao teste que a cobre, com o arquivo e o nome do teste.

| # | Cenário | Onde mostrar |
| --- | --- | --- |
| F1 | O orçamento deixou de estar `SENT` (decisão concorrente) | Teste E2E |
| F2 | Estoque insuficiente na reserva | Este manual e o cenário BDD `Falta de estoque devolve o orçamento e a reaprovação conclui a Saga` |
| F3 | OS cancelada entre a aprovação e o início da Saga | Teste E2E |
| F4 | Billing ou Inventory fora do ar na abertura da OS | Teste E2E |
| F5 | A gravação da OS falha depois de o orçamento ser criado | Teste E2E |
| F6 | A OS mudou de status antes de o pedido de cobrança chegar | Cenário BDD `Cobrança com a OS já em execução é cancelada` |
| F7 | Cobrança expirada, recusada ou cancelada pelo funcionário | Este manual (cancelamento) e o cenário BDD `Cobrança expirada devolve a OS ao status de origem` |
| F8 | O cliente pagou antes de o cancelamento da compensação chegar ao Mercado Pago | Testes unitários do work-order e do Billing |
| F9 | Mercado Pago fora do ar na criação da cobrança | Teste unitário do Billing |
| F10 | Participante fora do ar, com mensagens acumuladas na fila | Testes unitários e E2E da mensageria; depois de cinco entregas, a mensagem vai para a DLQ (a fila de mensagens que falharam) |
| F11 | Mensagem duplicada | Testes unitários das Sagas |
| F12 | O work-order reinicia no meio de uma Saga | Testes da mensageria com outbox (a tabela onde a mensagem é gravada na mesma transação do dado) |
| F13 | A baixa de estoque falha | Testes unitários do work-order e E2E do Inventory |
| F14 | O webhook do Mercado Pago não chega | Teste unitário do Billing; a volta da OS segue a F7 |

**Relatório do BDD.** BDD (Behavior-Driven Development) descreve os fluxos de negócio em cenários escritos em português, que rodam como teste. O relatório HTML fica no GitHub Actions deste repositório: abra a execução mais recente do workflow **CI** na `main`, baixe o artifact `bdd-report` (o arquivo que a execução do workflow guarda para download, na página dela) e abra o `cucumber-report.html`. Ele mostra os cinco cenários, cada um com os passos e o resultado:

- `OS da abertura à entrega com a cobrança total paga`, o fluxo completo;
- `Reserva confirmada aprova a OS`;
- `Falta de estoque devolve o orçamento e a reaprovação conclui a Saga` (F2);
- `Cobrança expirada devolve a OS ao status de origem` (F7);
- `Cobrança com a OS já em execução é cancelada` (F6).

Como o BDD roda e o que ele simula está em [Testes › BDD](testing.md#bdd-testes-de-aceitação).

## Deploy automatizado de um serviço

Esta seção leva uma mudança de um serviço até o deploy, passando pelos testes que a liberam. Os quatro serviços seguem o mesmo caminho; o exemplo usa o work-order, o único que roda os cenários BDD no CI. Os workflows estão descritos em [Infra · CI/CD](infra/ci-cd.md).

1. **Branch e mudança.** Crie a partir da `main` uma branch `feature/<nome>`: só as branches `feature/**` e `fix/**` disparam o CI. Uma mudança pequena basta, como um texto do README, porque o CD publica e implanta qualquer commit que entra na `main`.
2. **CI.** O push dispara o workflow **CI**, com os jobs em paralelo: **Lint**, **Unit Tests** (que falha com cobertura abaixo de 100%), **E2E Tests** (com PostgreSQL, Valkey e a mensageria reais em containers), **BDD**, **Build** e **DB Validation** (as migrations e o seed num banco descartável). Com todos verdes, o job **Open Pull Request** abre o Pull Request para a `main`.
3. **Pull Request.** No Pull Request rodam o **SAST**, a análise do SonarQube Cloud, que reprova quando o quality gate (os critérios de qualidade do projeto) falha, e o **DAST**, o OWASP ZAP contra a API em containers. A `main` é protegida: o merge só acontece pelo Pull Request, com as verificações obrigatórias verdes.
4. **CD.** O merge dispara o workflow **CD**, em quatro jobs encadeados: **Build and Push App Image** (a imagem vai ao Amazon ECR com o SHA do commit como tag), **Prepare Deployment Configuration** (as credenciais do banco e do cache, as chaves públicas dos tokens e o ConfigMap no Kubernetes), **DB Migrate & Seed** (o Job de migração do banco) e **App Deploy** (aplica os manifests, espera o rollout e chama `GET /health/work-order` pelo API Gateway; se o rollout ou essa chamada falhar, desfaz o deploy com `kubectl rollout undo`). O CD só roda com a variável `ENABLE_DEPLOY` do repositório em `true`.
5. **Conferir.**
   - a imagem nova no cluster: `kubectl get deployment work-order-service -n work-order -o jsonpath='{.spec.template.spec.containers[0].image}'` termina com o SHA do commit do merge;
   - `GET {{baseUrl}}/health/work-order`, sem token, responde **200**;
   - **Datadog:** os logs do `oficina-mecanica-work-order-service` passam a levar a tag `version` com o SHA da imagem nova.

## Documentos relacionados

- [Referência da API](api.md): as rotas do work-order e como o orçamento e a cobrança mudam a OS.
- [Ids canônicos do seed](seed-ids.md): os ids fixos dos usuários, clientes, veículos, serviços e peças.
- [Collection Postman do work-order](../collections/oficina-collection.json): as mesmas requisições, com os testes de cada resposta.
- [Runbook do Mercado Pago](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/runbook.md): contas de teste, URL do webhook, cartões de teste e cobrança presa.
- [Runbook da Sessão](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-base/blob/main/docs/runbook.md): subida e derrubada do ambiente.
- [Observabilidade](observability.md): os eventos de log, as métricas e os traces do work-order, e as [consultas no Datadog](observability.md#consultas-no-datadog) dos spans das filas e dos traces das Sagas.
- [Arquitetura › Mensagens da solução](architecture.md#mensagens-da-solução): quem publica e quem consome cada uma das 14 mensagens, na ordem em que aparecem na vida de uma OS.
- [Dashboards](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring/blob/main/docs/dashboards.md) e [Monitores](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring/blob/main/docs/monitors.md) do Datadog.
