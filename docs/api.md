# 🔌 Referência da API

> A fonte viva do contrato é o **Swagger** em `http://localhost:3000/api/docs` (spec em `/api/docs-json`). Esta página é o resumo legível dos endpoints.

## Índice

- [Endpoints disponíveis](#endpoints-disponíveis)
- [Rotas internas (`/internal`)](#rotas-internas-internal)
- [Dados de exibição dos itens](#dados-de-exibição-dos-itens)
- [Formato de resposta](#formato-de-resposta)
  - [Exceção: as rotas de saúde](#exceção-as-rotas-de-saúde)

Após iniciar a aplicação:

- **Swagger:** `http://localhost:3000/api/docs`
- **Base URL:** `http://localhost:3000/api`

Toda rota exige o header `Authorization: Bearer <token>` (access token), salvo as marcadas como públicas. A autenticação é negada por padrão: um guard global exige o token de funcionário em toda rota sem marcação, `@Public()` dispensa o token e `@CustomerArea()` troca o token exigido pelo do Cliente da Oficina (ver [Perfis de usuário (RBAC)](architecture.md#perfis-de-usuário-rbac)). Tokens de funcionário são obtidos em `POST /auth/login` e renovados em `POST /auth/refresh`. Um token de cliente numa rota de funcionário responde **401**.

## Endpoints disponíveis

---

**Auth** (`/api/auth`)

| Método | Rota | Descrição | Acesso |
|---|---|---|---|
| POST | `/login` | Autenticar e obter tokens (access + refresh) | Público |
| POST | `/refresh` | Renovar tokens com refresh token | Público |
| POST | `/password-reset-confirmations` | Confirmar redefinição de senha com código numérico de 6 dígitos (`email`, `code`, `newPassword`) emitido por um Admin — ver `POST /users/:userId/password-resets` | Público |

> `GET /me` (ver seção **Minha Conta** abaixo) aceita tanto o token interno (`jwt`) quanto o externo (`customer-jwt`) e devolve a identidade do sujeito autenticado independentemente do fluxo.

> O access token de funcionário é um JWT **RS256** com `kid` no cabeçalho e as claims `sub`, `email`, `name`, `role`, `typ = access`, `iss = oficina-identity`, `aud = oficina-services`, `iat` e `exp`, válido por **10 minutos**. O refresh token é RS256 com chave própria, `typ = refresh` e `aud = oficina-identity`, e vale **7 dias**. Uma rota de funcionário responde **401** a um token HS256 ou sem assinatura, sem `kid` ou com outro `kid`, assinado por outra chave, com `iss` ou `aud` diferentes (como o token de cliente), com `typ` diferente de `access` (como o refresh), expirado ou sem `exp`, ou de um usuário desativado ou que trocou a senha depois da emissão.

> `POST /auth/refresh` responde **401** com a mensagem única `Refresh token inválido ou expirado` para todas as causas de falha — token inválido ou expirado, usuário inexistente e usuário desativado. A resposta é deliberadamente idêntica nos três casos para não revelar se o usuário existe; a causa fica registrada apenas no log (ver [Segurança](security.md#proteção-de-dados-nos-logs)).

> `POST /auth/password-reset-confirmations` responde **401** com a mensagem única `Código de redefinição inválido ou expirado` para todas as causas de falha — usuário inexistente, nenhum código emitido, código expirado (10 minutos), código esgotado (5 tentativas) ou código incorreto —, pelo mesmo motivo de não revelar a causa exata.

---

**Usuários** (`/api/users`) — *ADMIN*

| Método | Rota | Descrição | Perfis |
|---|---|---|---|
| POST | `/` | Criar usuário (`name`, `email`, `role`, `cpf` opcional) — **não recebe senha**: uma senha aleatória forte é gerada e enviada por e-mail ao usuário | ADMIN |
| GET | `/` | Listar (paginado; filtros: `name`, `role`) | ADMIN |
| GET | `/:id` | Buscar por ID | ADMIN |
| PUT | `/:id` | Atualizar dados (também sem campo de senha) | ADMIN |
| PATCH | `/:id` | Alterar status (ativo/inativo) via `{ active: boolean }` | ADMIN |
| DELETE | `/:id` | Remover | ADMIN |
| POST | `/:userId/password-resets` | Emitir código numérico de 6 dígitos para redefinição de senha, enviado por e-mail ao usuário (válido por 10 minutos, 5 tentativas) — confirmado em `POST /auth/password-reset-confirmations` | ADMIN |

> A força mínima da senha é definida em `domain/constants/regex/password.regex.ts` e validada **na camada de domínio** (`User.validatePasswordStrength`). Isso vale tanto para a senha inicial gerada em `POST /users` quanto para a nova senha em `PATCH /me/password` e `POST /auth/password-reset-confirmations`.

---

**Métricas de Serviços** (`/api/services/:id/metrics`, `/api/services-metrics`) — *ADMIN*

| Método | Rota | Descrição | Perfis |
|---|---|---|---|
| GET | `/api/services/:id/metrics` | Métricas de um serviço: execuções concluídas e tempo médio em minutos. `404` quando o Inventory não conhece o serviço | ADMIN |
| GET | `/api/services-metrics` | Métricas dos serviços já executados (paginado), ordenadas pelo nome | ADMIN |

> As métricas contam os itens de OS concluídos, com início e fim registrados (`work_order_services` com status `COMPLETED`), e o nome do serviço (`serviceName`) é lido no Inventory a cada requisição. A lista traz só os serviços já executados; um serviço que o Inventory não acha mais aparece com `serviceName` nulo, no fim da lista. Na rota de um serviço, `averageTimeMinutes` sai `0`, não nulo, quando ele ainda não tem execução concluída. Com o Inventory fora do ar, as duas rotas respondem **503**.

> **Catálogo e estoque ficam no Inventory.** O cadastro de serviços (`/api/services`), de peças e insumos (`/api/parts-supplies`) e as consultas de estoque (`/api/stock-movements`, `/api/stock-reservations`) são do Inventory, o serviço da solução dono do catálogo e do estoque ([`oficina-mecanica-inventory-service`](https://github.com/FIAP-15SOAT/oficina-mecanica-inventory-service)). Pelo API Gateway, essas rotas chegam ao Inventory; só as duas rotas de métricas acima chegam a este serviço. As OS guardam de cada item só o id, a quantidade e o preço, e leem os dados de exibição no Inventory a cada leitura (ver [Dados de exibição dos itens](#dados-de-exibição-dos-itens)).

---

**Clientes** (`/api/customers`) — *ADMIN, ATTENDANT*

| Método | Rota | Descrição | Perfis |
|---|---|---|---|
| POST | `/` | Cadastrar cliente (CPF ou CNPJ, endereço obrigatório). Aceita `createAccess?: boolean` — concede acesso externo automaticamente reaproveitando o caso de uso de `POST /customers/:id/users`. Default: `true` para `INDIVIDUAL`, sempre `false` para `COMPANY` (`createAccess: true` com `COMPANY` é rejeitado com **409**) | ADMIN, ATTENDANT |
| GET | `/` | Listar (paginado; filtros: `name`, `type`, `document`) | ADMIN, ATTENDANT |
| GET | `/:id` | Buscar por ID | ADMIN, ATTENDANT |
| GET | `/:id/vehicles` | Listar veículos do cliente | ADMIN, ATTENDANT |
| PUT | `/:id` | Atualizar dados (incluindo endereço) | ADMIN, ATTENDANT |
| DELETE | `/:id` | Remover (bloqueado se houver veículos vinculados) | ADMIN, ATTENDANT |

---

**Acesso Externo de Clientes** (`/api/customers/:customerId/users`, `/api/users/:userId/customers`) — *ADMIN, ATTENDANT*

| Método | Rota | Descrição | Perfis |
|---|---|---|---|
| POST | `/customers/:customerId/users` | Conceder acesso externo a um cliente. Para `Customer.type = INDIVIDUAL`, vincula o próprio cliente (usa CPF/e-mail do cadastro); para `COMPANY`, exige `name` + `email` + `cpf` do operador que vai representar a empresa. Se o CPF já pertence a um `User` existente, **reaproveita** essa conta (mesma pessoa física) e só cria o vínculo — sem senha inicial, sem alterar nome/e-mail/role da conta; caso contrário, cria um `User` novo e envia a senha inicial por e-mail. Se o e-mail já pertencer a **outro** usuário (interno ou externo) que não é o dono do CPF informado, retorna **409** — ver [ADR 0004](adr/0004-autenticacao-de-clientes.md) | ADMIN, ATTENDANT |
| GET | `/customers/:customerId/users` | Listar usuários com acesso a um cliente | ADMIN, ATTENDANT |
| DELETE | `/customers/:customerId/users/:userId` | Revogar o vínculo de um usuário com um cliente — efeito imediato, sem lista de revogação de token | ADMIN, ATTENDANT |
| PATCH | `/customers/:customerId` | Ativar (`isActive: true`) ou desativar (`isActive: false`) um cliente. Cliente inativo perde acesso a `/api/me/*` imediatamente | ADMIN, ATTENDANT |
| GET | `/users/:userId/customers` | Listar os clientes vinculados a um usuário | ADMIN, ATTENDANT |

> Ver [Identidade externa, autenticação e autorização por vínculo](architecture.md#identidade-externa-autenticação-e-autorização-por-vínculo) para o modelo `User`/`Customer`/`UserCustomer`.

---

**Veículos** (`/api/vehicles`) — *ADMIN, ATTENDANT*

| Método | Rota | Descrição | Perfis |
|---|---|---|---|
| POST | `/` | Cadastrar veículo (placa `ABC-1234` ou Mercosul `ABC1D23`) | ADMIN, ATTENDANT |
| GET | `/` | Listar (paginado; filtros: `plate`, `brand`, `customerId`) | ADMIN, ATTENDANT |
| GET | `/:id` | Buscar por ID (retorna cliente aninhado) | ADMIN, ATTENDANT |
| PUT | `/:id` | Atualizar dados (placa normalizada para maiúsculas e sem hífen) | ADMIN, ATTENDANT |
| DELETE | `/:id` | Remover (bloqueado se houver ordens de serviço vinculadas) | ADMIN, ATTENDANT |

---

**Ordens de Serviço** (`/api/work-orders`) — *ADMIN, MECHANIC, ATTENDANT*

| Método | Rota | Descrição | Perfis |
|---|---|---|---|
| POST | `/` | Criar nova OS (`userId` extraído do JWT, número gerado por sequence). Aceita opcionalmente `services` e `partsSupplies`: com algum item, o orçamento inicial `PENDING` é criado no Billing antes de gravar a OS (ver [Abertura da OS com orçamento inicial](#abertura-da-os-com-orçamento-inicial)) | ADMIN, ATTENDANT |
| GET | `/` | Listar (paginado; filtros: `number`, `status`, `customerId`, `vehicleId`, `assignedUserId`; ordenação: `sort`). **Por padrão, ordens em `COMPLETED`, `DELIVERED` e `CANCELLED` são omitidas**; use `?status=X` para recuperá-las. | ADMIN, MECHANIC, ATTENDANT |
| GET | `/:id` | Buscar por ID (retorna serviços e peças/insumos da OS, com os dados de exibição lidos no Inventory) | ADMIN, MECHANIC, ATTENDANT |
| PUT | `/:id` | Atualizar OS (apenas em `RECEIVED` / `IN_DIAGNOSIS`; `userId` extraído do JWT) | ADMIN, MECHANIC, ATTENDANT |
| PATCH | `/:id` | Atualizar status da OS (apenas `IN_DIAGNOSIS`, `CANCELLED`, `DELIVERED`). O cancelamento responde **409** enquanto a aprovação de um orçamento está em andamento (ver [Como o orçamento muda a OS](#como-o-orçamento-muda-a-os)) | ADMIN, MECHANIC, ATTENDANT |
| PATCH | `/:workOrderId/services/:serviceId` | Atualizar status de um serviço da OS (`IN_PROGRESS` / `COMPLETED`). O primeiro serviço iniciado leva a OS a `IN_PROGRESS` e, se ela tem peças, pede ao Inventory a baixa do estoque reservado | ADMIN, MECHANIC, ATTENDANT |
| GET | `/:id/status-history` | Histórico de mudanças de status | ADMIN, MECHANIC, ATTENDANT |

> Demais transições (`AWAITING_APPROVAL`, `APPROVED`, `REJECTED`, `IN_PROGRESS`, `COMPLETED`) são derivadas automaticamente das mensagens de orçamento publicadas pelo Billing e dos status de serviço — veja [Ciclo de vida da Ordem de Serviço](./architecture.md#ciclo-de-vida-da-ordem-de-serviço).

> **Ordenação (`sort`)**: critérios no formato `campo:direção` separados por vírgula (ex.: `?sort=status:desc,createdAt:asc`). Campos permitidos: `status` e `createdAt`; direção `asc` ou `desc`. Padrão: `status:desc,createdAt:asc`. Ao ordenar por `status`, usa-se a **prioridade de negócio** da tabela `WorkOrderStatusInfo` (`RECEIVED` → … → `CANCELLED`), não a ordem alfabética.

---

**Orçamentos** — no Billing

Os orçamentos são do **Billing**, o serviço da solução dono dos orçamentos e dos pagamentos ([`oficina-mecanica-billing-service`](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service)). Este serviço não guarda orçamento: pelo API Gateway, `/api/quotes` (criação, itens, envio, aprovação e rejeição pelo funcionário) e `GET /api/work-orders/:id/quotes` (orçamentos de uma OS) chegam ao Billing, e a referência dessas rotas está na [API do Billing](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/api.md). Este serviço abre a OS com o orçamento inicial, serve a área do cliente (ver **Minha Conta** abaixo) e reage às mensagens que o Billing publica quando um orçamento muda de status.

#### Abertura da OS com orçamento inicial

Com algum item em `services` ou `partsSupplies`, `POST /api/work-orders` valida cliente, veículo e mecânico, cria o orçamento inicial no Billing (`POST /internal/quotes`) e só então grava a OS. O Billing valida e precifica os itens no Inventory, e a recusa dele volta como está, sem nada gravado aqui e sem consumir número de OS:

| Situação | Resposta |
|---|---|
| Peças sem nenhum serviço, ou item repetido | **409** do Billing |
| Id de serviço ou peça que o Inventory não conhece | **404** do Billing |
| Billing ou Inventory fora do ar, ou sem resposta em 5 s | **503** |
| Falha ao gravar a OS depois de o orçamento ser criado | O orçamento é apagado no Billing (`DELETE /internal/quotes/:id`) e o erro da gravação volta ao chamador; se a exclusão também falhar, o orçamento sem OS fica só registrado no log (`work_order.opening.compensation_failed`) |

Sem itens, a OS é aberta sem orçamento e sem chamar o Billing.

#### Como o orçamento muda a OS

| O que acontece no Billing | Efeito na OS |
|---|---|
| Orçamento enviado ao cliente | A OS vai de `IN_DIAGNOSIS` ou `REJECTED` a `AWAITING_APPROVAL` (se já aguarda, fica) e o cliente recebe o e-mail com os itens e o total. A rota de envio no Billing não espera o e-mail: uma falha no envio do e-mail não desfaz o envio do orçamento nem responde 503. Uma OS cancelada antes de a mensagem chegar não muda, e nenhum e-mail sai |
| Orçamento rejeitado | A OS vai a `REJECTED` só quando nenhum outro orçamento dela continua enviado; havendo, ela segue em `AWAITING_APPROVAL` |
| Orçamento aprovado | Começa a aprovação descrita abaixo |

**Aprovação e reserva de estoque.** A aprovação (pelo funcionário, no Billing, ou pela decisão do cliente em `POST /me/quotes/:quoteId/decisions`) responde **200** com o orçamento `APPROVED`, e a OS muda segundos depois, quando chega a mensagem do Billing. Sem peças, a OS vai a `APPROVED` com os itens do orçamento. Com peças, a OS continua `AWAITING_APPROVAL` até o Inventory confirmar a reserva do estoque; confirmada a reserva, a OS vai a `APPROVED` com os itens e o total do orçamento. Se falta estoque, a aprovação é desfeita no Billing: o orçamento volta a `SENT`, os orçamentos rejeitados por ela voltam ao status anterior, o histórico da OS registra `Aprovação do orçamento <id> desfeita por falta de estoque` e o cliente recebe um e-mail avisando que o orçamento voltou a aguardar aprovação e pode ser aprovado de novo quando o estoque for reposto. Se a OS foi cancelada entre a aprovação e a chegada da mensagem, o orçamento vai a `REJECTED` e o histórico registra `Aprovação do orçamento <id> desfeita: a Ordem de Serviço não aguardava aprovação`, sem e-mail.

Enquanto a aprovação está em andamento (reserva do estoque ou reversão no Billing), cancelar a OS e decidir um orçamento pela área do cliente respondem **409** `Ordem de serviço com aprovação de orçamento em andamento: aguarde a conclusão e tente novamente`. Criar, enviar ou aprovar outro orçamento da mesma OS é recusado pelo Billing (**409**), porque a OS já tem um orçamento aprovado. O fluxo completo está em [Fluxo do orçamento, do envio à aprovação](architecture.md#fluxo-do-orçamento-do-envio-à-aprovação).

---

**Health** (`/api/health`)

| Método | Rota | Descrição | Acesso |
|---|---|---|---|
| GET | `/live` | Vivacidade — não executa I/O algum. Alvo do `startupProbe` e do `livenessProbe` | Público |
| GET | `/ready` | Prontidão — verifica o PostgreSQL (`SELECT 1`, com prazo próprio) e o estado de encerramento. Alvo do `readinessProbe` | Público |

> **Estas duas rotas não usam o envelope `{ data }`** — é a única divergência deliberada do formato descrito abaixo. Ver [Formato de resposta › Exceção](#exceção-as-rotas-de-saúde).
>
> A decisão é comunicada pelo **status HTTP**: `200` saudável, `503` indisponível. O corpo é mínimo e **idêntico para toda causa de falha** — `{"status":"ok"}` ou `{"status":"unavailable"}` —, e ambos respondem com `Cache-Control: no-store`. Um consumidor decide lendo apenas o status; ignorar o corpo não altera o resultado.
>
> São **públicas por requisito**: um orquestrador não porta credencial de aplicação, e condicionar as probes a um token tornaria a saúde indisponível justamente quando a autenticação estiver comprometida. O Service é `NodePort`, sem Ingress público, e o único caminho externo é API Gateway → VPC Link → NLB interno → NodePort. Como o Gateway publica `ANY /api/{proxy+}`, a proteção dessas rotas é o corpo mínimo e sem detalhes operacionais, não uma credencial. Detalhes da postura em [Segurança](security.md#endpoints-de-saúde-públicos-e-não-autenticados).
>
> `/live` **não tem** o desfecho `503`: ele não verifica dependência alguma. Com o banco fora, `/live` continua `200` e só `/ready` responde `503` — a instância está viva, apenas não consegue atender. Como o PostgreSQL é **compartilhado por todas as réplicas**, uma indisponibilidade dele deixa o Service sem endpoints em vez de desviar tráfego; isso é comportamento esperado, não defeito. O valor da readiness está na falha **por-réplica** (pool travado numa instância) e no encerramento gracioso.

---

**Minha Conta** (`/api/me`) — Cliente da Oficina (usuário externo)

| Método | Rota | Descrição | Acesso |
|---|---|---|---|
| GET | `/` | Identidade do sujeito autenticado — funciona com token interno **ou** externo. `customers` lista só as empresas (`COMPANY`) que o usuário representa; fica vazio para quem só acessa o próprio cadastro pessoa física (o cadastro `INDIVIDUAL` não aparece ali por ser o próprio usuário, não alguém que ele representa) | JWT interno OU `customer-jwt` |
| PATCH | `/password` | Trocar a própria senha (`currentPassword`, `newPassword`) — funciona com token interno **ou** externo | JWT interno OU `customer-jwt` |
| GET | `/work-orders` | Listar ordens de serviço dos clientes vinculados ao usuário autenticado (paginado; filtro opcional `customerId`). Cada item traz `customer: { id, name, type }` — necessário para quem representa mais de uma empresa distinguir a qual cliente cada ordem pertence | `customer-jwt` |
| GET | `/work-orders/:workOrderId` | Detalhe de uma ordem de serviço vinculada, incluindo `customer: { id, name, type }` | `customer-jwt` |
| GET | `/work-orders/:workOrderId/quotes` | Orçamentos de uma ordem de serviço vinculada, sem itens, lidos no Billing | `customer-jwt` |
| GET | `/quotes/:quoteId` | Orçamento e itens de uma ordem vinculada, lidos no Billing | `customer-jwt` |
| POST | `/quotes/:quoteId/decisions` | Aprovar (`{ "action": "approve" }`) ou rejeitar (`{ "action": "reject", "reason": "..." }`) um orçamento vinculado; a decisão é repassada ao Billing | `customer-jwt` |

> O token `customer-jwt` (RS256) é emitido por uma **função serverless externa** a esta aplicação, após autenticar o Cliente da Oficina por CPF + senha — a API só verifica a assinatura com `CUSTOMER_JWT_PUBLIC_KEY`. Toda rota `/api/me/*` que aponta a um recurso específico (`workOrderId`/`quoteId`) resolve a autorização **por vínculo** a cada requisição, consultando `UserCustomer` no banco — o token nunca carrega `customerId`. Um recurso inexistente e um recurso de um cliente não vinculado respondem igualmente **404** (nunca 403), para não virar oráculo de enumeração. Ver [Identidade externa, autenticação e autorização por vínculo](architecture.md#identidade-externa-autenticação-e-autorização-por-vínculo).

> **Orçamentos na área do cliente.** Os orçamentos vêm do Billing, e o corpo é o que ele devolve, no envelope `{ data }`. A listagem confere o vínculo com a OS antes de ler o Billing. O detalhe e a decisão partem do `quoteId`, e só o Billing sabe a qual OS o orçamento pertence, então o orçamento é lido no Billing antes; sem vínculo com a OS dele, a resposta é **404** e nada do orçamento é devolvido nem repassado. Antes de repassar a decisão ao Billing, a rota confere ainda:
>
> | Situação | Resposta |
> |---|---|
> | OS fora de `AWAITING_APPROVAL` | **409** `Orçamento só pode ser decidido com a Ordem de Serviço aguardando aprovação. Status atual: "<status>"` |
> | Aprovação de outro orçamento da OS em andamento | **409** `Ordem de serviço com aprovação de orçamento em andamento: aguarde a conclusão e tente novamente` |
> | Orçamento que deixou de estar `SENT` (decisão concorrente, por exemplo) | **409** do Billing, com a mensagem dele |
> | Billing ou Inventory fora do ar, ou sem resposta (5 s no detalhe e na decisão, 2 s na listagem) | **503**; numa decisão, nada é gravado |

---

## Rotas internas (`/internal`)

Rotas para os outros serviços da oficina, pela rede do cluster. Ficam **fora do prefixo `/api`** (base `http://localhost:3000/internal`), não passam pelo API Gateway, não pedem token e não aparecem no Swagger.

| Método | Rota | Descrição | Acesso |
|---|---|---|---|
| GET | `/internal/work-orders/:id` | Detalhe da OS, com o mesmo corpo de `GET /api/work-orders/:id`. `400` para id que não é UUID e `404` para OS inexistente | Rede do cluster |

O Billing chama essa rota para conferir a OS antes de criar, enviar e aprovar um orçamento. O corpo segue o mesmo envelope das rotas públicas. O contrato fica numa fixture versionada, `app/test/contracts/internal-work-order.json`, conferida pelo e2e (ver [Contrato das rotas `/internal`](testing.md#contrato-das-rotas-internal)); detalhes do cliente HTTP das chamadas entre serviços em [Chamadas internas](architecture.md#chamadas-internas).

---

## Dados de exibição dos itens

Os itens da OS guardam o id do serviço ou da peça, a quantidade e o preço. Os dados de exibição (nome e descrição do serviço; nome, descrição, SKU, número de peça, categoria e unidade da peça) são lidos no Inventory a cada resposta que mostra itens: o detalhe da OS (e as rotas que o devolvem: criação, edição, mudança de status e `GET /internal/work-orders/:id`) e o item da rota de execução de serviço. A lista de OS mostra só o resumo e não consulta o Inventory. Os itens dos orçamentos em `/api/me` chegam do Billing já com os dados de exibição, que ele lê no Inventory.

- Um item que o Inventory não acha mais aparece com id, quantidade e preço e os campos de exibição nulos.
- Com o Inventory fora do ar, essas rotas respondem **503**. As que gravam e mostram itens (mudança de status e execução de serviço) leem o catálogo antes de gravar, então o 503 sai sem nada gravado.

---

## Formato de resposta

Recurso único — envolto em `{ data: ... }`:

```json
{ "data": { "id": "...", "name": "..." } }
```

Lista paginada — envolto em `{ data: [...], pagination: { ... } }`:

```json
{
  "data": [{ "id": "...", "name": "..." }],
  "pagination": {
    "totalRecords": 42,
    "totalPages": 5,
    "page": 1,
    "limit": 10
  }
}
```

`page` (default `1`, mínimo `1`) e `limit` (default `10`, mínimo `1`, máximo `100`) são padronizados no `PaginationDto` e aplicáveis a todos os endpoints paginados.

### Exceção: as rotas de saúde

`GET /api/health/live` e `GET /api/health/ready` **não** usam o envelope acima. O corpo é fixo e mínimo:

```json
{ "status": "ok" }
```

```json
{ "status": "unavailable" }
```

O motivo é a postura de segurança de um endpoint público: o corpo não pode divulgar host, porta, cadeia de conexão, mensagem ou código do driver, stack trace, versão nem identificação da instância — e precisa ser **indistinguível** entre causas de falha, senão vira canal de reconhecimento. Um envelope `{ data }` acrescentaria estrutura sem acrescentar informação, e a decisão do orquestrador se toma pelo status. O diagnóstico da causa vive no log, que já é redigido e limitado: a categoria (`timeout | connection | pool | authentication | query | unknown`) sai no evento de transição `health.degraded`.

A divergência é declarada aqui de propósito, para que o contrato universal desta seção não passe a ser contrariado em silêncio.

Erros seguem o padrão NestJS com mensagens em português:

```json
{ "statusCode": 404, "error": "Not Found", "message": "Recurso não encontrado" }
```

Conflitos de concorrência otimista retornam **409 Conflict** com mensagem orientando nova tentativa:

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "Ordem de serviço foi modificada por outra operação. Tente novamente."
}
```

Todas as datas são serializadas em ISO 8601 com fuso horário via `DateSerializerInterceptor` (global).
