# 🏛️ Arquitetura

Clean Architecture + DDD do backend da Oficina Mecânica — camadas estritas, entidades ricas e agregados protegendo invariantes.

## Índice

- [Estrutura de camadas](#estrutura-de-camadas)
- [Modelos do banco de dados](#modelos-do-banco-de-dados)
- [DDD — Aggregate Roots, Entidades e Value Objects](#ddd--aggregate-roots-entidades-e-value-objects)
- [Concorrência otimista](#concorrência-otimista)
- [Perfis de usuário (RBAC)](#perfis-de-usuário-rbac)
- [Identidade externa, autenticação e autorização por vínculo](#identidade-externa-autenticação-e-autorização-por-vínculo)
- [Unit of Work](#unit-of-work)
- [Ciclo de vida da Ordem de Serviço](#ciclo-de-vida-da-ordem-de-serviço)
- [Orçamentos no Billing](#orçamentos-no-billing)
- [Saga de abertura](#saga-de-abertura)
- [Aprovação de orçamento com reserva de estoque](#aprovação-de-orçamento-com-reserva-de-estoque)
- [Fluxo do orçamento, do envio à aprovação](#fluxo-do-orçamento-do-envio-à-aprovação)
- [Saga de cobrança](#saga-de-cobrança)
- [Orçamentos e cobranças na área do Cliente da Oficina](#orçamentos-e-cobranças-na-área-do-cliente-da-oficina)
- [Mensageria, cache e chamadas internas](#mensageria-cache-e-chamadas-internas)
- [Exceções por Camada](#exceções-por-camada)
- [Observabilidade](#observabilidade)
- [Decisões de Arquitetura (ADRs)](#decisões-de-arquitetura-adrs)
- [Modelo C4](#modelo-c4)

## Estrutura de camadas

O projeto segue **Clean Architecture** com separação estrita de camadas e adota práticas de **Domain-Driven Design** — entidades ricas, value objects, agregados (Aggregate Roots), invariantes de domínio e regras de negócio encapsuladas no próprio domínio. O código-fonte aponta apenas para dentro: `domain/` e `application/` são **livres de framework e ORM** (uma cerca de ESLint proíbe `@nestjs/*`, `@generated/client` e `@opentelemetry/*` nessas camadas — e em `interface-adapters/` — quebrando a build se violada). A camada `interface-adapters/` concentra os **Clean Controllers** e **Presenters** (POJOs livres de framework); a borda NestJS (rotas, Swagger, guards, DTOs) fica em `infrastructure/http/` e apenas **delega** ao Clean Controller.

Toda a aplicação fica sob o diretório `app/` na raiz do repositório (código, testes, Prisma e todas as configs de tooling); a raiz guarda apenas concerns transversais (`README.md`, `.gitignore`) e as pastas `docs/`, `k8s/`, `collections/`, `reports/` e `openspec/`.

```
app/src/
├── domain/                          # Camada de domínio (regras de negócio puras, sem framework)
│   ├── entities/                    # Entidades ricas com validação de domínio e invariantes
│   │                                # WorkOrder é o Aggregate Root
│   ├── value-objects/               # Document (CPF/CNPJ), Email, Phone, Plate,
│   │                                # ZipCode, Address, LineItemPrice, WorkOrderNumber
│   ├── enums/                       # UserRole, CustomerType, WorkOrderStatus,
│   │                                # WorkOrderServiceStatus,
│   │                                # QuoteDecisionAction, SagaType, SagaStatus,
│   │                                # SagaFailureReason, AuthFlow, SortDirection
│   ├── exceptions/                  # DomainException, DomainValidationException,
│   │                                # EntityNotFoundException, BusinessRuleViolationException
│   ├── constants/                   # Regex compartilhadas (placa, telefone, e-mail, número da OS)
│   │                                # + limites de validação por agregado
│   ├── validators/                  # DocumentValidator (CPF/CNPJ com dígito verificador)
│   ├── messaging/                   # Catálogo de mensagens por escopo (inventory, billing,
│   │                                # notification) + message-catalog (OutboxMessage: união
│   │                                # discriminada por `type`)
│   └── interfaces/                  # Contratos da camada de domínio (permanecem no domínio)
│       ├── common/                  # PaginationQuery, PaginatedResult, SortCriterion
│       └── repositories/            # Contratos de repositórios (IRepository) + IUnitOfWork
│                                    # (inclui IOutboxRepository)
│
├── application/                     # Camada de aplicação (orquestração de casos de uso, sem framework)
│   ├── ports/
│   │   ├── input/<domínio>/         # I<Nome>UseCase (input ports) + DTOs de entrada
│   │   └── output/
│   │       ├── services/            # ILogger, IMetrics, ICache
│   │       │                        # (output ports)
│   │       └── gateways/<dono>/     # I<Dono><Coisa>Gateway + *GatewayResponse
│   │                                # (inventory/: IInventoryCatalogGateway, catálogo
│   │                                # de serviços e peças lido no Inventory;
│   │                                # billing/: IBillingQuotesGateway, orçamentos
│   │                                # lidos, criados e decididos no Billing, e
│   │                                # IBillingPaymentsGateway, saldo e cobranças da OS;
│   │                                # identity/: IIdentityUsersGateway, usuários
│   │                                # lidos e criados no Identity)
│   ├── auth/                        # Principal autenticado que os controllers passam aos casos de uso
│   ├── messaging/                   # MessageEnvelope + MessageHandler (contrato dos handlers)
│   ├── keys/                        # Chaves de cache (work-order:work-order:<id>)
│   ├── mappers/                     # WorkOrderCacheMapper (snapshot versionado da OS no cache)
│   ├── metrics/                     # IMetrics é a porta; aqui ficam o catálogo tipado das
│   │                                # métricas de negócio, o cálculo puro de permanência
│   │                                # por status e dos dois totais, e os sinais das
│   │                                # transições da OS (work-order-metrics) e das Sagas
│   │                                # (saga-metrics)
│   ├── logging/                     # LogEventDefinition + catálogo tipado e fechado
│   │                                # de eventos de NEGÓCIO (nomes lógicos, sem chave física)
│   ├── policies/                    # CustomerAccessPolicy — autorização por vínculo,
│   │                                # reutilizável por qualquer caso de uso de /api/me/*;
│   │                                # MechanicAssignmentPolicy — confere no Identity que
│   │                                # o usuário atribuído é um mecânico ativo
│   ├── services/                    # CustomerEmailRecipientsResolver — destinatários
│   │                                # dos e-mails ao cliente (usuários vinculados ativos
│   │                                # no Identity ou o e-mail do cadastro);
│   │                                # CustomerAccessUserProvisioner — localiza ou cria no
│   │                                # Identity o usuário de acesso do cliente, usado ao
│   │                                # conceder acesso e ao cadastrar o cliente
│   ├── notifications/               # WorkOrderEmailComposer — monta as mensagens
│   │                                # notification.email.send (assunto, texto e HTML
│   │                                # com os valores externos escapados)
│   ├── use-cases/
│   │   ├── identity/                # FindUsersByIds — nome, e-mail e papel dos usuários
│   │   │                            # lidos no Identity pelos Clean Controllers
│   │   ├── customer/                # CRUD completo de clientes (createAccess opcional)
│   │   ├── customer-access/         # GrantCustomerAccess, ListCustomerAccessUsers,
│   │   │                            # ListUserCustomers, ListActiveUserCustomers,
│   │   │                            # RevokeCustomerAccess, UpdateCustomerStatus
│   │   ├── me/                      # FindAllMyWorkOrders, FindMyWorkOrderById,
│   │   │                            # FindMyWorkOrdersQuotes, FindMyQuoteById,
│   │   │                            # DecideMyQuote, FindMyWorkOrderPayments —
│   │   │                            # usuário externo autenticado
│   │   ├── vehicle/                 # CRUD + busca por cliente
│   │   ├── catalog/                 # FindCatalogItems — dados de exibição dos itens,
│   │   │                            # lidos no Inventory pelos Clean Controllers
│   │   ├── service/                 # Métricas por serviço (individual e agregada paginada)
│   │   ├── work-order/              # Criação (Saga de abertura), busca, atualização,
│   │   │                            # status, status de serviços, histórico e
│   │   │                            # ApplySentQuote / ApplyRejectedQuote (mensagens
│   │   │                            # de envio e rejeição do Billing)
│   │   ├── quote-approval/          # Saga de aprovação: StartQuoteApproval,
│   │   │                            # CompleteQuoteApproval, CompensateQuoteApproval
│   │   │                            # e ConfirmQuoteApprovalReversal
│   │   └── payment/                 # Saga de cobrança: StartPayment (pedido de
│   │                                # cobrança) e ApplyPaymentResult (pagamento
│   │                                # aprovado ou falho)
│   ├── exceptions/                  # ResourceNotFoundException, ResourceConflictException,
│   │                                # UnauthorizedAccessException, ServiceRequestRejectedException
│   └── utils/                       # PaginationUtil (sanitização e cálculo de páginas)
│
├── interface-adapters/<domínio>/    # Adapters livres de framework (POJOs, zero @nestjs/*)
│                                    # domínios: customer, customer-access, me,
│                                    # service, vehicle, work-order
│   ├── <domínio>.controller.ts      # Clean Controller: orquestra o(s) use-case(s) + Presenter
│   ├── <domínio>.presenter.ts       # Entidade → tipo de resposta PURO (sem @ApiProperty)
│   ├── requests/                    # Tipos de request do controller (defaults de paginação aqui)
│   └── responses/                   # <Dom>Response / <Dom>DataResponse / <Dom>PaginatedResponse
│
├── infrastructure/                  # Implementações concretas (framework e serviços externos)
│   ├── config/                      # app-bootstrap (composição da borda HTTP, compartilhada
│   │                                #   entre main.ts e o helper de E2E) + swagger.config
│   ├── utils/                       # read-pem-key (chave PEM da configuração, usada pelas
│   │                                #   duas strategies JWT)
│   ├── health/                      # Saúde operacional, agnóstica de transporte:
│   │   │                            # health.constants (módulo folha: segmentos de rota e o
│   │   │                            #   conjunto fechado de caminhos),
│   │   │                            # postgres.health-check (SELECT 1 com query_timeout
│   │   │                            #   próprio + prazo do chamador; categoria fechada),
│   │   │                            # readiness-state (ready|draining, single-flight, transição)
│   ├── gateways/                    # Adaptadores das portas de gateway, sobre o
│   │                                # InternalHttpClient: inventory/
│   │                                # HttpInventoryCatalogGateway, billing/
│   │                                # HttpBillingQuotesGateway e
│   │                                # HttpBillingPaymentsGateway e identity/
│   │                                # HttpIdentityUsersGateway
│   ├── messaging/                   # MessagingModule (@Global: SNSClient, SQSClient),
│   │                                # messaging-clients (clientes SNS/SQS com prazo por pedido),
│   │                                # OutboxRelayService (relay do outbox → SNS FIFO),
│   │                                # SqsConsumerService (sqs-consumer + span CONSUMER),
│   │                                # MessageHandlerRegistry, MessageEnvelopeDto,
│   │                                # messaging-log-bindings (campos messaging.* das linhas),
│   │                                # handlers/ (quote/: envio e rejeição do Billing;
│   │                                # quote-approval/: passos da Saga de aprovação;
│   │                                # payment/: passos da Saga de cobrança)
│   ├── cache/                       # CacheModule (@Global, token 'ICache') +
│   │                                # ValkeyCacheAdapter + valkey-client (ioredis)
│   ├── clients/                     # ClientsModule + InternalHttpClient (@nestjs/axios;
│   │                                #   x-request-id, prazo e erros do dono)
│   ├── http/                        # Borda NestJS — @Controller fino que delega ao Clean Controller
│   │   ├── http.constants.ts        # Prefixo global (`api`) e prefixo interno (`internal`) —
│   │   │                            #   módulo folha lido por config/app-bootstrap e por
│   │   │                            #   health/health.constants
│   │   ├── controllers/<domínio>/   # @Controller + module + dto/requests + dto/responses
│   │   │                            # (@ApiProperty; *ResponseDto implements o tipo puro)
│   │   │                            # domínios no singular;
│   │   │                            # customer-access/ tem dois controllers
│   │   │                            # (CustomerAccessController, UserCustomersController);
│   │   │                            # me/ expõe as rotas do usuário externo; internal/ as
│   │   │                            # rotas /internal entre serviços (inclusive os
│   │   │                            # clientes vinculados a um usuário); service/ só as
│   │   │                            # métricas; e as rotas de saúde em controllers/health/
│   │   ├── guards/                  # AuthenticationGuard (global, nega por padrão) +
│   │   │                            # JwtAuthGuard, CustomerJwtAuthGuard, RolesGuard
│   │   ├── decorators/              # @CurrentUser, @Roles, @Public, @CustomerArea
│   │   ├── strategies/              # JwtStrategy (RS256, interno, só pelas claims),
│   │   │                            # CustomerJwtStrategy (RS256, externo) — Passport,
│   │   │                            # nunca um verificador compartilhado
│   │   ├── filters/                 # Exception Filters: Domain, Application,
│   │   │                            # Infrastructure, AllExceptions
│   │   ├── interceptors/            # DateSerializerInterceptor (ISO 8601 com timezone),
│   │   │                            # RequestContextInterceptor (handler → contexto de log)
│   │   ├── pipes/                   # SanitizeStringsPipe (global, antes do ValidationPipe)
│   │   ├── validators/              # IsValidCpfCnpj (adapter class-validator)
│   │   └── common/dto/              # PaginationDto, PaginatedResponseDto compartilhados
│   ├── persistence/prisma/          # PrismaService + PrismaModule (singleton de conexão)
│   │   ├── repositories/            # Implementações Prisma (7 repositórios, outbox e Saga incluídos) + PrismaUnitOfWork +
│   │   │                            # RepositoriesModule (@Global) — única pasta a importar @generated/client
│   │   ├── mappers/                 # Conversão Prisma model → Entidade de domínio (8 mappers)
│   │   └── helpers/                 # Helpers de paginação, existência e ordenação (Prisma)
│   ├── logging/                     # LoggingModule (@Global) + PinoLoggerAdapter,
│   │   │                            # logger.config (config + trust proxy),
│   │   │                            # field-registry (campos lógicos → chaves físicas +
│   │   │                            #   dicionário derivado),
│   │   │                            # technical-event.catalog, access-log.builder
│   │   │                            #   (atributos HTTP + desfecho + resolvedor de nível),
│   │   │                            # url-attributes (sanitizeUrlPath + buildQueryString),
│   │   │                            # http-error-message (404 do framework + detalhe de validação),
│   │   │                            # request-log-context, error-serializer,
│   │   │                            # log-record-normalizer, logging-diagnostics,
│   │   │                            # http-failure.recorder, process-lifecycle.service
│   │   └── redaction/               # field-classifier (tokenizador + regras),
│   │                                # pii-masker, text-sanitizer,
│   │                                # payload-sanitizer (valores E nomes de propriedade)
│   ├── telemetry/                   # TelemetryModule (@Global) + OtelMetricsAdapter,
│   │                                # metric-registry (lógico → físico + agregação),
│   │                                # span-request-attributes (sobrescreve url.path,
│   │                                #   client.address e user_agent.original; remove url.query),
│   │                                # incoming-request-filter (exclusão das probes),
│   │                                # telemetry-lifecycle.service (flush no encerramento),
│   │                                # telemetry-resource, telemetry-diagnostics
│   ├── services/                    # staff-token.constants (algoritmo do token
│   │                                # de funcionário)
│   └── exceptions/                  # InfrastructureException, AuthenticationFailedException,
│                                    # DatabaseOperationException, ServiceIntegrationException,
│                                    # ConcurrencyException
│
├── app.module.ts
├── otel.ts                          # preload (`node --require`): registra as instrumentações
│                                    # ANTES de express/pg serem carregados; sem endpoint,
│                                    # não registra nada
└── main.ts                          # bufferLogs + useLogger, configureApp(), shutdown hooks, listen

app/test/
├── helpers/                         # Mock factories reutilizáveis (incluindo
│                                    # UnitOfWorkMockFactory) e helpers de E2E
│                                    # (auth, db cleanup, test app bootstrap)
├── unit/                            # 174 suites de testes unitários (espelham src/)
│   ├── domain/                      # entities/, value-objects/, validators/
│   ├── application/use-cases/       # catalog, customer, customer-access, identity, me,
│   │                                # payment, quote-approval, service, vehicle,
│   │                                # work-order
│   ├── interface-adapters/          # Clean Controllers + Presenters por domínio
│   └── infrastructure/              # http/ (controllers, filters, interceptors, pipes,
│                                    # validators, auth), persistence/prisma, services
├── contracts/                       # Fixtures do contrato das rotas /internal deste
│                                    # serviço (internal-work-order.json e
│                                    # internal-user-customers.json) e cópias das do
│                                    # Inventory (inventory/), do Billing (billing/)
│                                    # e do Identity (identity/)
├── bdd/                             # Testes de aceitação em Gherkin pt-BR (Cucumber):
│                                    # features/ (fluxo completo e compensações),
│                                    # steps/ (passos por participante) e support/
│                                    # (World por cenário e serviço real subindo uma
│                                    # vez por execução)
└── e2e/                             # 14 suites de testes E2E (Testcontainers: PostgreSQL,
    │                                #   Valkey e LocalStack reais)
    ├── all-exceptions.filter.e2e-spec.ts
    ├── customer.e2e-spec.ts
    ├── customer-access.e2e-spec.ts
    ├── health.e2e-spec.ts
    ├── internal.e2e-spec.ts           # rotas /internal contra as fixtures
    ├── logging.e2e-spec.ts
    ├── me.e2e-spec.ts                 # /api/me/*: OS, orçamentos e cobranças
    │                                  # vinculados, decisão de orçamento
    ├── messaging.e2e-spec.ts          # outbox → SNS → SQS → handler, lock do relay
    ├── payment-saga.e2e-spec.ts       # Saga de cobrança pelo LocalStack: pagamento
    │                                  # aprovado, cobrança expirada e cobrança com a
    │                                  # OS já em execução
    ├── quote-approval-saga.e2e-spec.ts # Sagas de abertura e de aprovação e eventos de
    │                                  # orçamento pelo LocalStack, com stub do Billing
    ├── service.e2e-spec.ts            # métricas por serviço
    ├── telemetry.e2e-spec.ts
    ├── vehicle.e2e-spec.ts
    └── work-order.e2e-spec.ts

app/prisma.config.ts                 # Configuração do Prisma v7 (schema, migrations, seed e datasource)

app/prisma/
├── schema.prisma                    # Schema do banco (13 modelos, 7 enums)
├── migrations/                      # Migrations geradas pelo Prisma — inclui a sequence
│                                    # `work_order_number_seq` (números de OS),
│                                    # endurecimento de cascade deletes,
│                                    # versionamento (colunas `version`), índices e
│                                    # a remoção das FKs para `users`
├── generated/                       # Prisma Client gerado (output local)
├── seed.ts                          # Entry point do seed
└── seeds/                           # Scripts de seed por entidade (work-order-status-info,
                                     # customer, user-customer, vehicle, work-order)
                                     # + seed-ids (UUIDs canônicos, ver seed-ids.md)
```

## Modelos do banco de dados

13 modelos, cobrindo identidade/acesso, veículos, Ordem de Serviço, o estado das Sagas de aprovação e de cobrança e o outbox da mensageria. Diagrama entidade-relacionamento (com os tipos reais do Postgres), explicação tabela a tabela, enums e convenções de modelagem: ver [`docs/database.md`](database.md).

## DDD — Aggregate Roots, Entidades e Value Objects

O domínio é modelado seguindo princípios de DDD:

- **Aggregate Root** — `WorkOrder` é a raiz de agregado. Toda mutação de itens (serviços, peças/insumos), transições de status e cálculos de totais ocorrem **através** da raiz, que protege os invariantes do agregado.
  - `WorkOrder` encapsula seus `WorkOrderService[]` e `WorkOrderPartSupply[]`, controla as transições de status (state machine), recalcula `totalAmount`, guarda só o id do mecânico atribuído (quem confere que ele é um `MECHANIC` ativo é a `MechanicAssignmentPolicy`, no Identity, antes da escrita) e aplica os itens do orçamento aprovado no Billing (`applyApprovedItems`). Os serviços iniciam/finalizam pela raiz (`startServiceItem` / `completeServiceItem`), que promove a OS para `IN_PROGRESS` no primeiro `start` e para `COMPLETED` quando todos os serviços estão concluídos. O bloqueio pela cobrança também passa por ela: `holdForPayment()` leva a OS a `AWAITING_PAYMENT` e `releasePaymentHold(origem)` a devolve ao status de antes, sem mexer nas datas de aprovação, início, conclusão e entrega (ver [Saga de cobrança](#saga-de-cobrança)).
- **Entidades** — `Customer`, `Vehicle`, `UserCustomer`, `StatusHistory`, `SagaInstance`, `WorkOrderService`, `WorkOrderPartSupply`. Possuem identidade própria, estado mutável e validações de invariantes nos próprios métodos (`complete`, `compensate`, etc.). Serviços, peças e usuários não são entidades deste serviço: os itens guardam só o id, a quantidade e o preço, e o catálogo é do Inventory; a OS, o histórico e os vínculos guardam só o id do usuário, e o usuário é do Identity, o serviço da solução dono dos usuários e das credenciais. Orçamentos também não: são do Billing (ver [Orçamentos no Billing](#orçamentos-no-billing)).
- **Value Objects** — imutáveis, sem identidade, validados na criação:
  - `Document` (CPF ou CNPJ com dígito verificador), `Email`, `Phone`, `Plate` (placa antiga `ABC-1234` ou Mercosul `ABC1D23` — sanitizada para maiúsculas e sem hífen), `ZipCode`, `Address`, `LineItemPrice` (quantidade × preço unitário com cálculo de total), `WorkOrderNumber` (número da OS validado e normalizado com zero-padding para o comprimento mínimo).
- **Reconstituição** — todas as entidades expõem `static create(...)` (com validações completas) e `static reconstitute(...)` (rehidratação a partir do banco, sem revalidar dados já persistidos). Os mappers da infraestrutura sempre usam `reconstitute`, evitando o custo de revalidar dados já consistentes e permitindo carregar agregados em estados intermediários (ex.: `APPROVED` ou `IN_PROGRESS`) que `create` não autorizaria.
- **Enriquecimento de entidades** — relações expostas em consultas usam **referências completas** (`wo.customer`, `wo.vehicle`) carregadas via Prisma `include`. Os dados de exibição dos itens e os usuários não são relação: o Clean Controller lê os itens no Inventory (`FindCatalogItemsUseCase`) e o mecânico atribuído e os autores do histórico no Identity (`FindUsersByIdsUseCase`), e os entrega ao presenter junto com o agregado. Os presenters projetam os campos necessários para o cliente HTTP.

## Concorrência otimista

O agregado exposto a operações concorrentes (`WorkOrder`) possui uma coluna `version` (Int) usada como **lock otimista**. Toda atualização verifica `WHERE id = ? AND version = ?` e incrementa a versão. Quando o Prisma retorna o erro `P2025` (registro não encontrado para o filtro), a infraestrutura traduz para uma `ConcurrencyException`, que o filtro de exceções mapeia para **HTTP 409 Conflict**, instruindo o cliente a tentar novamente.

Esse mecanismo protege a atualização de status da OS e os passos das Sagas, que gravam a OS com a versão antes de gravar uma mensagem no outbox: duas transações sobre a mesma OS não passam as duas, e a ordem das mensagens dela segue a dos commits (ver [Outbox e relay](#outbox-e-relay)).

## Perfis de usuário (RBAC)

A **autenticação** é negada por padrão: o `AuthenticationGuard` (`infrastructure/http/guards/authentication.guard.ts`) é registrado como `APP_GUARD` e roda em toda rota. Sem marcação, a rota exige o token de funcionário (`JwtAuthGuard`); `@Public()` dispensa o token; `@CustomerArea()` exige o token do Cliente da Oficina (`CustomerJwtAuthGuard`). Uma rota nova sem marcação nasce protegida, e esquecer o guard deixa de abrir a rota. `@Public()` marca, por classe, só as rotas de saúde e as rotas `/internal` (ver [Chamadas internas](#chamadas-internas)): o login, o refresh e a redefinição de senha, as rotas públicas de autenticação, ficam no Identity.

A **autorização interna** é por papel, via `RolesGuard` + decorator `@Roles(...)`, aplicada **por controller** (`@UseGuards(RolesGuard)` na classe). O `RolesGuard` roda depois do guard global, com o `req.user` já preenchido.

| Perfil | Permissões |
|---|---|
| `ADMIN` | Acesso completo (clientes, veículos, OS, métricas por serviço, concessão/revogação de acesso externo) |
| `MECHANIC` | Operação de OS, atualização de status de serviço |
| `ATTENDANT` | Cadastro de clientes/veículos, criação e gestão de OS, concessão/revogação de acesso externo |

As permissões sobre o catálogo de serviços e peças e sobre o estoque são do Inventory, as sobre orçamentos, do Billing, e as de cadastro de usuários, do Identity, donos dessas rotas.

O **Cliente da Oficina** (usuário externo) não tem `role` no sentido RBAC — `UserRole` continua com apenas `ADMIN`/`MECHANIC`/`ATTENDANT`, papéis de dentro da oficina. Suas rotas (`/api/me/*`) usam um guard e uma política de autorização completamente separados — ver a seção seguinte.

## Identidade externa, autenticação e autorização por vínculo

Três conceitos que o modelo mantém deliberadamente separados:

- **Usuário** — identidade com credenciais (e-mail, CPF e senha), guardada no Identity, o serviço da solução dono dos usuários. Um usuário pode ter um papel interno (`ADMIN`, `MECHANIC` ou `ATTENDANT`), vínculos externos com um ou mais `Customer`, os dois ao mesmo tempo, ou nenhum dos dois ainda. Este serviço guarda só o id dele e lê nome, e-mail, papel e status no Identity por `GET /internal/users/:id` (ver [Chamadas internas](#chamadas-internas)).
- **`Customer`** — a parte comercial (pessoa física ou jurídica dona do veículo/OS). Nunca tem credencial própria; uma empresa (`CustomerType.COMPANY`) nunca loga diretamente.
- **`UserCustomer`** — o vínculo (many-to-many) que autoriza um usuário a agir em nome de um `Customer`, guardado aqui com o id do usuário. Não existe um campo `accessType`: a semântica (acesso à própria pessoa física vs. representação de uma empresa) deriva de `Customer.type`.

Dois fluxos de autenticação totalmente isolados, cada um com sua própria estratégia Passport, chave pública, emissor e audiência, nunca um verificador compartilhado. Este serviço não emite token nenhum: só valida, com as chaves públicas.

| | Interno (funcionários) | Externo (Cliente da Oficina) |
|---|---|---|
| Estratégia Passport | `jwt` (`JwtStrategy`) | `customer-jwt` (`CustomerJwtStrategy`) |
| Algoritmo | RS256 (`algorithms: ['RS256']`) | RS256 (`algorithms: ['RS256']`) |
| Chave | `STAFF_JWT_PUBLIC_KEY`, com o `kid` conferido contra `STAFF_JWT_KEY_ID`; as privadas ficam no Identity | `CUSTOMER_JWT_PUBLIC_KEY`; a privada fica na customer-auth, a função Lambda de login do cliente |
| Emissor do token | `POST /api/auth/login` do Identity, com `iss = oficina-identity` e `aud = oficina-services` | customer-auth, autenticando por CPF + senha |
| Guard HTTP (escolhido pelo `AuthenticationGuard`) | `JwtAuthGuard` (rota sem marcação) | `CustomerJwtAuthGuard` (`@CustomerArea()`) |
| O que é conferido | Assinatura, `iss`, `aud`, `exp`, `kid`, `typ = access` e as claims `sub` (um UUID), `email` e `role` (papel conhecido); o usuário não é lido em lugar nenhum | Assinatura, `iss`, `aud`, `exp`, o `sub` como UUID e, no banco deste serviço, se o `sub` tem ao menos um vínculo com cliente ativo |
| Carrega `role`/`customerId` no payload? | `role`, sim (com `sub`, `email`, `name` e `typ = access`) | **Não** — só `sub` (o id do usuário) |

O principal de funcionário sai inteiro das claims: o token é confiável pela assinatura do Identity, e reler o usuário custaria uma chamada ao Identity por requisição. A consequência aceita é a janela de revogação: um funcionário desativado ou que trocou a senha continua com o access que já tem até ele expirar, em até 10 minutos; o Identity recusa o refresh na hora. O token de cliente também não é relido no Identity: um usuário de cliente desativado ou com a senha trocada continua com o token que já tem até ele expirar, em até 60 minutos. As janelas estão em [Segurança](security.md#janelas-de-revogação-aceitas).

Diagrama de sequência da autenticação do cliente e da primeira chamada autenticada: ver [`docs/sequence-diagrams.md`](sequence-diagrams.md#autenticação-externa-do-cliente-da-oficina-cpf).

**A autorização externa é resolvida a cada requisição, nunca embutida no JWT.** O token externo carrega apenas o id do usuário (`sub`); nenhuma rota `/api/me/*` confia em um `customerId` do payload. `CustomerJwtStrategy.validate()` rejeita o principal sem nenhum vínculo com cliente ativo (`findActiveCustomerIdsByUserId`), e a `CustomerAccessPolicy` (`application/policies/customer-access.policy.ts`) repete essa resolução em cada caso de uso de `/api/me/*` que precisa autorizar contra um recurso específico (`FindMyWorkOrderById`, `FindAllMyWorkOrders`, `FindMyWorkOrdersQuotes`, `FindMyQuoteById`, `DecideMyQuote`). Isso faz uma remoção de vínculo (`DELETE /customers/:id/users/:userId`) ou uma desativação de cliente (`PATCH /customers/:id`) valer **imediatamente**, sem precisar de lista de revogação de token.

**A política nunca lança 403.** `CustomerAccessPolicy.assertCustomerAuthorized` traduz recurso inexistente e recurso não autorizado para o **mesmo** `ResourceNotFoundException` (HTTP 404) — a rota nunca vira um oráculo de enumeração que revela se uma OS ou orçamento de outro cliente existe.

**Concessão de acesso.** `POST /customers/:customerId/users` confere o cliente ativo, pede ao Identity o usuário de acesso por `POST /internal/customer-users` (que o encontra pelo CPF ou o cria e envia a senha inicial por e-mail) e só então grava o vínculo com o id devolvido. Se a gravação do vínculo falhar depois de o Identity criar o usuário, repetir a concessão reaproveita o mesmo usuário pelo CPF.

Ver [ADR 0004](./adr/0004-autenticacao-de-clientes.md) e [ADR 0026](./adr/0026-usuarios-lidos-no-identity-sem-replica.md) para o raciocínio completo por trás dessas decisões.

## Unit of Work

Operações que tocam múltiplos repositórios são executadas dentro de uma transação Prisma gerenciada pelo contrato `IUnitOfWork`. O `PrismaUnitOfWork` injeta todos os repositórios já conectados à transação ativa em uma única callback (`executeTransaction(repos => ...)`), garantindo atomicidade.

Casos de uso transacionais incluem:

- **Criação de OS** — cria a OS + registra `StatusHistory` inicial. O mecânico atribuído é conferido no Identity e, com itens, o orçamento inicial é criado no Billing, os dois **antes** da transação (ver [Saga de abertura](#saga-de-abertura)): nenhuma chamada HTTP fica dentro dela.
- **Atualização de status de OS** (`PATCH /work-orders/:id`) — atualiza OS + registra histórico. Na entrega, o saldo é lido no Billing **antes** da transação (ver [Entrega com saldo zero](#entrega-com-saldo-zero)).
- **Atualização de status de serviço da OS** — atualiza item, eventualmente promove OS para `IN_PROGRESS` / `COMPLETED` e registra histórico. Na passagem a `IN_PROGRESS` de uma OS com peças, grava no outbox o comando `inventory.stock.consume`, que pede ao Inventory a baixa do estoque reservado.
- **Passos das Sagas de aprovação e de cobrança** — cada mensagem de uma Saga (ver [Aprovação de orçamento com reserva de estoque](#aprovação-de-orçamento-com-reserva-de-estoque) e [Saga de cobrança](#saga-de-cobrança)) é tratada numa transação que grava a Saga e, conforme o passo, a OS, o histórico e o comando no outbox.
- **Envio e rejeição de orçamento** — as mensagens `billing.quote.sent` e `billing.quote.rejected` movem a OS e registram o histórico numa transação; no envio, a mesma transação grava no outbox o e-mail ao cliente, com os destinatários lidos no Identity antes dela (ver [Fluxo do orçamento, do envio à aprovação](#fluxo-do-orçamento-do-envio-à-aprovação) e [E-mails ao cliente](#e-mails-ao-cliente)).

## Ciclo de vida da Ordem de Serviço

Diagrama de sequência da abertura de OS: ver [`docs/sequence-diagrams.md`](sequence-diagrams.md#abertura-de-ordem-de-serviço).

Transições permitidas (state machine validada no agregado `WorkOrder`):

| De | Transições permitidas |
|---|---|
| `RECEIVED` | `IN_DIAGNOSIS`, `CANCELLED` |
| `IN_DIAGNOSIS` | `AWAITING_APPROVAL`, `CANCELLED` |
| `AWAITING_APPROVAL` | `APPROVED`, `REJECTED`, `CANCELLED` |
| `REJECTED` | `AWAITING_APPROVAL` |
| `APPROVED` | `IN_PROGRESS`, `AWAITING_PAYMENT` |
| `AWAITING_PAYMENT` | `APPROVED`, `COMPLETED` (só o status de origem guardado na Saga de cobrança) |
| `IN_PROGRESS` | `COMPLETED` |
| `COMPLETED` | `DELIVERED`, `AWAITING_PAYMENT` |
| `DELIVERED` | (terminal) |
| `CANCELLED` | (terminal) |

Regras adicionais:

- `CANCELLED` exige `notes` no payload.
- Atualização de campos editáveis (`problemDescription`, `internalNotes`, `mileageAtService`, mecânico) só é permitida em `RECEIVED` ou `IN_DIAGNOSIS`.
- O endpoint `PATCH /work-orders/:id` aceita apenas as transições "operacionais" para `IN_DIAGNOSIS`, `CANCELLED` e `DELIVERED`: o DTO da rota (`@IsEnum`) recusa qualquer outro status com **400**, e o `UpdateWorkOrderStatusUseCase` repete a mesma lista para quem o chama fora da rota. As demais (`AWAITING_APPROVAL`, `APPROVED`, `REJECTED`, `AWAITING_PAYMENT`, `IN_PROGRESS`, `COMPLETED`) são disparadas como efeito colateral das mensagens do Billing e dos status de serviço.
- **`AWAITING_PAYMENT` só entra e sai pela Saga de cobrança** (`holdForPayment()` e `releasePaymentHold(origem)`). Nesse status, iniciar serviço, entregar e cancelar respondem **409** `Ordem de serviço aguardando pagamento: execução, entrega e cancelamento voltam a valer quando a cobrança for paga, expirar ou for cancelada`; concluir serviço responde o 409 da regra do item, porque nenhum item está em execução (a OS chega de `APPROVED`, com os itens pendentes, ou de `COMPLETED`, com os itens concluídos).
- A entrega (`COMPLETED` → `DELIVERED`) exige saldo zero no Billing (ver [Entrega com saldo zero](#entrega-com-saldo-zero)).
- Timestamps `approvedAt`, `rejectedAt`, `startedAt`, `finishedAt` e `deliveredAt` são preenchidos automaticamente pelo agregado quando o status correspondente é atingido. O bloqueio e a volta da cobrança não os mexem: a OS que volta a `APPROVED` mantém a data da aprovação do orçamento, e a que volta a `COMPLETED`, a da conclusão.
- Apenas mecânicos **ativos** podem ser atribuídos como `assignedUser`: a `MechanicAssignmentPolicy` lê o usuário no Identity antes da escrita, na criação e na atualização. Usuário que o Identity não conhece responde **404**, usuário que não é `MECHANIC` ou está inativo responde **409** e Identity fora do ar responde **503**, sem nada gravado.
- O número da OS é gerado por uma sequence PostgreSQL (`work_order_number_seq`) e formatado com 6 dígitos zero-padded (`000001`, `000002`, …).
- A listagem (`GET /work-orders`) aceita ordenação (`sort`) por `status` e/ou `createdAt`. Ao ordenar por `status`, a ordem segue a `priority` definida na tabela de referência `WorkOrderStatusInfo`, não a ordem alfabética: `RECEIVED` 1, `IN_DIAGNOSIS` 2, `AWAITING_APPROVAL` 3, `REJECTED` 4, `APPROVED` 5, `AWAITING_PAYMENT` 6, `IN_PROGRESS` 7, `COMPLETED` 8, `DELIVERED` 9 e `CANCELLED` 10. Padrão: `status:desc,createdAt:asc`, sem as OS em `COMPLETED`, `DELIVERED` e `CANCELLED`; uma OS aguardando o pagamento aparece entre as em execução e as aprovadas, venha ela de `APPROVED` ou de `COMPLETED`.

## Orçamentos no Billing

Os orçamentos são do **Billing**, o serviço da solução dono dos orçamentos e dos pagamentos ([`oficina-mecanica-billing-service`](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service)). Criação, itens, envio, aprovação, rejeição e o ciclo de vida do orçamento (`PENDING` → `SENT` → `APPROVED` ou `REJECTED`) ficam lá, e o API Gateway encaminha ao Billing `/api/quotes` e `GET /api/work-orders/{id}/quotes`. Este serviço não grava orçamento. Ele:

- abre a OS com o orçamento inicial criado no Billing ([Saga de abertura](#saga-de-abertura));
- reage às mensagens que o Billing publica quando um orçamento é enviado, rejeitado ou aprovado, movendo a OS ([Fluxo do orçamento, do envio à aprovação](#fluxo-do-orçamento-do-envio-à-aprovação));
- orquestra a aprovação, que reserva o estoque no Inventory e, se a reserva falhar, pede ao Billing que desfaça a aprovação ([Aprovação de orçamento com reserva de estoque](#aprovação-de-orçamento-com-reserva-de-estoque));
- bloqueia a OS enquanto o cliente paga uma cobrança criada no Billing e pede o cancelamento dela quando a OS já não pode ser cobrada ([Saga de cobrança](#saga-de-cobrança));
- confere o saldo no Billing antes de entregar a OS ([Entrega com saldo zero](#entrega-com-saldo-zero));
- serve os orçamentos e as cobranças na área do Cliente da Oficina, lendo-os no Billing e repassando a decisão do orçamento a ele ([Orçamentos e cobranças na área do Cliente da Oficina](#orçamentos-e-cobranças-na-área-do-cliente-da-oficina)).

Do orçamento, a OS guarda só os itens aprovados (id, quantidade e preço), materializados quando ela vai a `APPROVED`. Das cobranças, nada: o saldo e a lista de cobranças são lidos no Billing quando alguém precisa deles.

Os três fluxos que gravam neste serviço e no Billing são **Sagas**: uma sequência de transações locais, cada uma num serviço, ligadas por chamadas ou mensagens, em que a falha de um passo dispara um passo de **compensação** que desfaz o que os anteriores gravaram. Este serviço orquestra as três: a de abertura, a de aprovação e a de cobrança. A decisão e as alternativas descartadas estão no [ADR 0025](adr/0025-sagas-orquestradas-no-work-order.md).

## Saga de abertura

`POST /api/work-orders` com algum item (serviço ou peça) grava o orçamento inicial no Billing e a OS aqui. O `CreateWorkOrderUseCase` segue quatro passos:

1. valida cliente e veículo no próprio banco, confere no Identity que o mecânico atribuído é um `MECHANIC` ativo (pela `MechanicAssignmentPolicy`; Identity fora do ar responde 503) e gera o id da OS (UUID), fora de transação;
2. cria o orçamento no Billing por `IBillingQuotesGateway.createInitialQuote` (`POST /internal/quotes`, com o id da OS e os itens), com prazo de 5 s, porque o Billing lê o catálogo no Inventory antes de responder. O Billing valida e precifica os itens e devolve o orçamento `PENDING`; uma recusa dele (peças sem serviço, item repetido ou desconhecido) volta ao chamador com o mesmo status, e nada foi gravado aqui;
3. abre a transação que aloca o número da OS e grava a OS `RECEIVED` com o histórico inicial;
4. se essa transação falhar, apaga o orçamento (`deleteQuote`, `DELETE /internal/quotes/:id`, em que um `404` conta como já apagado) e relança o erro da gravação. Se a exclusão também falhar, o orçamento sem OS fica registrado no evento de log `work_order.opening.compensation_failed` (`warn`), com os ids do orçamento e da OS.

- **Por que o Billing primeiro:** o erro mais comum, um item inválido, não cria nada nem consome número de OS. Na ordem inversa, cada item inválido criaria e apagaria uma OS.
- **Sem estado persistido:** a Saga começa e termina na requisição, sem linha em `saga_instances`. Sobra um orçamento `PENDING` sem OS (órfão) se o processo cair entre o passo 2 e o 3, se o Billing gravar o orçamento e responder depois do prazo de 5 s (o work-order responde 503 sem conhecer o id do orçamento) ou se a exclusão de compensação falhar. O órfão não chega ao cliente nem às leituras por OS, mas aparece na listagem de orçamentos dos funcionários no Billing (`GET /api/quotes`) com `workOrder: null`, porque o work-order não conhece aquela OS, e o Billing registra o evento de log `quote.work_order_missing`.
- **Sem itens**, a OS é aberta sem chamar o Billing.

A decisão e as alternativas descartadas estão no [ADR 0024](adr/0024-saga-de-abertura-com-orcamento-inicial-no-billing.md); o diagrama, em [`docs/sequence-diagrams.md`](sequence-diagrams.md).

## Aprovação de orçamento com reserva de estoque

A aprovação é síncrona no Billing: pela rota do funcionário ou pela decisão do cliente repassada por este serviço, o Billing responde `200`, marca o orçamento `APPROVED`, rejeita os outros orçamentos `PENDING` e `SENT` da OS e grava no outbox dele a mensagem `billing.quote.approved`, com os itens (ids, quantidades e preços) e o total. A OS só pode ir a `APPROVED` com as peças reservadas no Inventory, e a reserva pode falhar depois de o Billing gravar a aprovação. Por isso a aprovação é a **Saga de aprovação**, orquestrada por este serviço, com o estado em `saga_instances`: uma linha `QUOTE_APPROVAL` por orçamento, com `correlation_id` igual ao id dele, única junto com o tipo (ver [Banco de Dados](database.md#sagas)).

Cada mensagem é tratada por um caso de uso de `application/use-cases/quote-approval/` (portas em `application/ports/input/quote-approval/`), registrado no `QuoteApprovalMessageHandlers` de `infrastructure/messaging/handlers/quote-approval/`. Cada passo roda numa transação que grava a Saga e, conforme o passo, a OS com a `version` (o que ordena as mensagens dela no outbox), o histórico e o comando no outbox:

| Mensagem que chega | Situação | O que o work-order faz | Caso de uso |
|---|---|---|---|
| `billing.quote.approved` | OS em `AWAITING_APPROVAL`, orçamento com peças | Cria a Saga em `RESERVING_STOCK` e manda `inventory.stock.reserve` (`{ quoteId, items: [{ partSupplyId, quantity }] }`) | `StartQuoteApprovalUseCase` |
| `billing.quote.approved` | OS em `AWAITING_APPROVAL`, orçamento sem peças | Leva a OS a `APPROVED` com os itens da mensagem e o histórico (autor `decidedBy`) e cria a Saga já `COMPLETED` | `StartQuoteApprovalUseCase` |
| `billing.quote.approved` | OS fora de `AWAITING_APPROVAL` (cancelada entre a decisão e a mensagem) | Cria a Saga em `COMPENSATING` com `failure_reason = WORK_ORDER_NOT_AWAITING` e manda `billing.quote.revert_approval` (`{ quoteId, revertTo: 'REJECTED' }`) | `StartQuoteApprovalUseCase` |
| `billing.quote.approved` | Saga do orçamento `COMPENSATED` por `INSUFFICIENT_STOCK` (reaprovação) | Reabre a mesma linha, pelas mesmas regras das três linhas acima: `RESERVING_STOCK` e reserva de novo, ou `COMPENSATING` com `revertTo = REJECTED` se a OS saiu de `AWAITING_APPROVAL` | `StartQuoteApprovalUseCase` |
| `inventory.stock.reserved` | Saga em `RESERVING_STOCK` | Lê o orçamento aprovado no Billing (`GET /internal/quotes/:id`, 5 s), leva a OS a `APPROVED` com os itens e o total dele, grava o histórico com o autor `decidedBy` e marca a Saga `COMPLETED` | `CompleteQuoteApprovalUseCase` |
| `inventory.stock.reservation_failed` | Saga em `RESERVING_STOCK` | Saga vai a `COMPENSATING` com `failure_reason = INSUFFICIENT_STOCK` e manda `billing.quote.revert_approval` (`revertTo = 'SENT'`) | `CompensateQuoteApprovalUseCase` |
| `billing.quote.approval_reverted` | Saga em `COMPENSATING` | Saga vai a `COMPENSATED`; o histórico da OS ganha uma entrada com o mesmo status de entrada e saída e a nota do motivo; com falta de estoque, grava no outbox o e-mail ao cliente | `ConfirmQuoteApprovalReversalUseCase` |
| Qualquer mensagem acima | Outra combinação (mensagem repetida ou fora de hora) | Registra `saga.step_skipped` e confirma a mensagem, sem efeito | — |

- **Idempotência:** a unicidade de `(QUOTE_APPROVAL, quoteId)` é o que torna `billing.quote.approved` idempotente. Uma reentrega depois de a OS ir a `APPROVED` encontra a Saga `COMPLETED` e é ignorada; sem a linha, ela veria a OS fora de `AWAITING_APPROVAL` e reverteria um orçamento válido. Por isso a aprovação sem peças também grava a Saga. A única linha reaberta é a compensada por falta de estoque: o orçamento voltou a `SENT`, então um novo `billing.quote.approved` é uma nova aprovação.
- **Billing fora do ar na reserva confirmada:** a leitura do orçamento falha, o handler lança e a mensagem volta à fila, até ir para a DLQ (fila de mensagens mortas, de onde volta por redrive) na quinta entrega.
- **Notas do histórico na confirmação da reversão:** `Aprovação do orçamento <quoteId> desfeita por falta de estoque` ou `Aprovação do orçamento <quoteId> desfeita: a Ordem de Serviço não aguardava aprovação`. O e-mail da falta de estoque tem o assunto `Orçamento da Ordem de Serviço <número> - Estoque insuficiente` e diz que o orçamento voltou a aguardar aprovação (ver [E-mails ao cliente](#e-mails-ao-cliente)).
- **Cache:** os passos que mudam a OS (aprovação sem peças e reserva confirmada) apagam a chave dela no cache depois do commit. Os de compensação não mudam campo nem item da OS e não apagam nada.

**Bloqueios durante a Saga.** Uma Saga está **ativa** em `RESERVING_STOCK` ou `COMPENSATING`. Nesse intervalo a OS segue em `AWAITING_APPROVAL`, e cancelar a OS ou decidir outro orçamento pela área do cliente responde **409** `Ordem de serviço com aprovação de orçamento em andamento: aguarde a conclusão e tente novamente`. Criar, enviar e aprovar outro orçamento da OS são recusados pelo Billing (**409**), porque a OS já tem um orçamento `APPROVED`: um orçamento novo, enviado e rejeitado nessa janela levaria a OS a `REJECTED`, de onde a reserva confirmada não conseguiria levá-la a `APPROVED`. Depois da compensação por falta de estoque, o orçamento volta a `SENT` e a criação volta a valer.

**Histórico e métricas.** A entrada da compensação não muda o status e não gera amostra da métrica de permanência por status (`work_order.status.duration`). O cálculo da permanência ignora entradas que não mudam o status ao procurar quando a OS entrou em `AWAITING_APPROVAL`, para que uma compensação não encurte a medida.

**Baixa do estoque.** O Inventory guarda a reserva por OS. Quando o primeiro serviço de uma OS com peças é iniciado e a OS vai a `IN_PROGRESS`, a mesma transação grava no outbox o comando `inventory.stock.consume`, com o id da OS no envelope e payload vazio; o Inventory dá a baixa da reserva daquela OS.

Diagrama de sequência da aprovação, da reserva, da conclusão e da compensação: ver [`docs/sequence-diagrams.md`](sequence-diagrams.md#aprovação-de-orçamento-com-reserva-de-estoque).

## Fluxo do orçamento, do envio à aprovação

Três serviços guardam parte do estado de um orçamento: o **Billing** guarda o orçamento, o **Work Order** (este serviço) guarda a OS e a Saga de aprovação, e o **Inventory** guarda a reserva de estoque. Eles se falam por mensagens num tópico SNS FIFO, entregues em ordem por OS a cada serviço pela fila SQS FIFO dele (ver [Mensageria](#mensageria-cache-e-chamadas-internas)). As tabelas abaixo mostram, passo a passo, o estado de cada serviço depois do passo e a mensagem que leva ao passo seguinte. "—" é "não muda" ou "não existe".

**Envio e rejeição.**

| Passo | Orçamento (Billing) | OS (Work Order) | Mensagem seguinte |
|---|---|---|---|
| 1. Funcionário envia o orçamento (`POST /api/quotes/:id/submissions`, no Billing) | `SENT` | `IN_DIAGNOSIS` (ou `REJECTED`, ou já `AWAITING_APPROVAL`) | `billing.quote.sent` |
| 2. O handler aplica o envio (`ApplySentQuoteUseCase`) | `SENT` | `AWAITING_APPROVAL` (já estava, fica); e-mail ao cliente gravado no outbox | `notification.email.send` |
| 3. Funcionário ou cliente rejeita o orçamento | `REJECTED` | `AWAITING_APPROVAL` | `billing.quote.rejected` (com `remainingSentCount`, os orçamentos da OS ainda `SENT`) |
| 4. O handler aplica a rejeição (`ApplyRejectedQuoteUseCase`) | `REJECTED` | `REJECTED` se `remainingSentCount = 0`; senão `AWAITING_APPROVAL` | — |

O e-mail do envio vai aos usuários ativos vinculados ao cliente, lidos no Identity, ou, sem nenhum, ao e-mail do cliente, com uma linha por item e o total da mensagem (ver [E-mails ao cliente](#e-mails-ao-cliente)). Se a OS não está num status que aceita o passo (uma OS cancelada no intervalo, por exemplo), nada muda, nenhum e-mail sai, e o handler registra `quote_event.skipped` e confirma a mensagem.

**Aprovação com peças e estoque suficiente.**

| Passo | Orçamento (Billing) | OS (Work Order) | Saga (Work Order) | Reserva (Inventory) | Mensagem seguinte |
|---|---|---|---|---|---|
| 1. Aprovação no Billing (`200`) | `APPROVED`; os outros `PENDING` e `SENT` da OS ficam `REJECTED` | `AWAITING_APPROVAL` | — | — | `billing.quote.approved` |
| 2. Início da Saga | `APPROVED` | `AWAITING_APPROVAL` | `RESERVING_STOCK` | — | `inventory.stock.reserve` |
| 3. Reserva no Inventory, tudo ou nada | `APPROVED` | `AWAITING_APPROVAL` | `RESERVING_STOCK` | Reservada | `inventory.stock.reserved` |
| 4. Conclusão: lê o orçamento no Billing | `APPROVED` | `APPROVED`, com os itens e o total | `COMPLETED` | Reservada | — |

**Aprovação sem peças.** O passo 2 já leva a OS a `APPROVED` com os itens da própria mensagem e cria a Saga `COMPLETED`; não há reserva nem leitura no Billing.

**Falta de estoque (compensação).**

| Passo | Orçamento (Billing) | OS (Work Order) | Saga (Work Order) | Reserva (Inventory) | Mensagem seguinte |
|---|---|---|---|---|---|
| 1 e 2. Aprovação e início da Saga | `APPROVED` | `AWAITING_APPROVAL` | `RESERVING_STOCK` | — | `inventory.stock.reserve` |
| 3. O Inventory recusa a reserva | `APPROVED` | `AWAITING_APPROVAL` | `RESERVING_STOCK` | Nenhuma | `inventory.stock.reservation_failed` |
| 4. Pedido de compensação | `APPROVED` | `AWAITING_APPROVAL` | `COMPENSATING` (`INSUFFICIENT_STOCK`) | Nenhuma | `billing.quote.revert_approval` (`revertTo = SENT`) |
| 5. O Billing desfaz a aprovação | `SENT`; os rejeitados por ela voltam ao status anterior | `AWAITING_APPROVAL` | `COMPENSATING` | Nenhuma | `billing.quote.approval_reverted` |
| 6. Confirmação | `SENT` | `AWAITING_APPROVAL`, com a entrada `AWAITING_APPROVAL → AWAITING_APPROVAL` no histórico; e-mail ao cliente | `COMPENSATED` | Nenhuma | — |

**OS cancelada antes de `billing.quote.approved` chegar.**

| Passo | Orçamento (Billing) | OS (Work Order) | Saga (Work Order) | Mensagem seguinte |
|---|---|---|---|---|
| 1. Aprovação no Billing | `APPROVED` | `AWAITING_APPROVAL` | — | `billing.quote.approved` (ainda na fila) |
| 2. Funcionário cancela a OS (sem Saga ainda, o cancelamento passa) | `APPROVED` | `CANCELLED` | — | — |
| 3. Início da Saga vê a OS fora de `AWAITING_APPROVAL` | `APPROVED` | `CANCELLED` | `COMPENSATING` (`WORK_ORDER_NOT_AWAITING`) | `billing.quote.revert_approval` (`revertTo = REJECTED`) |
| 4. O Billing desfaz a aprovação | `REJECTED` | `CANCELLED` | `COMPENSATING` | `billing.quote.approval_reverted` |
| 5. Confirmação | `REJECTED` | `CANCELLED`, com a entrada `CANCELLED → CANCELLED` no histórico; sem e-mail | `COMPENSATED` | — |

### Por que a OS fica em `AWAITING_APPROVAL` durante a Saga

A OS só vai a `APPROVED` quando o estoque está reservado, porque `APPROVED` libera a execução, e a execução consome as peças. Enquanto a Saga corre, a OS continua aguardando aprovação, que é o que ela de fato está fazendo. Por isso a compensação não muda o status da OS: não há status da OS a desfazer. O que se desfaz é o orçamento no Billing, por `billing.quote.revert_approval`: `revertTo = SENT` devolve o orçamento ao cliente para uma nova aprovação depois que o estoque for reposto, e `revertTo = REJECTED` fecha o orçamento de uma OS que já foi cancelada. A entrada de histórico com o mesmo status de entrada e saída (`AWAITING_APPROVAL → AWAITING_APPROVAL`) só registra a tentativa e o motivo, para quem lê o histórico da OS.

### Por que a compensação grava a OS sem mudá-la

O pedido de compensação e o início da Saga chamam `repos.workOrder.update` mesmo sem mudar nenhum campo da OS. A gravação só incrementa a `version` da linha, e é isso que importa: o `id` das linhas do outbox é atribuído no `INSERT`, não no `COMMIT`, e o relay publica por `id`. Gravando a OS com a `version` antes de gravar a mensagem, uma segunda transação sobre a mesma OS espera a primeira (ou é recusada pela `version`) e só gera o `id` depois, então a ordem das mensagens de cada OS é a ordem dos commits (ver [Outbox e relay](#outbox-e-relay)).

### Por que o envio e a rejeição não têm Saga, e a aprovação tem

Uma Saga é necessária quando um passo pode falhar depois de outro serviço já ter gravado, e esse outro serviço precisa desfazer o que gravou. O envio e a rejeição só propagam um fato que o Billing já decidiu: não há terceiro serviço, e nenhum passo deste serviço pode recusar o fato. Se a OS mudou no intervalo, o handler não age, e um orçamento enviado ou rejeitado numa OS cancelada é um estado coerente. Uma falha técnica (banco fora, por exemplo) faz a mensagem voltar à fila até a DLQ. Já a aprovação depende do Inventory, que pode recusar a reserva **depois** de o Billing gravar a aprovação; sem a compensação, ficaria um orçamento `APPROVED` numa OS que nunca pode ser executada.

### Reaprovação depois da falta de estoque

Depois da compensação, o orçamento está `SENT` de novo e o cliente pode aprová-lo quando o estoque for reposto. A nova aprovação publica outro `billing.quote.approved` do mesmo orçamento, e o `StartQuoteApprovalUseCase` encontra a Saga `COMPENSATED` por `INSUFFICIENT_STOCK`: em vez de ignorar a mensagem como repetida, ele **reabre a mesma linha**, que volta a `RESERVING_STOCK` e pede a reserva de novo. Se nesse meio-tempo a OS saiu de `AWAITING_APPROVAL`, a linha é reaberta em `COMPENSATING` com `revertTo = REJECTED`, como na OS cancelada acima, em vez de deixar um orçamento `APPROVED` numa OS cancelada.

### Como era no monolito, e o que mudou

Antes, este serviço era dono dos orçamentos: o agregado `Quote`, com itens e totais, ficava no banco dele, e criação, envio (com o e-mail dentro da transação), aprovação e rejeição eram casos de uso daqui. A aprovação gravava o orçamento `APPROVED` e rejeitava os irmãos localmente, e a falta de estoque desfazia tudo no próprio banco: `Quote.revertApproval()` devolvia o orçamento a `SENT` e `undoRejectionByApproval()` restaurava os rejeitados, numa transação só.

Agora:

- o orçamento e o ciclo de vida dele estão no Billing, e este serviço não grava orçamento;
- a abertura com itens cria o orçamento inicial no Billing antes de gravar a OS, com exclusão de compensação;
- o envio e a rejeição chegam por mensagem, e o e-mail do envio é uma mensagem gravada no outbox na mesma transação, enviada pela função serverless de notificação: uma falha no envio não desfaz o passo;
- a aprovação começa no Billing, e a compensação é um comando ao Billing (`billing.quote.revert_approval`), confirmado por `billing.quote.approval_reverted`; a Saga ganhou o estado `COMPENSATING` para esperar essa confirmação;
- os itens aprovados são lidos no Billing na conclusão da reserva, porque a resposta do Inventory só traz o id do orçamento;
- a área do cliente lê os orçamentos no Billing e repassa a decisão a ele.

## Saga de cobrança

O pagamento é do Billing. O funcionário cria uma **cobrança** de uma OS em `APPROVED` (um sinal, antes da execução) ou em `COMPLETED` (o restante, antes da entrega) pela rota `POST /api/payments` do Billing. O Billing cria a ordem de pagamento no Mercado Pago, o provedor de pagamento da solução, grava a cobrança `PENDING` e publica `billing.payment.requested`, com o id da cobrança (`paymentId`), o valor, o link do Checkout Pro (a página de pagamento do Mercado Pago, que não pede login) e a validade do link. Este serviço reage bloqueando a OS em `AWAITING_PAYMENT` até o pagamento terminar.

**Por que é uma Saga.** A cobrança grava em dois serviços: o Billing grava a cobrança e a ordem no Mercado Pago, e este serviço grava o bloqueio da OS. O passo daqui pode falhar depois de o Billing gravar: entre a criação da cobrança e a chegada da mensagem, outro funcionário pode ter iniciado a execução, e uma OS em `IN_PROGRESS` não pode mais ir a `AWAITING_PAYMENT`. Sem compensação, a cobrança ficaria pendente, o cliente não receberia o link (o e-mail é pedido por este serviço) e o sinal, que deveria segurar a execução, não seguraria nada. A compensação cancela a cobrança no Billing. Quando é o pagamento que não acontece (o link expirou, o Mercado Pago recusou ou o funcionário cancelou a cobrança), a compensação é devolver a OS ao status de antes do bloqueio.

O estado fica em `saga_instances`, numa linha `PAYMENT` por cobrança, com `correlation_id` igual ao `paymentId`, única junto com o tipo, e `origin_status` com o status da OS antes do bloqueio (`APPROVED` ou `COMPLETED`), para onde ela volta (ver [Banco de Dados](database.md#sagas)). A origem é guardada porque nenhuma outra fonte a informa: o Billing não sabe de onde a OS veio, e o histórico da OS pode ganhar outras entradas.

Cada mensagem é tratada por um caso de uso de `application/use-cases/payment/` (portas em `application/ports/input/payment/`), registrado no `PaymentMessageHandlers` de `infrastructure/messaging/handlers/payment/`. Cada passo roda numa transação que grava a Saga e, conforme o passo, a OS com a `version`, o histórico e o comando no outbox:

| Mensagem que chega | Situação | O que o work-order faz | Caso de uso |
|---|---|---|---|
| `billing.payment.requested` | OS em `APPROVED` ou `COMPLETED` | Cria a Saga em `AWAITING_PAYMENT` com o status de origem, leva a OS a `AWAITING_PAYMENT`, grava o histórico e grava no outbox o e-mail com o link | `StartPaymentUseCase` |
| `billing.payment.requested` | OS em outro status (execução iniciada no intervalo, por exemplo) | Cria a Saga em `COMPENSATING` com `failure_reason = WORK_ORDER_NOT_PAYABLE` e manda `billing.payment.cancel` (`{ paymentId, reason: 'WORK_ORDER_NOT_PAYABLE' }`); a OS não muda e nenhum e-mail sai | `StartPaymentUseCase` |
| `billing.payment.approved` | Saga em `AWAITING_PAYMENT` | Devolve a OS à origem, grava o histórico e marca a Saga `COMPLETED` | `ApplyPaymentResultUseCase` |
| `billing.payment.failed` | Saga em `AWAITING_PAYMENT` | Devolve a OS à origem, grava o histórico e marca a Saga `COMPENSATED` com o motivo pelo `reason` da mensagem: `EXPIRED` → `PAYMENT_EXPIRED`, `REJECTED` → `PAYMENT_REJECTED`, `CANCELLED` → `PAYMENT_CANCELLED` | `ApplyPaymentResultUseCase` |
| `billing.payment.failed` | Saga em `COMPENSATING` | Marca a Saga `COMPENSATED`, mantendo o motivo `WORK_ORDER_NOT_PAYABLE`; a OS não muda | `ApplyPaymentResultUseCase` |
| `billing.payment.approved` | Saga em `COMPENSATING` (o cliente pagou antes de o cancelamento chegar ao Mercado Pago) | Marca a Saga `COMPLETED`, mantendo o motivo; a OS não muda, e o valor pago entra no saldo do Billing | `ApplyPaymentResultUseCase` |
| Qualquer mensagem acima | Outra combinação (mensagem repetida, cobrança sem Saga ou Saga já encerrada) | Registra `saga.step_skipped` e confirma a mensagem, sem efeito | — |

- **Idempotência:** a unicidade de `(PAYMENT, paymentId)` torna `billing.payment.requested` idempotente. Uma reentrega encontra a Saga, em qualquer status, e é ignorada: não bloqueia de novo nem manda outro e-mail, mesmo que a OS já tenha voltado à origem. Um resultado repetido encontra a Saga encerrada e também é ignorado.
- **Envelope:** `billing.payment.requested` sem o id da OS no envelope é recusado (`Mensagem sem a ordem de serviço no envelope`) e vai para a DLQ. `billing.payment.approved` e `billing.payment.failed` não precisam dele: a Saga é encontrada pelo `paymentId`.
- **Histórico:** a mensagem não diz quem criou a cobrança, então as entradas do bloqueio e da volta ficam sem autor, com uma nota que identifica a cobrança e o desfecho: `Aguardando o pagamento da cobrança <paymentId>` no bloqueio, e `Cobrança <paymentId> paga`, `expirada`, `recusada` ou `cancelada` na volta.
- **E-mail do link:** vai aos mesmos destinatários do e-mail do orçamento: os usuários ativos vinculados ao cliente, lidos no Identity, ou, sem nenhum, o e-mail do cliente. O assunto é `Pagamento da Ordem de Serviço <número>`, e o texto traz o valor, o link e a validade no fuso de São Paulo. Ele é gravado no outbox na mesma transação do bloqueio, e uma falha no envio não desfaz o bloqueio (ver [E-mails ao cliente](#e-mails-ao-cliente)).
- **Ordem das mensagens:** a compensação grava a OS com a `version` mesmo sem mudá-la, antes de gravar `billing.payment.cancel` no outbox, pelo mesmo motivo da Saga de aprovação (ver [Por que a compensação grava a OS sem mudá-la](#por-que-a-compensação-grava-a-os-sem-mudá-la)).
- **Cache:** o bloqueio e a volta apagam a chave da OS no cache depois do commit; o pedido e o fim da compensação não mudam a OS e não apagam nada.

**Sinal e restante** usam a mesma Saga, uma linha por cobrança:

| Cobrança | Caminho da OS |
|---|---|
| Sinal | `APPROVED` → `AWAITING_PAYMENT` → paga → `APPROVED` → execução |
| Restante | `COMPLETED` → `AWAITING_PAYMENT` → paga → `COMPLETED` → entrega com saldo zero |
| Cobrança total, sem sinal | Uma só cobrança, criada com a OS em `APPROVED` ou em `COMPLETED` |

**Cancelar a cobrança.** Uma OS parada em `AWAITING_PAYMENT` (o cliente não pagou, ou o aviso do Mercado Pago não chegou) volta quando o funcionário cancela a cobrança no Billing (`POST /api/payments/:id/cancellations`): o Billing publica `billing.payment.failed` com `CANCELLED`, e a OS volta à origem. Iniciar a execução, entregar e cancelar a OS ficam bloqueados enquanto ela aguarda o pagamento, com a mensagem de [Ciclo de vida da Ordem de Serviço](#ciclo-de-vida-da-ordem-de-serviço).

**Histórico e métricas.** A volta de `AWAITING_PAYMENT` grava outra entrada no status de origem. A permanência em `AWAITING_PAYMENT` é medida como a de qualquer status com saída, e o total "diagnóstico até conclusão" só é medido na primeira entrada em `COMPLETED`, para que a volta da cobrança do restante não o registre de novo, maior (ver [Observabilidade](observability.md#métricas-de-negócio)).

### Entrega com saldo zero

O `UpdateWorkOrderStatusUseCase`, ao receber `DELIVERED`, lê a OS antes de abrir a transação. Só se ela pode ir a `DELIVERED` (está em `COMPLETED`), ele consulta o saldo no Billing pelo `IBillingPaymentsGateway` (`GET /internal/work-orders/:workOrderId/balance`, prazo padrão de 2 s), que devolve o total aprovado, o total pago e o saldo, como texto decimal (`"400.00"`):

| Situação | Resposta |
|---|---|
| Saldo maior que zero | **409** `Ordem de serviço com saldo a pagar de R$ <saldo>: a entrega é liberada depois que o saldo for quitado`; a OS segue em `COMPLETED` |
| Saldo zero | A OS vai a `DELIVERED` |
| Billing fora do ar ou sem resposta em 2 s | **503** `Serviço de destino indisponível`, sem entregar |
| OS fora de `COMPLETED` | O **409** da transição recusada, sem consultar o Billing |

A consulta fica fora da transação para não segurar uma conexão do banco durante a chamada HTTP. Ler a OS antes evita que uma OS em `RECEIVED`, por exemplo, receba "saldo a pagar" (ou 503 com o Billing fora) no lugar do 409 da transição.

Diagrama de sequência da cobrança paga, da cobrança com a OS já em execução e da cobrança expirada: ver [`docs/sequence-diagrams.md`](sequence-diagrams.md#saga-de-cobrança).

## Orçamentos e cobranças na área do Cliente da Oficina

O Cliente da Oficina se autentica por CPF e senha numa função serverless externa (ver [ADR 0004](./adr/0004-autenticacao-de-clientes.md)) e, com o token, consulta e decide os orçamentos das OS vinculadas a ele e consulta as cobranças delas. Os orçamentos vêm do Billing pelo `IBillingQuotesGateway` e as cobranças pelo `IBillingPaymentsGateway`, e a autorização por vínculo (`CustomerAccessPolicy`, ver [seção acima](#identidade-externa-autenticação-e-autorização-por-vínculo)) fica aqui, porque o vínculo entre usuário e cliente é deste serviço:

- **`GET /api/me/work-orders/:id/quotes`** (`FindMyWorkOrdersQuotesUseCase`) confere o vínculo com a OS e então lista os orçamentos dela no Billing (`GET /internal/work-orders/:workOrderId/quotes`, prazo padrão de 2 s: a listagem só devolve resumos, sem consultar o Inventory).
- **`GET /api/me/quotes/:id`** (`FindMyQuoteByIdUseCase`) lê antes o orçamento no Billing (`GET /internal/quotes/:id`, 5 s, porque o detalhe do Billing lê o catálogo no Inventory), já que só o Billing sabe a qual OS ele pertence, e então confere o vínculo.
- **`POST /api/me/quotes/:id/decisions`** (`DecideMyQuoteUseCase`) lê o orçamento da mesma forma, confere o vínculo, a OS em `AWAITING_APPROVAL` e a ausência de Saga ativa, e só então repassa a decisão (`POST /internal/quotes/:id/decisions`, 5 s, porque o Billing lê o catálogo antes de decidir), com o usuário autenticado como autor. Uma decisão recusada aqui nunca chega ao Billing.
- **`GET /api/me/work-orders/:id/payments`** (`FindMyWorkOrderPaymentsUseCase`) confere o vínculo com a OS e então lista as cobranças dela no Billing (`GET /internal/work-orders/:workOrderId/payments`, 2 s). Cada cobrança sai com valor, status, link de pagamento, validade e datas; os ids internos do Billing (`checkoutId`, `workOrderId`) não saem.

Sem vínculo, a resposta é **404**, e nada do orçamento ou da cobrança é devolvido nem repassado; o Billing nem é consultado. As respostas de cada desfecho estão em [Referência da API › Minha Conta](api.md#endpoints-disponíveis).

## Mensageria, cache e chamadas internas

O serviço conversa com os outros serviços da oficina por dois caminhos: **mensagens** assíncronas num tópico SNS FIFO (`oficina-events.fifo`), entregues a cada serviço pela própria fila SQS FIFO, e **chamadas REST internas** (`/internal/...`) pela rede do cluster. Cada serviço é o único cliente do próprio PostgreSQL e do próprio cache: nenhum lê o banco de outro.

### Outbox e relay

Uma mensagem nunca é publicada de dentro do caso de uso. Ela é gravada na tabela `outbox` pelo `IOutboxRepository` (`repos.outbox.add(message)`), dentro da **mesma transação** do Unit of Work que muda o estado: ou as duas escritas são confirmadas, ou nenhuma. Não há dupla escrita entre banco e broker.

- O tipo e o payload vêm do catálogo tipado e fechado de `domain/messaging/` (`inventory`, `billing` e `notification`). `OutboxMessage` é uma união discriminada por `type`: tipo fora do catálogo, ou payload de outro tipo, não compila.
- A linha guarda `id` sequencial (ordem de criação), `message_id` (UUID v4, a identidade da mensagem entre serviços), `type`, `work_order_id`, `payload` (`jsonb`), `trace_context` (o contexto W3C ativo no momento do `add`) e `created_at` (`timestamptz`). `work_order_id` tem FK `Restrict` para `work_orders`.
- **Ordem por OS depende do produtor.** O `id` é atribuído no `INSERT`, não no `COMMIT`. Se a transação A grava a mensagem `id 10` de uma OS, a transação B grava a `id 11` da mesma OS e as duas confirmam antes do próximo lote, o relay publica a `10` antes da `11`, mesmo que B tenha mudado o estado da OS primeiro. Por isso todo caso de uso que grava uma mensagem de uma OS atualiza a linha dela (com `version`) ou a trava (`SELECT … FOR UPDATE`) na mesma transação, **antes** do `add`: a segunda transação espera a primeira, ou é recusada pelo `version`, e só gera o `id` depois. Assim, a ordem dos `id` de cada OS é a ordem dos commits. Mensagem sem OS não tem ordem a preservar.
- O `OutboxRelayService` roda no próprio processo a cada 500 ms (um `setTimeout` rearmado ao fim de cada lote, então dois lotes nunca se sobrepõem). Cada lote abre uma transação e tenta `pg_try_advisory_xact_lock`: só uma réplica publica por vez, e as outras pulam a rodada em vez de esperar.
- Com o lock, o relay lê até **10 linhas** por `id`, publica uma a uma por `PublishCommand`, com o contexto de trace da linha restaurado, e apaga as publicadas na mesma transação. Ele **para no primeiro erro**, para não furar a ordem: a linha que falhou e as seguintes ficam para o próximo lote. Cada falha registra `messaging.outbox.publish_failed`. O lote tem de caber nos 5 s da transação interativa do Prisma, senão as exclusões são desfeitas e o mesmo início é republicado a cada rodada. Por isso cada `Publish` tem prazo de 2 s, sem retentativa do SDK (a retentativa é o próximo lote), e o relay não começa uma publicação depois de 2 s de lote: as que ficaram saem na rodada seguinte.
- A mensagem publicada leva o envelope `{ messageId, type, occurredAt, workOrderId, payload }`, o `MessageGroupId` igual ao `workOrderId` (ordem por OS; sem OS, o próprio `messageId`), o `MessageDeduplicationId` igual ao `messageId` e o atributo `type`, que as filter policies do tópico usam para rotear.
- No encerramento, o relay para no `beforeApplicationShutdown` e espera o lote em voo, antes de o Prisma desconectar.

### Consumo de mensagens

O `SqsConsumerService` lê a fila do serviço (`WORK_ORDER_QUEUE_NAME`, URL resolvida por `GetQueueUrl`) com `sqs-consumer`, em long polling de 20 s e **uma mensagem por vez** (`batchSize: 1`): com lote maior, a biblioteca processaria as mensagens em paralelo e furaria a ordem por OS.

Para cada mensagem, o consumidor:

1. extrai o contexto W3C dos atributos e abre um span `CONSUMER` (`process work-order.fifo`), a única instrumentação manual da aplicação (ver [Observabilidade](observability.md#consumo-de-mensagens));
2. valida o envelope (`MessageEnvelopeDto`, class-validator) e o payload, pela classe que todo handler declara ao se registrar. A classe é obrigatória: o payload vem de outro serviço, e o tipo TypeScript do catálogo não é conferido em execução. Uma classe sem campos declara payload vazio (`inventory.stock.consume`). A mensagem de erro leva só os nomes das propriedades, nunca valores;
3. procura o handler pelo `type` no `MessageHandlerRegistry`, que os módulos preenchem no `onModuleInit`, e o chama. Hoje são três grupos, cada um com as classes de payload em `dto/`: o `QuoteMessageHandlers` (`handlers/quote/`, composto pelo `QuoteMessagingModule`) trata `billing.quote.sent` e `billing.quote.rejected`; o `QuoteApprovalMessageHandlers` (`handlers/quote-approval/`, composto pelo `QuoteApprovalMessagingModule`) trata os passos da Saga de aprovação: `billing.quote.approved`, `inventory.stock.reserved`, `inventory.stock.reservation_failed` e `billing.quote.approval_reverted`; e o `PaymentMessageHandlers` (`handlers/payment/`, composto pelo `PaymentMessagingModule`) trata os passos da Saga de cobrança: `billing.payment.requested`, `billing.payment.approved` e `billing.payment.failed`. Uma mensagem de orçamento ou um pedido de cobrança sem o id da OS no envelope é recusado (`Mensagem sem a ordem de serviço no envelope`) e vai para a DLQ. Os valores em dinheiro dos payloads chegam como texto com duas casas decimais e são conferidos por esse formato antes de virar número; o link de pagamento precisa ser uma URL `http` ou `https`, e as datas, ISO 8601.

Toda linha de log desse processamento carrega `messaging.*`, `oficina.messaging.message.type`, `oficina.work_order.id` e `request.id` igual ao `messageId`, então as linhas de uma mensagem se correlacionam como as de uma requisição.

**A mensagem só é apagada da fila quando o handler termina sem erro.** Erro, envelope inválido ou tipo sem handler deixam a mensagem na fila, e o SQS a entrega de novo depois do visibility timeout. Tipo sem handler registra `messaging.message.unhandled` (`warn`): a fila só recebe os tipos que a filter policy roteia ao serviço, então chegar sem handler é uma janela de deploy, e confirmar perderia a mensagem. Na quinta entrega (`ApproximateReceiveCount` = 5, o `maxReceiveCount` da fila) o consumidor registra `messaging.message.dead_lettered` e o SQS move a mensagem para a DLQ (`work-order-dlq.fifo`), de onde ela volta por redrive. Os handlers devem ser idempotentes pelo `messageId`, porque o SQS entrega pelo menos uma vez.

Um recebimento com falha (SQS fora do ar, DNS, conexão recusada) pausa o próximo por 10 s (`RECEIVE_FAILURE_PAUSE_MS`, pelo `preReceiveMessageCallback` da biblioteca). Sozinha, a biblioteca só pausa em erro de credencial, fila inexistente ou throttling; nos outros, ela consulta de novo na hora, e um endpoint inalcançável gerava dezenas de linhas de erro por segundo. A pausa própria da biblioteca fica desligada (`authenticationErrorTimeout: 0`), para que a regra seja uma só e as duas não se somem. Falha de exclusão ou de processamento, que chega com a mensagem, não pausa.

No encerramento, o consumidor para no `beforeApplicationShutdown` com `stop({ abort: true })`, que cancela o long polling, e espera o evento `stopped`. O handler em voo tem 5 s para terminar. O `abort` também cancela o `DeleteMessage` de um handler que acabou de terminar: essa mensagem volta, e a idempotência por `messageId` a absorve. Os pedidos cancelados pelo encerramento não viram log de erro, e uma pausa em curso termina na hora. Fora dele, o cliente SQS tem prazo de 25 s por pedido, acima dos 20 s do long polling, para que uma conexão que não responde não trave o consumidor.

### E-mails ao cliente

Este serviço não envia e-mail. Os três e-mails ao cliente são mensagens `notification.email.send`, uma por destinatário, gravadas no outbox na mesma transação que muda a OS ou a Saga. O relay as publica no tópico, a filter policy do tópico as entrega à fila SQS `notification.fifo`, e quem as lê e envia o e-mail por SMTP é a função serverless de notificação da solução ([`oficina-mecanica-lambda-notification`](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-notification)).

| E-mail | Quando é gravado | `purpose` | Assunto | Caso de uso |
|---|---|---|---|---|
| Orçamento enviado | `billing.quote.sent` aplicado à OS | `quote_sent` | `Orçamento para Ordem de Serviço <número> - Aguardando sua aprovação` | `ApplySentQuoteUseCase` |
| Link de pagamento | `billing.payment.requested` bloqueia a OS em `AWAITING_PAYMENT` | `payment_link` | `Pagamento da Ordem de Serviço <número>` | `StartPaymentUseCase` |
| Falta de estoque | `billing.quote.approval_reverted` confirma a reversão de uma Saga de aprovação compensada por `INSUFFICIENT_STOCK` | `quote_approval_reverted` | `Orçamento da Ordem de Serviço <número> - Estoque insuficiente` | `ConfirmQuoteApprovalReversalUseCase` |

- **Destinatários:** antes da transação, o `CustomerEmailRecipientsResolver` (`application/services/`) lê o cliente e os ids dos usuários vinculados a ele, e busca esses usuários no Identity pelo `IIdentityUsersGateway` (`GET /internal/users/:id`). Recebem os usuários ativos. Sem nenhum, o e-mail vai ao e-mail do cadastro do cliente, e o do orçamento diz que ele ainda não tem acesso e deve pedir à oficina a criação do acesso.
- **Leitura única:** no orçamento enviado e no link de pagamento, o caso de uso lê a Saga e a OS uma vez, antes da transação, e decide o caminho com essa leitura. Só o caminho que grava o e-mail chama o resolvedor. A transação grava a OS com a `version` lida: se a OS mudou nesse meio-tempo, a gravação falha e a mensagem volta à fila, para ser decidida de novo. Duas mensagens da mesma OS não são processadas ao mesmo tempo, porque a fila entrega uma por OS por vez. Na reversão, os destinatários só são lidos quando a Saga está compensando por falta de estoque.
- **Identity fora do ar:** o passo que grava o e-mail falha antes de abrir a transação, sem nada gravado, e a mensagem que chegou volta à fila, até a DLQ na quinta entrega. O passo que não grava e-mail não consulta o Identity e segue normalmente: a entrega repetida, o `billing.quote.sent` de uma OS que não aceita mais o orçamento e o `billing.payment.requested` de uma OS que não aceita mais a cobrança, que pede o cancelamento ao Billing.
- **Conteúdo:** o `WorkOrderEmailComposer` (`application/notifications/`) monta o assunto, o texto e o HTML. No HTML, os valores que vêm de fora (nomes do destinatário e dos itens e o número da OS) são escapados, e o link de pagamento entra serializado como URL, para que nenhum deles injete marcação. O `purpose` é o rótulo do e-mail que a função de notificação registra no log, no lugar do assunto.
- **Por que pelo outbox:** o e-mail só é publicado se a mudança da OS foi confirmada, e toda mudança confirmada publica o e-mail. Uma falha no envio fica com a função de notificação, a fila e a DLQ dela, e não desfaz o passo deste serviço.
- **Ordem:** o passo grava a OS com a `version` antes de gravar o e-mail, mesmo quando ela já está em `AWAITING_APPROVAL` (envio repetido do orçamento e confirmação da reversão), pela regra da [ordem por OS](#outbox-e-relay).
- **Reentrega:** um `billing.quote.sent` reentregue com a OS já em `AWAITING_APPROVAL` grava o e-mail de novo; um `billing.payment.requested` reentregue encontra a Saga e não grava outro.

### Cache do detalhe da OS

O detalhe da OS (`GET /api/work-orders/:id` e `GET /internal/work-orders/:id`) usa **cache-aside** no Valkey (ElastiCache no cluster), pela porta `ICache` (`application/ports/output/`) e o `ValkeyCacheAdapter` sobre `ioredis`.

- **Chave e validade:** `work-order:work-order:<id>` (`workOrderCacheKey`), com TTL de `CACHE_TTL_SECONDS` (padrão 43.200 s, 12 h). Um valor que não seja inteiro maior que zero impede o boot: com ele, toda gravação no cache falharia.
- **Valor:** um snapshot JSON da OS montado pelo `WorkOrderCacheMapper`, com `cacheVersion`. O snapshot guarda só o id do mecânico atribuído: o Clean Controller lê o usuário no Identity a cada leitura, com ou sem acerto no cache, então o nome do mecânico não fica velho. Valor que não se lê (JSON inválido, campo que o domínio rejeita ou `cacheVersion` diferente do atual) conta como falta e é relido do banco e regravado. Assim, um valor gravado por outra versão do código não responde 500 depois de um deploy.
- **Invalidação depois da escrita:** os casos de uso que escrevem na OS (`UpdateWorkOrder`, `UpdateWorkOrderStatus`, `UpdateWorkOrderServiceStatus`, `ApplySentQuote`, `ApplyRejectedQuote`, `StartQuoteApproval`, `CompleteQuoteApproval`, `StartPayment` e `ApplyPaymentResult`), no cliente (`UpdateCustomer` e `UpdateCustomerStatus`) e no veículo (`UpdateVehicle`) apagam as chaves afetadas **depois** da escrita: os que usam transação (`UpdateWorkOrderStatus`, `UpdateWorkOrderServiceStatus` e os de orçamento e das Sagas, só quando o status da OS mudou) depois do commit, com o resultado devolvido do callback, como os eventos de negócio; os demais (`UpdateWorkOrder`, cliente e veículo) logo depois do `update` no repositório. Cliente e veículo buscam as próprias OS para saber quais chaves apagar, e fazem essa leitura **antes** da escrita: se ela falhar, a requisição falha sem ter gravado nada, em vez de responder erro depois de uma escrita confirmada. A exclusão de cliente e de veículo não invalida nada: ela só acontece quando nenhuma OS os referencia.
- **Itens de catálogo:** o snapshot guarda os itens só com id, quantidade, preço e status. Os dados de exibição (nome, descrição, SKU, unidade, categoria) não vão ao cache: o Clean Controller os lê no Inventory a cada leitura, com ou sem acerto no cache, então uma mudança no catálogo aparece na leitura seguinte. A compensação das Sagas que não muda a OS não apaga a chave, porque não muda campo nem item dela (só incrementa a `version`, que nenhuma resposta mostra).
- **Cache fora do ar vira leitura no banco**, nunca erro nem fila de espera: o cliente roda com `enableOfflineQueue: false`, `maxRetriesPerRequest: 1` e `commandTimeout` de 500 ms, para que um Valkey que aceita TCP e não responde também caia para o banco. Falha de leitura ou gravação registra `cache.unavailable` (`warn`) e a leitura conta como falta; falha de exclusão registra `cache.invalidation_failed` (`error`), e a chave expira pelo TTL.

A área do Cliente da Oficina (`/api/me/*`) não usa o cache.

### Chamadas internas

As rotas `/internal/...` atendem só outros serviços, pela rede do cluster. Elas ficam em `infrastructure/http/controllers/internal/`, **fora do prefixo `api`** (que é o que o API Gateway encaminha), marcadas com `@Public()` e fora do Swagger (`@ApiExcludeController`). Cada uma delega ao Clean Controller existente.

| Rota | Resposta |
|---|---|
| `GET /internal/work-orders/:id` | `200` com o mesmo corpo de `GET /api/work-orders/:id` (`{ data: { ... } }`), `400` para id que não é UUID, `404` para OS inexistente |
| `GET /internal/users/:userId/customers` | `200 { data: [{ id, name, type, document, isActive }] }`: os clientes ativos com vínculo com o usuário, lidos pelo Identity para montar o perfil de `GET /api/me`. Usuário sem vínculo responde lista vazia, nunca 404. `400` para id que não é UUID |

O dono de cada rota versiona a fixture da resposta em `app/test/contracts/`, conferida pelo próprio e2e (ver [Testes](testing.md#contrato-das-rotas-internal)).

Para chamar outro serviço, o caso de uso usa o gateway do dono (`application/ports/output/gateways/<dono>/`), implementado em `infrastructure/gateways/<dono>/` sobre o `InternalHttpClient`, que usa o `HttpService` do `@nestjs/axios`:

- envia o `x-request-id` do contexto atual (o da requisição HTTP ou, num handler de mensagem, o `messageId`). O `traceparent` é injetado pela instrumentação HTTP do OpenTelemetry, e a chamada aparece como span `CLIENT`;
- usa prazo de 2 s por padrão (`timeoutMs` muda o prazo de uma chamada), sem retentativa e sem seguir redirecionamento;
- converte o 4xx do serviço chamado em `ServiceRequestRejectedException`, que o filtro responde com o mesmo status e a mensagem do dono; timeout, falha de conexão e 5xx viram `ServiceIntegrationException` (503).

São quatro gateways. O do catálogo do Inventory é o `IInventoryCatalogGateway` (`application/ports/output/gateways/inventory/`), implementado pelo `HttpInventoryCatalogGateway` (`infrastructure/gateways/inventory/`) com o endereço de `INVENTORY_SERVICE_URL`. Ele busca cada serviço ou peça por `GET /internal/services/:id` e `GET /internal/parts-supplies/:id` do Inventory, em paralelo, trata o `404` como item ausente e qualquer outra falha como `503`. Quem o usa: as métricas por serviço e o `FindCatalogItemsUseCase`, que os Clean Controllers chamam para os dados de exibição dos itens da OS (ver [Dados de exibição dos itens](api.md#dados-de-exibição-dos-itens)). As fixtures das duas rotas do Inventory ficam copiadas em `app/test/contracts/inventory/`.

O dos orçamentos do Billing é o `IBillingQuotesGateway` (`application/ports/output/gateways/billing/`), implementado pelo `HttpBillingQuotesGateway` (`infrastructure/gateways/billing/`) com o endereço de `BILLING_SERVICE_URL`:

| Método | Rota do Billing | Prazo | Quem usa |
|---|---|---|---|
| `createInitialQuote` | `POST /internal/quotes` | 5 s | Saga de abertura |
| `deleteQuote` | `DELETE /internal/quotes/:id` (`404` conta como já apagado) | 2 s | Compensação da Saga de abertura |
| `getQuote` | `GET /internal/quotes/:id` | 5 s | Detalhe e decisão na área do cliente; conclusão da reserva |
| `listWorkOrderQuotes` | `GET /internal/work-orders/:workOrderId/quotes` | 2 s | Listagem na área do cliente |
| `decide` | `POST /internal/quotes/:id/decisions` | 5 s | Decisão na área do cliente |

As chamadas com 5 s são as que o Billing só responde depois de ler o catálogo no Inventory: uma cadeia de dois saltos, em que o prazo de fora precisa caber o de dentro.

O do saldo e das cobranças do Billing é o `IBillingPaymentsGateway` (mesma pasta), implementado pelo `HttpBillingPaymentsGateway`, com o mesmo `BILLING_SERVICE_URL`:

| Método | Rota do Billing | Prazo | Quem usa |
|---|---|---|---|
| `getWorkOrderBalance` | `GET /internal/work-orders/:workOrderId/balance` | 2 s | Entrega da OS ([Entrega com saldo zero](#entrega-com-saldo-zero)) |
| `listWorkOrderPayments` | `GET /internal/work-orders/:workOrderId/payments` | 2 s | Cobranças na área do cliente |

As fixtures das respostas do Billing ficam copiadas em `app/test/contracts/billing/`.

O dos usuários é o `IIdentityUsersGateway` (`application/ports/output/gateways/identity/`), implementado pelo `HttpIdentityUsersGateway` (`infrastructure/gateways/identity/`) com o endereço de `IDENTITY_SERVICE_URL`:

- `findById` e `findByIds` chamam `GET /internal/users/:id` do Identity, que devolve `{ id, name, email, role, isActive }`; `findByIds` chama os ids distintos em paralelo e omite os que o Identity responde `404`;
- `ensureCustomerUser` chama `POST /internal/customer-users`, que encontra o usuário de acesso de um cliente pelo CPF ou o cria, e devolve `{ userId, created }`; o `409` e o `422` do Identity chegam ao chamador com o status e a mensagem dele;
- qualquer outro 4xx é quebra de contrato entre os dois serviços, e vira `503` com `Serviço de destino indisponível`, como timeout, falha de conexão e 5xx.

Quem o usa: a `MechanicAssignmentPolicy` (mecânico da OS, antes da transação), a concessão de acesso a um cliente, as listagens de vínculos, o `FindUsersByIdsUseCase`, que os Clean Controllers chamam para mostrar o mecânico, os autores do histórico e os usuários com acesso a um cliente, e o `CustomerEmailRecipientsResolver`, que lê, antes da transação dos passos `ApplySentQuote`, `StartPayment` e `ConfirmQuoteApprovalReversal`, os usuários vinculados que recebem o e-mail (ver [E-mails ao cliente](#e-mails-ao-cliente)). As fixtures das duas rotas do Identity ficam copiadas em `app/test/contracts/identity/`.

## Exceções por Camada

Cada camada tem sua própria hierarquia de exceções, sem dependência de framework HTTP. O mapeamento para status HTTP acontece exclusivamente nos **Exception Filters** registrados como `APP_FILTER` em `app.module.ts` (`AllExceptionsFilter`, `DomainExceptionFilter`, `ApplicationExceptionFilter`, `InfrastructureExceptionFilter`).

| Camada | Exceção | HTTP |
|---|---|---|
| Domain | `DomainValidationException` | 422 |
| Domain | `EntityNotFoundException` | 404 |
| Domain | `BusinessRuleViolationException` | 409 |
| Application | `ResourceNotFoundException` | 404 |
| Application | `ResourceConflictException` | 409 |
| Application | `UnauthorizedAccessException` | 401 |
| Application | `ServiceRequestRejectedException` | o 4xx devolvido pelo serviço chamado |
| Infrastructure | `AuthenticationFailedException` | 401 |
| Infrastructure | `ConcurrencyException` | 409 |
| Infrastructure | `DatabaseOperationException` | 503 |
| Infrastructure | `ServiceIntegrationException` | 503 |

Erros de validação de DTO são cobertos pelo `ValidationPipe` global do NestJS (HTTP 400). Demais exceções não mapeadas são capturadas pelo `AllExceptionsFilter` e devolvidas como **HTTP 500**.

## Observabilidade

A aplicação emite logs JSON estruturados no stdout, com correlação por `request.id` e por IDs reais de trace quando há span ativo. Traces e métricas são exportados por OTLP somente quando `OTEL_EXPORTER_OTLP_ENDPOINT` está configurado; sem endpoint, o SDK não inicia e a aplicação permanece independente do pipeline.

A arquitetura detalhada de logging, redação, correlação, traces, métricas de negócio e degradação está concentrada em [Observabilidade da API](observability.md). As decisões e trade-offs permanecem registrados nos [ADRs 0002](adr/0002-logging-estruturado.md) e [0005](adr/0005-opentelemetry.md).

## Credencial do banco no deploy

Em produção, `prepare-deploy` do CD é a ponte entre o Secret gerenciado pelo RDS e o contrato
`DATABASE_URL` do Prisma. Ele descobre o ARN/endpoint, lê `AWSCURRENT` e materializa
`database-credentials` com Node.js inline e stdin. O job `db-migrate` seguinte
executa somente migration/seed; `app-deploy` aplica a imagem e aguarda o rollout; as chaves dos tokens ficam
no Secret `jwt-public-keys`, só com material público. Nenhum Pod lê segredo da AWS e não há ESO ou Secrets Store CSI.

Veja o [ADR 0017](adr/0017-materializacao-da-credencial-do-banco-no-cd.md) e o
[fluxo detalhado do CD](infra/ci-cd.md#2-workflow-de-cd-cdyml).

## Decisões de Arquitetura (ADRs)

Decisões arquiteturais relevantes são registradas em [`docs/adr/`](./adr) no formato Markdown:

- [ADR 0001 — Uso do PostgreSQL como Banco de Dados Relacional](./adr/0001-uso-do-postgresql-como-banco-de-dados.md)
- [ADR 0002 — Logging Estruturado em JSON com Nomenclatura OpenTelemetry](./adr/0002-logging-estruturado.md) *(parcialmente superado pelos ADRs 0003 e 0005)*
- [ADR 0003 — Health Checks: Liveness e Readiness como Endpoints Dedicados](./adr/0003-health-checks.md) *(política de volume das probes contrariada pelo 0005; emendado pelo 0026)*
- [ADR 0004 — Autenticação externa de clientes por CPF via função serverless](./adr/0004-autenticacao-de-clientes.md) *(emendado pelo 0026)*
- [ADR 0005 — Instrumentação OpenTelemetry: traces, correlação e métricas de negócio](./adr/0005-opentelemetry.md) *(emendado pelo 0021)*
- [ADR 0006 — Escolha de nuvem: AWS (EKS + RDS) no ambiente `prod-simulated`](./adr/0006-escolha-de-nuvem-aws.md)
- [ADR 0007 — Padrão de comunicação: REST síncrono num monólito modular](./adr/0007-padrao-de-comunicacao-rest-monolito.md) *(superado em parte pelos ADRs 0018 e 0020)*
- [ADR 0008 — Autoscaling via HPA de pods, não autoscaling de cluster](./adr/0008-autoscaling-via-hpa.md)
- [ADR 0009 — Clean Architecture e DDD em camadas, com fronteira livre de framework](./adr/0009-clean-architecture-ddd-em-camadas.md)
- [ADR 0010 — Concorrência otimista via coluna `version`](./adr/0010-concorrencia-otimista-via-version.md)
- [ADR 0011 — Unit of Work para transações multi-repositório](./adr/0011-unit-of-work-transacoes-multi-repositorio.md) *(emendado pelo 0025)*
- [ADR 0012 — Hierarquia de exceções por camada, com Exception Filters dedicados](./adr/0012-hierarquia-de-excecoes-por-camada.md)
- [ADR 0013 — Autenticação interna via JWT stateless (access + refresh)](./adr/0013-autenticacao-interna-jwt-stateless.md) *(substituído pelo 0022)*
- [ADR 0014 — Pipelines de CI, CD, SAST e DAST separados](./adr/0014-pipelines-ci-cd-sast-dast-separados.md)
- [ADR 0015 — Testes E2E contra PostgreSQL real via Testcontainers, não mocks](./adr/0015-testcontainers-e2e-postgresql-real.md)
- [ADR 0016 — Sanitização e validação de entrada em duas camadas](./adr/0016-sanitizacao-e-validacao-em-duas-camadas.md)
- [ADR 0017 — Materialização da credencial do banco no CD](./adr/0017-materializacao-da-credencial-do-banco-no-cd.md)
- [ADR 0018 — Mensageria SNS/SQS FIFO com outbox transacional](./adr/0018-mensageria-sns-sqs-fifo-com-outbox.md)
- [ADR 0019 — Cache do dono no ElastiCache](./adr/0019-cache-do-dono-no-elasticache.md)
- [ADR 0020 — Chamadas internas pela rede do cluster e rotas públicas negadas por padrão](./adr/0020-chamadas-internas-e-rotas-negadas-por-padrao.md)
- [ADR 0021 — Span de consumo de mensagens](./adr/0021-span-de-consumo-de-mensagens.md)
- [ADR 0022 — Token de funcionário em RS256 com chave pública por configuração](./adr/0022-token-de-funcionario-em-rs256.md) *(emendado pelo 0026)*
- [ADR 0023 — Catálogo e estoque no Inventory, com reserva pela Saga de aprovação](./adr/0023-catalogo-e-estoque-no-inventory-com-reserva-pela-saga.md) *(a aprovação e a compensação passaram ao Billing, ver o 0024)*
- [ADR 0024 — Saga de abertura com orçamento inicial no Billing](./adr/0024-saga-de-abertura-com-orcamento-inicial-no-billing.md)
- [ADR 0025 — Sagas orquestradas no work-order](./adr/0025-sagas-orquestradas-no-work-order.md)
- [ADR 0026 — Usuários lidos no Identity, sem réplica](./adr/0026-usuarios-lidos-no-identity-sem-replica.md)

## Modelo C4

A arquitetura também é documentada com o [C4 model](https://c4model.com) (Contexto, Container e Componente) em [`docs/c4/`](./c4), com as imagens dos diagramas e a descrição de cada nível.

