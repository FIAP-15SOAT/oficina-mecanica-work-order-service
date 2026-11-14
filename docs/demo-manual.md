# 🎬 Manual de demonstração e teste ponta a ponta

> **Versão inicial.** Este manual foi escrito a partir das rotas dos serviços, das collections Postman e dos cenários BDD (os fluxos de negócio escritos como cenários em português, que rodam como teste automatizado). A execução completa dele no ambiente no ar ainda não foi feita: se um passo divergir, vale a resposta da API, e o manual deve ser corrigido.

Este manual leva quem não conhece a solução a executar, no ambiente no ar, a vida de uma ordem de serviço (OS) da abertura à entrega e as falhas com compensação que dá para provocar de fora. Cada passo traz a requisição pronta para o Postman ou o Insomnia, de onde vem cada id e o que conferir: a resposta HTTP, o status da OS, o status do orçamento ou da cobrança e o e-mail no MailHog.

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

### URL pública e variáveis

Todas as requisições passam pelo API Gateway. A URL dele muda a cada subida do ambiente:

```bash
# Ler a URL pública do API Gateway da solução
aws apigatewayv2 get-apis --query "Items[?Name=='apigw-oficina-mecanica'].ApiEndpoint | [0]" --output text
```

As requisições deste manual usam as variáveis do environment Postman do work-order, [`collections/oficina-environment.json`](../collections/oficina-environment.json). Importe-o no Postman ou no Insomnia e preencha `baseUrl` e `identityBaseUrl` com a URL do API Gateway (o gateway encaminha `/api/auth` ao Identity). As outras variáveis são preenchidas ao longo do manual:

| Variável | Valor |
| --- | --- |
| `authToken` | Token do funcionário, do login do funcionário |
| `customerJwtToken` | Token do cliente, do login do cliente |
| `workOrderId` | Id da OS, da resposta da abertura |
| `quoteId` | Id do orçamento, da lista de orçamentos da OS |
| `paymentId` | Id da cobrança, da resposta da criação da cobrança |
| `myCustomerId`, `myVehicleId`, `serviceId` e `partSupplyId` | Já vêm preenchidas com os ids do cliente, do veículo `ABC-1234`, da `Troca de óleo` e do `FILT-OL-001` |

O `checkoutId` da cobrança, o id da order dela no Mercado Pago, não é variável do environment: anote-o da resposta da criação da cobrança, para a simulação da notificação.

Para conferir que os quatro serviços respondem, chame sem token `GET {{baseUrl}}/health/work-order`, `/health/identity`, `/health/billing` e `/health/inventory`: cada uma responde **200**.

### URL do webhook no painel do Mercado Pago

