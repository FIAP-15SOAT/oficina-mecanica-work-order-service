# Banco de Dados

Modelo relacional (PostgreSQL) da API, definido em [`prisma/schema.prisma`](../app/prisma/schema.prisma) e versionado via migrations em [`prisma/migrations/`](../app/prisma/migrations/).

## Diagrama entidade-relacionamento

<p align="center"><img src="diagrams/database-er.png" alt="Diagrama entidade-relacionamento dos 11 modelos em uso no schema Prisma: Customer, Address, Vehicle, WorkOrderStatusInfo, WorkOrder e seus itens de linha (WorkOrderService, WorkOrderPartSupply), StatusHistory, SagaInstance (tabela saga_instances), UserCustomer e OutboxMessage (tabela outbox); com tipos reais do Postgres, chaves primárias, estrangeiras e únicas; work_orders.assigned_user_id, status_history.changed_by_id e user_customers.user_id guardam o id de um usuário do Identity, sem chave estrangeira" width="100%"></p>

O diagrama omite as duas tabelas legadas, `users` e `password_reset_codes`, que continuam no schema sem uso (ver [Tabelas legadas](#tabelas-legadas)). As colunas `work_orders.assigned_user_id`, `status_history.changed_by_id` e `user_customers.user_id` guardam o id de um usuário do Identity, o serviço da solução dono dos usuários, sem chave estrangeira.

Os tipos de coluna mostrados no diagrama são os tipos **reais gerados no Postgres** (`VARCHAR(n)`, `TIMESTAMP(3)`, `DECIMAL(10,2)`, os enums nomeados, etc.), conferidos a partir das migrations — não os tipos abstratos do schema Prisma (`String`, `Int`, `DateTime`).

## Tabelas e relacionamentos

### Identidade e acesso

Os usuários (funcionários e usuários de acesso dos clientes) são do Identity, o serviço da solução dono dos usuários e das credenciais, que os guarda no próprio banco. Este banco guarda só o id do usuário, sem chave estrangeira, em três colunas: `work_orders.assigned_user_id`, `status_history.changed_by_id` e `user_customers.user_id`. Nome, e-mail e papel são lidos no Identity a cada resposta que os mostra (ver [Chamadas internas](architecture.md#chamadas-internas)).

- **`customers`** (`Customer`) — clientes da oficina (pessoa física ou jurídica, `type`). `document` (CPF/CNPJ) e `email` são únicos.
- **`user_customers`** (`UserCustomer`) — vínculo N:N entre um usuário do Identity e `customers` que autoriza o acesso externo por CPF: um usuário pode acessar os dados de um ou mais `Customer` (ex.: um contador que acessa vários clientes PJ). Chave primária composta `(user_id, customer_id)`; `user_id` não tem chave estrangeira, e `customer_id` é apagado em cascata com o cliente.
- **`customer_addresses`** (`Address`) — endereço 1:1 de um `Customer`. Chave primária é o próprio `customer_id` (sem id/timestamps próprios); apagado em cascata com o cliente.

### Tabelas legadas

- **`users`** (`User`) e **`password_reset_codes`** (`PasswordResetCode`) — os usuários e os códigos de redefinição de senha de quando este serviço era o dono dos usuários. O código não lê nem grava mais nessas tabelas, o seed não as preenche e nenhuma outra tabela as referencia; elas ficam no schema até uma migration as remover, num deploy seguinte. Até lá, `email` e `cpf` continuam únicos em `users`, e `password_reset_codes` continua apagada em cascata com o usuário.

### Veículos

- **`vehicles`** (`Vehicle`) — veículos de um `Customer` (`plate` única). Um cliente pode ter vários veículos; cada veículo pertence a exatamente um cliente.

### Ordem de Serviço (OS)

- **`work_order_statuses`** (`WorkOrderStatusInfo`) — tabela de referência (lookup, populada pelo seed): associa cada `WorkOrderStatus` a uma `priority` numérica única, de 1 a 10, usada para ordenar a listagem de OS por status em ordem de negócio, não alfabética: `RECEIVED` 1, `IN_DIAGNOSIS` 2, `AWAITING_APPROVAL` 3, `REJECTED` 4, `APPROVED` 5, `AWAITING_PAYMENT` 6, `IN_PROGRESS` 7, `COMPLETED` 8, `DELIVERED` 9 e `CANCELLED` 10 (ver [Ciclo de vida da Ordem de Serviço](architecture.md#ciclo-de-vida-da-ordem-de-serviço)). A prioridade segue a posição no fluxo, e `AWAITING_PAYMENT` entrou entre `APPROVED` e `IN_PROGRESS` empurrando os seguintes uma posição, numa migration própria (`add_awaiting_payment_priority`): o PostgreSQL não usa um valor de enum na mesma transação que o cria, e o Prisma aplica cada arquivo de migration numa transação. Como o índice único de `priority` é conferido linha a linha, a renumeração passa por uma faixa livre (`+ 100` e depois `- 99`) antes de inserir o 6. O seed (`work-order-status-info.seed.ts`) grava os mesmos valores.
- **`work_orders`** (`WorkOrder`) — a Ordem de Serviço, aggregate root do domínio. Referencia um `Customer` e um `Vehicle`, guarda opcionalmente o id do usuário atribuído (o mecânico, em `assigned_user_id`, sem chave estrangeira) e seu `status` é FK para `work_order_statuses`. Concorrência otimista via `version`.
- **`work_order_services`** / **`work_order_part_supplies`** (`WorkOrderService` / `WorkOrderPartSupply`) — itens de linha da OS (serviços e peças/insumos aplicados), com chave primária composta `(work_order_id, service_id | part_supply_id)` em vez de surrogate key. Apagados em cascata com a OS. `service_id` e `part_supply_id` são referências simples, sem FK: o catálogo é do Inventory, e o item guarda só o id, a quantidade e o preço.
- **`status_history`** (`StatusHistory`) — histórico de transições de status de uma OS, com o id do usuário que efetuou a mudança (`changed_by_id`, opcional e sem chave estrangeira). A confirmação da compensação da Saga de aprovação grava uma entrada que não muda o status (`AWAITING_APPROVAL → AWAITING_APPROVAL`, ou `CANCELLED → CANCELLED` quando a OS foi cancelada antes de a Saga começar), sem autor e com a nota do motivo. As entradas do bloqueio e da volta da Saga de cobrança também ficam sem autor, com a nota que identifica a cobrança e o desfecho.

### Sagas

- **`saga_instances`** (`SagaInstance`) — o estado de cada Saga que o serviço orquestra e que espera a resposta de outro serviço. São dois tipos (`type`), e o `correlation_id` aponta para um registro do Billing, o serviço da solução dono dos orçamentos e dos pagamentos (ver [Orçamentos no Billing](architecture.md#orçamentos-no-billing)); `work_order_id` é a OS dele. A Saga de abertura não tem linha: começa e termina dentro de uma requisição.
  - **`QUOTE_APPROVAL`** (ver [Aprovação de orçamento com reserva de estoque](architecture.md#aprovação-de-orçamento-com-reserva-de-estoque)): `correlation_id` é o id do orçamento aprovado. `status` vai de `RESERVING_STOCK` a `COMPLETED` (reserva confirmada) ou a `COMPENSATING` (aprovação desfeita sendo revertida no Billing) e, confirmada a reversão, a `COMPENSATED`. A aprovação sem peças cria a linha já `COMPLETED`. `failure_reason` é `INSUFFICIENT_STOCK` (o Inventory recusou a reserva) ou `WORK_ORDER_NOT_AWAITING` (a OS já não aguardava aprovação quando a Saga começou).
  - **`PAYMENT`** (ver [Saga de cobrança](architecture.md#saga-de-cobrança)): `correlation_id` é o id da cobrança. `status` começa em `AWAITING_PAYMENT` (a OS bloqueada à espera do pagamento) e vai a `COMPLETED` (pago) ou a `COMPENSATED` (expirada, recusada ou cancelada), ou começa em `COMPENSATING` (a OS não podia ser cobrada e o cancelamento foi pedido ao Billing) e vai a `COMPENSATED` ou, se o cliente pagou antes do cancelamento, a `COMPLETED`. `failure_reason` é `WORK_ORDER_NOT_PAYABLE`, `PAYMENT_EXPIRED`, `PAYMENT_REJECTED` ou `PAYMENT_CANCELLED`.
  - **`origin_status`** (`WorkOrderStatus`, nula) guarda o status da OS antes do bloqueio da cobrança (`APPROVED` ou `COMPLETED`), para onde ela volta. Fica nula nas Sagas `QUOTE_APPROVAL` e na Saga `PAYMENT` criada já em compensação. É uma coluna tipada, e não um `jsonb` de dados da Saga, porque é o único dado próprio de um tipo.
  - **Datas.** `created_at` e `updated_at` saem do relógio da aplicação (a criação carimbada pela entidade, a atualização pelo `@updatedAt` do Prisma), porque a duração da Saga, medida na métrica `oficina.saga.duration`, é a diferença entre as duas, e as duas precisam vir do mesmo relógio.
  - **Única por registro do Billing.** A chave única `(type, correlation_id)` impede duas Sagas para o mesmo orçamento ou a mesma cobrança, e é ela que torna as mensagens repetidas inofensivas; aprovar de novo um orçamento compensado por falta de estoque reabre a mesma linha.
  - **Sem `version`.** Toda escrita na Saga vai numa transação que também grava com versão a OS, e a fila FIFO entrega as mensagens do Billing e do Inventory em ordem por OS.
  - O índice em `work_order_id` atende a consulta que barra o cancelamento da OS e a decisão do cliente enquanto a OS tem uma Saga ativa (`RESERVING_STOCK` ou `COMPENSATING`). Apagada em cascata com a OS.
  - **Migrations.** `add_saga_compensation` acrescentou `COMPENSATING` e `WORK_ORDER_NOT_AWAITING` aos enums da Saga; `add_payment_saga` acrescentou `PAYMENT`, `AWAITING_PAYMENT`, os quatro motivos da cobrança, o `AWAITING_PAYMENT` da OS e a coluna `origin_status`. As duas só acrescentam valores e uma coluna nula, e a versão anterior do serviço lê o banco enquanto nenhuma OS ou Saga usar os valores novos. Uma OS em `AWAITING_PAYMENT` fica presa sob a versão anterior, que não tem transição saindo desse status nem trata as mensagens `billing.payment.*` (elas vão para a fila de mensagens que falharam, a DLQ). Por isso a volta à versão anterior é só pela reimplantação da imagem (o `workflow_dispatch` com `image_tag`, que não roda migration nem seed), depois de esvaziar `AWAITING_PAYMENT`: cancelar no Billing as cobranças pendentes e esperar as OS voltarem ao status de origem. Reverter o código e deixar o CD rodar não serve, porque o seed da versão anterior grava `IN_PROGRESS` com a prioridade 6, que agora é de `AWAITING_PAYMENT`, e falha no índice único de `priority`.

### Mensageria

- **`outbox`** (`OutboxMessage`) — mensagens a publicar, gravadas na mesma transação da mudança de estado que as origina e apagadas pelo relay depois de publicadas no tópico SNS; por isso a tabela fica quase sempre vazia.
  - **Duas identidades.** `id` (`BIGSERIAL`) dá ao relay a ordem de criação, que a fila FIFO preserva por OS: o UUID v4 não tem ordem, e `created_at` empata no mesmo milissegundo. `message_id` (UUID v4, único) é a identidade da mensagem entre serviços, usada como `MessageDeduplicationId` e como chave de idempotência de quem consome; um número sequencial colidiria entre serviços.
  - **Conteúdo.** `type` é um tipo do catálogo de mensagens (`app/src/domain/messaging/`), `payload` é o corpo (`JSONB`) e `work_order_id` é a OS da mensagem, nula nas mensagens sem OS.
  - **`trace_context`** guarda o contexto de trace W3C da requisição que gravou a linha (`traceparent` e, quando houver, `tracestate`). O relay publica dentro desse contexto, e o processamento no serviço que consome aparece no mesmo trace da requisição.
  - **`created_at`** é `TIMESTAMPTZ(3)`: o `occurredAt` da mensagem sai dele em UTC, qualquer que seja o fuso da sessão do PostgreSQL.
  - **Um relay por vez.** Toda réplica do serviço roda um relay, que a cada 500 ms abre uma transação, lê até 10 linhas por `id`, publica uma a uma e apaga as publicadas. A transação começa com `pg_try_advisory_xact_lock(7310001)`, uma trava consultiva do PostgreSQL: só uma transação a obtém, as outras recebem `false` na hora e pulam aquele ciclo sem esperar, e a trava se solta sozinha no `COMMIT` ou no `ROLLBACK`. Sem ela, duas réplicas publicariam linhas do mesmo lote ao mesmo tempo e a ordem da OS na fila FIFO se perderia. O número não tem significado: é a chave que identifica essa trava no banco (`OUTBOX_RELAY_LOCK_KEY`), igual em todas as réplicas e sem outro uso no mesmo banco.
  - **Custo de quem pula.** A réplica que não obtém a trava ainda abre a transação: ocupa uma conexão do pool durante o `BEGIN`, o `SELECT` da trava e o `COMMIT`, a cada 500 ms, mesmo com a tabela vazia.
  - **`work_order_id`** é FK `Restrict` para `work_orders`. Os outros serviços usam a mesma tabela sem a FK, porque lá o id é de uma OS que não pertence a eles.

## Enums

Sete enums:

| Enum | Valores |
|---|---|
| `UserRole` | `ADMIN`, `MECHANIC`, `ATTENDANT` |
| `CustomerType` | `INDIVIDUAL`, `COMPANY` |
| `WorkOrderStatus` | `RECEIVED`, `IN_DIAGNOSIS`, `AWAITING_APPROVAL`, `APPROVED`, `REJECTED`, `AWAITING_PAYMENT`, `IN_PROGRESS`, `COMPLETED`, `DELIVERED`, `CANCELLED` |
| `WorkOrderServiceStatus` | `PENDING`, `IN_PROGRESS`, `COMPLETED` |
| `SagaType` | `QUOTE_APPROVAL`, `PAYMENT` |
| `SagaStatus` | `RESERVING_STOCK`, `AWAITING_PAYMENT`, `COMPENSATING`, `COMPLETED`, `COMPENSATED` |
| `SagaFailureReason` | `INSUFFICIENT_STOCK`, `WORK_ORDER_NOT_AWAITING`, `WORK_ORDER_NOT_PAYABLE`, `PAYMENT_EXPIRED`, `PAYMENT_REJECTED`, `PAYMENT_CANCELLED` |

`UserRole` **não** ganhou um valor `CUSTOMER` — o acesso externo não é modelado como papel interno (ver [ADR 0004](adr/0004-autenticacao-de-clientes.md)).

## Convenções de modelagem

- **IDs**: `uuid` v4 (`@db.Uuid`) gerados pelo Prisma — exceto o número da OS, gerado por uma **sequence PostgreSQL** (`work_order_number_seq`, formatada com 6 dígitos zero-padded — `000001`, `000002`, …), e o `id` sequencial do `outbox` (ver [Mensageria](#mensageria)).
- **Timestamps**: `created_at` / `updated_at` em todas as entidades não-imutáveis (`Address` e `StatusHistory` guardam apenas `created_at`).
- **Concorrência otimista**: coluna `version Int @default(1)` em `WorkOrder`.
- **Cascade deletes** para itens dependentes (`WorkOrderService`, `WorkOrderPartSupply`, `StatusHistory`, `SagaInstance`, `Address`).
- **Referências a outro serviço sem FK**: o id de um serviço ou peça do Inventory nos itens, o id do orçamento ou da cobrança do Billing em `saga_instances.correlation_id` e o id de um usuário do Identity na OS, no histórico e nos vínculos ficam sem chave estrangeira, porque a linha está em outro banco.
- **Unicidade**: `Customer.email`, `Customer.document`, `Vehicle.plate`, `WorkOrder.number`, `SagaInstance (type, correlation_id)`.
- **Identidades compostas**: `WorkOrderService` e `WorkOrderPartSupply` usam chave primária composta `(parentId, itemId)` em vez de surrogate key.
- **Índices secundários** por colunas usadas em filtros (`status`, `customer_id`, `vehicle_id`, `assigned_user_id`, `part_supply_id`, `work_order_id`, etc.) e índice composto `(status, created_at)` em `work_orders` para listagens ordenadas.

## Conexão em produção

O Amazon RDS gera e mantém a master password em um Secret do AWS Secrets
Manager, com rotação automática desabilitada. No CD da API, o job `prepare-deploy` descobre os metadados da instância por
`vars.RDS_INSTANCE_IDENTIFIER`, lê o estágio `AWSCURRENT`, aplica percent-encoding
ao usuário e à senha e materializa a URL com TLS no Secret Kubernetes
`database-credentials`. O Job de migration/seed e o Deployment consomem a mesma
chave `DATABASE_URL`; não existe senha do banco nos settings do GitHub.

A preparação usa Node.js inline e aplica o manifesto por stdin. `db-migrate`
executa somente migration/seed; `app-deploy` aplica a imagem e aguarda o rollout.
O deploy é greenfield, sem annotation/output de versão da credencial; uma
mudança isolada do Secret não renova o environment de Pods existentes.

Esse fluxo não altera o contrato do Prisma nem o runtime. CI/E2E usam bancos
descartáveis e uma URL própria. Detalhes e alternativas estão no
[ADR 0017](adr/0017-materializacao-da-credencial-do-banco-no-cd.md).

## Referências

- [ADR 0001 — Uso do PostgreSQL como banco de dados relacional](adr/0001-uso-do-postgresql-como-banco-de-dados.md)
- [ADR 0004 — Autenticação externa de clientes por CPF](adr/0004-autenticacao-de-clientes.md)
- [ADR 0010 — Concorrência otimista via coluna `version`](adr/0010-concorrencia-otimista-via-version.md)
- [ADR 0023 — Catálogo e estoque no Inventory, com reserva pela Saga de aprovação](adr/0023-catalogo-e-estoque-no-inventory-com-reserva-pela-saga.md)
- [ADR 0024 — Saga de abertura com orçamento inicial no Billing](adr/0024-saga-de-abertura-com-orcamento-inicial-no-billing.md)
- [ADR 0025 — Sagas orquestradas no work-order](adr/0025-sagas-orquestradas-no-work-order.md)
- [ADR 0026 — Usuários lidos no Identity, sem réplica](adr/0026-usuarios-lidos-no-identity-sem-replica.md)
- [`oficina-mecanica-infra-database-work-order` — ADRs de dados gerenciados (RDS e ElastiCache)](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-work-order/tree/main/docs/adr)
