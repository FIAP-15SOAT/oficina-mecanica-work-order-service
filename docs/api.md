# 🔌 Referência da API

> A fonte viva do contrato é o **Swagger** em `http://localhost:3000/api/docs` (spec em `/api/docs-json`). Esta página é o resumo legível dos endpoints.

## Índice

- [Endpoints disponíveis](#endpoints-disponíveis)
- [Rotas internas (`/internal`)](#rotas-internas-internal)
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

**Serviços** (`/api/services`)

| Método | Rota | Descrição | Perfis |
|---|---|---|---|
| POST | `/` | Cadastrar serviço | ADMIN |
| GET | `/` | Listar (paginado; filtro: `name`) | ADMIN, MECHANIC, ATTENDANT |
| GET | `/:id` | Buscar por ID | ADMIN |
| GET | `/:id/metrics` | Métricas de uso de um serviço (execuções concluídas e tempo médio em minutos) | ADMIN |
| PUT | `/:id` | Atualizar | ADMIN |
| DELETE | `/:id` | Remover | ADMIN |

---

**Métricas de Serviços** (`/api/services-metrics`) — *ADMIN*

| Método | Rota | Descrição | Perfis |
|---|---|---|---|
| GET | `/` | Listar métricas de todos os serviços (paginado) | ADMIN |

---

**Peças e Insumos** (`/api/parts-supplies`)

| Método | Rota | Descrição | Perfis |
|---|---|---|---|
| POST | `/` | Cadastrar peça ou insumo | ADMIN |
| GET | `/` | Listar estoque (paginado; filtros: `name`, `sku`, `category`, `lowStock`) | ADMIN, MECHANIC, ATTENDANT |
| GET | `/:id` | Buscar por ID | ADMIN, ATTENDANT |
| PUT | `/:id` | Atualizar dados | ADMIN |
| PATCH | `/:id` | Movimentar estoque (`ENTRY` / `EXIT` / `ADJUSTMENT`) — gera `StockMovement` | ADMIN, ATTENDANT |
| DELETE | `/:id` | Remover (bloqueado se houver estoque ou reservas vinculadas) | ADMIN |

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
| POST | `/` | Criar nova OS (`userId` extraído do JWT, número gerado por sequence). Aceita opcionalmente `services` e `partsSupplies` — se ao menos um serviço for fornecido, cria um orçamento `PENDING` atomicamente na mesma transação (sem passar pelo gate `ensureCanCreateQuote`). Peças sem serviço → 409. ID desconhecido → 404. | ADMIN, ATTENDANT |
| GET | `/` | Listar (paginado; filtros: `number`, `status`, `customerId`, `vehicleId`, `assignedUserId`; ordenação: `sort`). **Por padrão, ordens em `COMPLETED`, `DELIVERED` e `CANCELLED` são omitidas**; use `?status=X` para recuperá-las. | ADMIN, MECHANIC, ATTENDANT |
| GET | `/:id` | Buscar por ID (retorna serviços e peças/insumos da OS) | ADMIN, MECHANIC, ATTENDANT |
| PUT | `/:id` | Atualizar OS (apenas em `RECEIVED` / `IN_DIAGNOSIS`; `userId` extraído do JWT) | ADMIN, MECHANIC, ATTENDANT |
| PATCH | `/:id` | Atualizar status da OS (apenas `IN_DIAGNOSIS`, `CANCELLED`, `DELIVERED`) | ADMIN, MECHANIC, ATTENDANT |
| PATCH | `/:workOrderId/services/:serviceId` | Atualizar status de um serviço da OS (`IN_PROGRESS` / `COMPLETED`) | ADMIN, MECHANIC, ATTENDANT |
| GET | `/:id/status-history` | Histórico de mudanças de status | ADMIN, MECHANIC, ATTENDANT |
| GET | `/:id/quotes` | Listar orçamentos da OS (sem itens) | ADMIN, MECHANIC, ATTENDANT |

> Demais transições (`AWAITING_APPROVAL`, `APPROVED`, `REJECTED`, `IN_PROGRESS`, `COMPLETED`) são derivadas automaticamente dos fluxos de orçamento e dos status de serviço — veja [Ciclo de vida da Ordem de Serviço](./architecture.md#ciclo-de-vida-da-ordem-de-serviço).

> **Ordenação (`sort`)**: critérios no formato `campo:direção` separados por vírgula (ex.: `?sort=status:desc,createdAt:asc`). Campos permitidos: `status` e `createdAt`; direção `asc` ou `desc`. Padrão: `status:desc,createdAt:asc`. Ao ordenar por `status`, usa-se a **prioridade de negócio** da tabela `WorkOrderStatusInfo` (`RECEIVED` → … → `CANCELLED`), não a ordem alfabética.

---

**Orçamentos** (`/api/quotes`)

| Método | Rota | Descrição | Perfis |
|---|---|---|---|
| GET | `/` | Listar (paginado; filtros: `workOrderId`, `status`) | ADMIN, MECHANIC, ATTENDANT |
| POST | `/` | Criar orçamento para uma OS (OS deve estar em `IN_DIAGNOSIS` / `AWAITING_APPROVAL` / `REJECTED`). Aceita opcionalmente `services` e `partsSupplies` inline — sem itens cria orçamento vazio (comportamento original); com itens aplica a regra "ao menos um serviço obrigatório" (peças sem serviço → 409, ID desconhecido → 404). | ADMIN, MECHANIC, ATTENDANT |
| GET | `/:id` | Buscar por ID com itens (serviços e peças/insumos) | ADMIN, MECHANIC, ATTENDANT |
| POST | `/:id/services` | Adicionar serviço ao orçamento — body `{ serviceId, quantity }` | ADMIN, MECHANIC, ATTENDANT |
| PATCH | `/:id/services/:serviceId` | Atualizar quantidade de serviço | ADMIN, MECHANIC, ATTENDANT |
| DELETE | `/:id/services/:serviceId` | Remover serviço do orçamento | ADMIN, MECHANIC, ATTENDANT |
| POST | `/:id/parts-supplies` | Adicionar peça/insumo ao orçamento — body `{ partSupplyId, quantity }` | ADMIN, MECHANIC, ATTENDANT |
| PATCH | `/:id/parts-supplies/:partSupplyId` | Atualizar quantidade de peça/insumo | ADMIN, MECHANIC, ATTENDANT |
| DELETE | `/:id/parts-supplies/:partSupplyId` | Remover peça/insumo do orçamento | ADMIN, MECHANIC, ATTENDANT |
| POST | `/:id/submissions` | Enviar orçamento para aprovação do cliente (envia e-mail notificando o cliente, sem link de decisão — a decisão exige autenticação, ver **Minha Conta** abaixo). Exige a OS já diagnosticada (nunca `RECEIVED` → 409); permite orçamentos concorrentes (vários `SENT` na mesma OS). | ADMIN, MECHANIC, ATTENDANT |
| PATCH | `/:id` | Aprovar (`status=APPROVED`) ou rejeitar (`status=REJECTED` + `reason`) manualmente | ADMIN, ATTENDANT |
> A rota pública `GET /quotes/:id/decisions?token=...` (decisão via link assinado por e-mail) foi **removida**. A decisão do Cliente da Oficina agora exige autenticação — ver **Minha Conta** abaixo.

> Itens só podem ser modificados enquanto o orçamento estiver `PENDING`. A aprovação reserva estoque, materializa itens na OS, transiciona a OS para `APPROVED` e rejeita os demais orçamentos pendentes/enviados da mesma OS (propostas concorrentes). A rejeição só leva a OS a `REJECTED` quando não há outro orçamento `SENT`; havendo, a OS permanece `AWAITING_APPROVAL`. As listagens (`GET /quotes` e `GET /work-orders/:id/quotes`) intencionalmente omitem os itens — apenas `GET /quotes/:id` retorna o orçamento com seus itens.

---

**Movimentações de Estoque** (`/api/stock-movements`) — *ADMIN, ATTENDANT*

| Método | Rota | Descrição | Perfis |
|---|---|---|---|
| GET | `/` | Listar movimentações (paginado; filtros: `partSupplyId`, `type`, `workOrderId`, `startDate`, `endDate`) | ADMIN, ATTENDANT |

> `startDate` e `endDate` aceitam o formato `yyyy-MM-dd` (validado por `@Matches`) e são convertidos internamente para janelas UTC inclusivas (`startDate 00:00:00.000Z` até `endDate 23:59:59.999Z`).

---

**Reservas de Estoque** (`/api/stock-reservations`) — *ADMIN, ATTENDANT*

| Método | Rota | Descrição | Perfis |
|---|---|---|---|
| GET | `/` | Listar reservas ativas (paginado; filtros: `partSupplyId`, `workOrderId`) | ADMIN, ATTENDANT |

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
| GET | `/work-orders/:workOrderId/quotes` | Orçamentos de uma ordem de serviço vinculada | `customer-jwt` |
| GET | `/quotes/:quoteId` | Orçamento e itens de uma ordem vinculada | `customer-jwt` |
| POST | `/quotes/:quoteId/decisions` | Aprovar (`{ "action": "approve" }`) ou rejeitar (`{ "action": "reject", "reason": "..." }`) um orçamento vinculado | `customer-jwt` |

> O token `customer-jwt` (RS256) é emitido por uma **função serverless externa** a esta aplicação, após autenticar o Cliente da Oficina por CPF + senha — a API só verifica a assinatura com `CUSTOMER_JWT_PUBLIC_KEY`. Toda rota `/api/me/*` que aponta a um recurso específico (`workOrderId`/`quoteId`) resolve a autorização **por vínculo** a cada requisição, consultando `UserCustomer` no banco — o token nunca carrega `customerId`. Um recurso inexistente e um recurso de um cliente não vinculado respondem igualmente **404** (nunca 403), para não virar oráculo de enumeração. Ver [Identidade externa, autenticação e autorização por vínculo](architecture.md#identidade-externa-autenticação-e-autorização-por-vínculo).

---

## Rotas internas (`/internal`)

Rotas para os outros serviços da oficina, pela rede do cluster. Ficam **fora do prefixo `/api`** (base `http://localhost:3000/internal`), não passam pelo API Gateway, não pedem token e não aparecem no Swagger.

| Método | Rota | Descrição | Acesso |
|---|---|---|---|
| GET | `/internal/work-orders/:id` | Detalhe da OS, com o mesmo corpo de `GET /api/work-orders/:id`. `400` para id que não é UUID e `404` para OS inexistente | Rede do cluster |

O corpo segue o mesmo envelope das rotas públicas. O contrato fica numa fixture versionada em `app/test/contracts/`, conferida pelo e2e (ver [Contrato das rotas `/internal`](testing.md#contrato-das-rotas-internal)); detalhes do cliente que chama essas rotas em [Chamadas internas](architecture.md#chamadas-internas).

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