O webhook é a notificação que o Mercado Pago envia ao Billing, em `POST /webhooks/mercadopago`, a cada mudança de uma cobrança. O Mercado Pago só a envia à URL cadastrada no painel da aplicação, e essa URL muda a cada subida do ambiente. **A cada sessão em que se demonstra pagamento**, cadastre `<URL do API Gateway>/webhooks/mercadopago` no painel, logado como a conta vendedora de teste, como em [Runbook do Mercado Pago › URL do webhook no painel](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/runbook.md#url-do-webhook-no-painel).

Antes de gravar, ensaie um pagamento inteiro no sandbox (o ambiente de teste do Mercado Pago, com contas e cartões fictícios). Sem pagamento a OS não é entregue: a entrega exige saldo zero, e só uma cobrança paga pelo Mercado Pago reduz o saldo.

### MailHog

O MailHog roda no cluster EKS (o Kubernetes gerenciado da AWS onde os serviços rodam), no namespace `platform` (o agrupamento de recursos do Kubernetes onde ficam os componentes de plataforma), e a página dele não é pública. Abra um túnel da máquina local até ele:

```bash
# Configurar o kubectl para o cluster da solução
aws eks update-kubeconfig --name eks-oficina-mecanica --region us-east-1

# Abrir um túnel da porta 8025 local até a página web do MailHog
kubectl port-forward -n platform svc/mailhog 8025:8025
```

Com o túnel aberto, a página fica em `http://localhost:8025`. Os e-mails do cliente do seed chegam para `joao.silva@email.com`.

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

**Conferir:** **200** com `data.accessToken`, `data.refreshToken` e `data.user.role` `ADMIN`. Grave `data.accessToken` em `authToken` e `data.refreshToken` em `refreshToken` (na collection, a requisição `TC-AUTH-01` grava os dois sozinha). Toda requisição de funcionário leva `Authorization: Bearer {{authToken}}`.

O token do funcionário vale 10 minutos. Quando uma requisição responder **401**, repita o login ou troque o refresh token por um par novo em `POST {{identityBaseUrl}}/api/auth/refresh`, com o corpo `{ "refreshToken": "{{refreshToken}}" }`.

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

**Conferir:** **200** com `data.accessToken` e `data.expiresIn` `3600` (uma hora). Grave `data.accessToken` em `customerJwtToken` (na collection, `TC-AUTH-06`). As rotas do cliente, em `/api/me/...`, levam `Authorization: Bearer {{customerJwtToken}}`. Credencial errada responde **401** com a mesma mensagem para qualquer causa.

## Fluxo completo, da abertura à entrega

O fluxo segue a OS por estes status: `RECEIVED` → `IN_DIAGNOSIS` → `AWAITING_APPROVAL` → `APPROVED` → `AWAITING_PAYMENT` → `APPROVED` → `IN_PROGRESS` → `COMPLETED` → `AWAITING_PAYMENT` → `COMPLETED` → `DELIVERED`. Ele usa duas cobranças, o sinal antes da execução e o restante depois dela. Se o tempo apertar, cobre o valor total no passo 6, pule o passo 10 e entregue a OS direto.

Vários passos mudam a OS por mensagem entre os serviços, segundos depois da resposta. Nesses passos, o manual diz o que consultar e o status esperado: repita a consulta a cada um ou dois segundos até o status aparecer (a collection espera até 15 segundos).

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

**Ids:** `myCustomerId` e `myVehicleId` são o cliente e o veículo `ABC-1234` do seed; `serviceId` é a `Troca de óleo` e `partSupplyId`, o `FILT-OL-001`.

**Conferir:** **201** com `data.status` `RECEIVED`. Grave `data.id` em `workOrderId` e anote `data.number`, o número da OS que aparece nos e-mails.

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

**Conferir:** **200** com `data.status` `IN_DIAGNOSIS`.

### 3. Enviar o orçamento ao cliente

Primeiro, pegue o id do orçamento inicial na lista de orçamentos da OS, que fica no Billing:

```http
GET {{baseUrl}}/api/work-orders/{{workOrderId}}/quotes
Authorization: Bearer {{authToken}}
```

**Conferir:** **200** com um orçamento em `data`, `status` `PENDING` e `totalAmount` 195 com os preços do seed (150,00 do serviço mais 45,00 da peça). Grave `data[0].id` em `quoteId`.

Depois, envie o orçamento:

```http
POST {{baseUrl}}/api/quotes/{{quoteId}}/submissions
Authorization: Bearer {{authToken}}
```

**Conferir:**

- **200** com `data.status` `SENT`;
- **espera:** `GET {{baseUrl}}/api/work-orders/{{workOrderId}}` até `data.status` `AWAITING_APPROVAL`;
- **MailHog:** e-mail para `joao.silva@email.com` com o assunto `Orçamento para Ordem de Serviço <número> - Aguardando sua aprovação`, os itens e o valor total.

### 4. O cliente consulta e aprova o orçamento

Para a gravação, faça aqui o [login do cliente](#login-do-cliente) e grave o token em `customerJwtToken`. Com o token do cliente, mostre o orçamento com os itens:

```http
GET {{baseUrl}}/api/me/quotes/{{quoteId}}
Authorization: Bearer {{customerJwtToken}}
```

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

**Conferir:** **200** com `data.status` `APPROVED`. A aprovação começa a Saga de aprovação: o work-order pede ao Inventory a reserva da peça e só aprova a OS quando a reserva é confirmada.

### 5. Conferir a OS aprovada e a reserva do estoque

- **Espera:** `GET {{baseUrl}}/api/work-orders/{{workOrderId}}` até `data.status` `APPROVED`.
- **Reserva no Inventory:** `GET {{baseUrl}}/api/stock-reservations?workOrderId={{workOrderId}}`, com o token do funcionário, responde **200** com uma reserva do `FILT-OL-001`, `quantity` 1. Em `GET {{baseUrl}}/api/parts-supplies/{{partSupplyId}}`, o `reservedStock` da peça subiu 1; o disponível é `stock - reservedStock`.

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

**Conferir:**

- **201** com `data.status` `PENDING`, `data.checkoutUrl` (o link de pagamento no Checkout Pro, a página de pagamento hospedada pelo Mercado Pago) e `data.checkoutId` (o id da order, a ordem de pagamento no Mercado Pago, que começa com `ORDTST` no sandbox). Grave `data.id` em `paymentId` e anote o `data.checkoutId`;
- **espera:** `GET {{baseUrl}}/api/work-orders/{{workOrderId}}` até `data.status` `AWAITING_PAYMENT`. Com a OS nesse status, iniciar serviço, entregar e cancelar respondem **409**;
- **MailHog:** e-mail `Pagamento da Ordem de Serviço <número>`, com o valor, o link **Pagar agora** e a validade. O cliente também vê a cobrança, com o link, em `GET {{baseUrl}}/api/me/work-orders/{{workOrderId}}/payments`.

### 7. Pagar o sinal

Pague a cobrança e simule a notificação como em [Pagamento no sandbox do Mercado Pago](#pagamento-no-sandbox-do-mercado-pago).

**Conferir:**

- `GET {{baseUrl}}/api/payments/{{paymentId}}` responde **200** com `data.status` `APPROVED`;
- **espera:** `GET {{baseUrl}}/api/work-orders/{{workOrderId}}` até `data.status` `APPROVED`, o status de antes da cobrança;
- `GET {{baseUrl}}/api/work-orders/{{workOrderId}}/status-history` mostra as entradas `Aguardando o pagamento da cobrança <paymentId>` e `Cobrança <paymentId> paga`.

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

**Conferir:**

- **200** com o serviço `IN_PROGRESS`; `GET {{baseUrl}}/api/work-orders/{{workOrderId}}` mostra a OS em `IN_PROGRESS`;
- **baixa no Inventory (espera):** `GET {{baseUrl}}/api/stock-movements?workOrderId={{workOrderId}}&type=EXIT` até aparecer uma movimentação `EXIT` do `FILT-OL-001`, `quantity` 1, com o motivo `Saída por Ordem de Serviço <workOrderId>`. A reserva some de `GET {{baseUrl}}/api/stock-reservations?workOrderId={{workOrderId}}`.

### 9. Concluir o serviço

```http
PATCH {{baseUrl}}/api/work-orders/{{workOrderId}}/services/{{serviceId}}
Authorization: Bearer {{authToken}}
Content-Type: application/json

{
  "status": "COMPLETED"
}
```

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

**Conferir:** **409** com `Ordem de serviço com saldo a pagar de R$ <saldo>: a entrega é liberada depois que o saldo for quitado` (R$ 145.00 com os valores deste manual). A OS segue em `COMPLETED`.

Cobre o saldo com a mesma requisição do passo 6, com `amount` igual ao saldo da mensagem, como número e sem aspas (`"amount": 145.00`; o valor entre aspas responde **400**), grave o novo `data.id` em `paymentId` e repita o passo 7. Desta vez, a OS vai de `COMPLETED` a `AWAITING_PAYMENT` e volta a `COMPLETED` depois do pagamento.

### 11. Entregar a OS

Repita a entrega do passo 10.

**Conferir:**

- **200** com `data.status` `DELIVERED`;
- `GET {{baseUrl}}/api/work-orders/{{workOrderId}}/status-history` mostra a vida inteira da OS, de `RECEIVED` a `DELIVERED`, com as duas passagens por `AWAITING_PAYMENT`.

## Pagamento no sandbox do Mercado Pago

O sandbox usa duas contas de teste: a vendedora, dona da aplicação que o Billing usa, e a compradora, que paga. As credenciais das duas ficam em **Suas integrações → Contas de teste**, na conta real do grupo no Mercado Pago ([Runbook do Mercado Pago › Contas de teste](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/runbook.md#contas-de-teste)).

1. **Pagar.** Numa janela anônima, abra o `checkoutUrl` da cobrança (da resposta da criação ou do e-mail no MailHog), entre com a conta compradora de teste e pague com o cartão Mastercard de teste `5480 8328 0103 3311`, código de segurança `123`, vencimento `11/30`, nome do titular `APRO` (que faz o Mercado Pago aprovar) e CPF `12345678909`.
2. **Simular a notificação.** Um pagamento de teste não dispara o webhook sozinho. Numa janela logada como a conta vendedora de teste, abra **Suas integrações → aplicação → Configuração de webhooks**, clique em **Simular notificação**, escolha o evento **Order (Mercado Pago)**, preencha o **Data ID** com o `checkoutId` da cobrança e envie. O Mercado Pago manda a notificação assinada à URL cadastrada, e o Billing consulta a order e encerra a cobrança pelo status real dela.
3. **Conferir.** `GET {{baseUrl}}/api/payments/{{paymentId}}` responde `data.status` `APPROVED`, e a OS volta ao status de antes da cobrança.

Se a cobrança continuar `PENDING` depois da simulação, a URL do webhook no painel está desatualizada ou a chave secreta está errada: veja [Runbook do Mercado Pago › URL do webhook no painel](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/runbook.md#url-do-webhook-no-painel) e [Cobrança presa](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/runbook.md#cobrança-presa).

## Falhas com compensação provocadas de fora

As duas falhas desta seção usam uma segunda OS, aberta com o veículo `DEF-5678` do mesmo cliente. Os passos sobrescrevem `workOrderId`, `quoteId` e `paymentId`.

### F2: estoque insuficiente na aprovação

O orçamento pede mais baterias do que o estoque tem. A reserva falha, e a Saga de aprovação compensa: desfaz a aprovação no Billing, que devolve o orçamento a `SENT`, e a OS continua aguardando aprovação.

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

   **Conferir:** **201**. Grave `data.id` em `workOrderId` e anote o `data.number`, que identifica os e-mails desta OS no MailHog.
2. **Diagnóstico e envio:** repita os passos 2 e 3 do fluxo completo, gravando o novo `quoteId`. Nesta OS, o `totalAmount` do orçamento é 42080 com os preços do seed (R$ 80,00 da troca de bateria mais 100 × R$ 420,00 da bateria), e não 195. A OS fica `AWAITING_APPROVAL`, e o e-mail do orçamento chega ao MailHog.
3. **Aprovação pelo cliente:** repita o segundo pedido do passo 4 (`POST {{baseUrl}}/api/me/quotes/{{quoteId}}/decisions` com `"action": "approve"`). **Conferir:** **200** com `data.status` `APPROVED`.
4. **Conferir a compensação:**
   - **espera:** `GET {{baseUrl}}/api/quotes/{{quoteId}}`, com o token do funcionário, até `data.status` voltar a `SENT`;
   - `GET {{baseUrl}}/api/work-orders/{{workOrderId}}` continua em `AWAITING_APPROVAL`, e o histórico de status (`GET {{baseUrl}}/api/work-orders/{{workOrderId}}/status-history`) registra `Aprovação do orçamento <quoteId> desfeita por falta de estoque`;
   - `GET {{baseUrl}}/api/stock-reservations?workOrderId={{workOrderId}}` não tem reserva: a reserva é tudo ou nada;
   - **MailHog:** e-mail `Orçamento da Ordem de Serviço <número> - Estoque insuficiente`, dizendo que o orçamento voltou a aguardar aprovação.

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

   **Conferir:** **200** com `data.stock` 100 unidades maior. Depois, repita a aprovação do item 3: a mesma Saga é reaberta, a reserva passa e a OS vai a `APPROVED` (espera em `GET {{baseUrl}}/api/work-orders/{{workOrderId}}`). A reserva das 100 baterias aparece em `GET {{baseUrl}}/api/stock-reservations?workOrderId={{workOrderId}}`.

### F7: cobrança cancelada pelo funcionário

O funcionário cancela uma cobrança pendente antes de o cliente abrir o link. O Billing cancela a order no Mercado Pago, e a Saga de cobrança devolve a OS ao status de antes da cobrança. Use a OS da F2, já `APPROVED`.

1. **Cobrar:** a requisição do passo 6 do fluxo completo, com `"amount": 10`. **Conferir:** **201** com `data.status` `PENDING`; grave `data.id` em `paymentId`. **Espera:** a OS em `AWAITING_PAYMENT`. **MailHog:** o e-mail do link de pagamento.
2. **Cancelar:**

   ```http
   POST {{baseUrl}}/api/payments/{{paymentId}}/cancellations
   Authorization: Bearer {{authToken}}
   ```

   **Conferir:** **200** com `data.status` `CANCELLED`.
3. **Conferir a compensação:**
   - **espera:** `GET {{baseUrl}}/api/work-orders/{{workOrderId}}` até `data.status` voltar a `APPROVED`;
   - o histórico de status registra `Cobrança <paymentId> cancelada`;
   - a OS aceita uma cobrança nova, porque não tem mais cobrança `PENDING`.

## Outras falhas da matriz F1 a F14

A solução numera de F1 a F14 os cenários de falha das Sagas e da mensageria. Só a F2 e a F7 são provocadas de fora sem mexer na infraestrutura; as outras dependem de concorrência, de queda de um serviço ou de mensagem repetida, e são mostradas pelos testes automatizados: os unitários, que testam cada classe isolada, e os E2E (ponta a ponta), que sobem o serviço com banco e filas reais em containers e o exercitam por HTTP e por mensagem. A tabela [Cenários de falha F1 a F14](testing.md#cenários-de-falha-f1-a-f14) liga cada uma ao teste que a cobre, com o arquivo e o nome do teste.

| # | Cenário | Onde mostrar |
| --- | --- | --- |
| F1 | O orçamento deixou de estar `SENT` (decisão concorrente) | Teste E2E |
| F2 | Estoque insuficiente na reserva | Esta demonstração e o cenário BDD `Falta de estoque devolve o orçamento e a reaprovação conclui a Saga` |
| F3 | OS cancelada entre a aprovação e o início da Saga | Teste E2E |
| F4 | Billing ou Inventory fora do ar na abertura da OS | Teste E2E |
| F5 | A gravação da OS falha depois de o orçamento ser criado | Teste E2E |
| F6 | A OS mudou de status antes de o pedido de cobrança chegar | Cenário BDD `Cobrança com a OS já em execução é cancelada` |
| F7 | Cobrança expirada, recusada ou cancelada pelo funcionário | Esta demonstração (cancelamento) e o cenário BDD `Cobrança expirada devolve a OS ao status de origem` |
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

## Documentos relacionados

- [Referência da API](api.md): as rotas do work-order e como o orçamento e a cobrança mudam a OS.
- [Ids canônicos do seed](seed-ids.md): os ids fixos dos usuários, clientes, veículos, serviços e peças.
- [Collection Postman do work-order](../collections/oficina-collection.json): as mesmas requisições, com os testes de cada resposta.
- [Runbook do Mercado Pago](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/runbook.md): contas de teste, URL do webhook, cartões de teste e cobrança presa.
- [Runbook da Sessão](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-base/blob/main/docs/runbook.md): subida e derrubada do ambiente.
