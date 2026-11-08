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
- [Ciclo de vida do Orçamento](#ciclo-de-vida-do-orçamento)
- [Aprovação de orçamento com reserva de estoque](#aprovação-de-orçamento-com-reserva-de-estoque)
- [Aprovação de orçamento pelo Cliente da Oficina autenticado](#aprovação-de-orçamento-pelo-cliente-da-oficina-autenticado)
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
│   │                                # WorkOrder e Quote são Aggregate Roots
│   ├── value-objects/               # Document (CPF/CNPJ), Email, Phone, Plate,
│   │                                # ZipCode, Address, LineItemPrice, WorkOrderNumber
│   ├── enums/                       # UserRole, CustomerType, WorkOrderStatus,
│   │                                # WorkOrderServiceStatus, QuoteStatus,
│   │                                # QuoteDecisionAction, SagaType, SagaStatus,
│   │                                # SagaFailureReason, AuthFlow, SortDirection
│   ├── exceptions/                  # DomainException, DomainValidationException,
│   │                                # EntityNotFoundException, BusinessRuleViolationException
│   ├── constants/                   # Regex compartilhadas (placa, telefone, e-mail, senha)
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
│   │       ├── services/            # IEmailSenderService, IHashService, ITokenService,
│   │       │                        # ILogger, IMetrics, ICache (output ports)
│   │       └── gateways/<dono>/     # I<Dono><Coisa>Gateway + *GatewayResponse
│   │                                # (inventory/: IInventoryCatalogGateway, catálogo
│   │                                # de serviços e peças lido no Inventory)
│   ├── auth/                        # Principal autenticado que os controllers passam aos casos de uso
│   ├── messaging/                   # MessageEnvelope + MessageHandler (contrato dos handlers)
│   ├── keys/                        # Chaves de cache (work-order:work-order:<id>)
│   ├── mappers/                     # WorkOrderCacheMapper (snapshot versionado da OS no cache)
│   ├── metrics/                     # IMetrics é a porta; aqui ficam o catálogo tipado das
│   │                                # métricas de negócio e o cálculo puro de permanência
│   │                                # por status e dos dois totais
│   ├── logging/                     # LogEventDefinition + catálogo tipado e fechado
│   │                                # de eventos de NEGÓCIO (nomes lógicos, sem chave física)
│   ├── policies/                    # CustomerAccessPolicy — autorização por vínculo,
│   │                                # reutilizável por qualquer caso de uso de /api/me/*
│   ├── services/                    # QuoteItemValidator — valida e precifica os itens
│   │                                # de OS e orçamento no Inventory, antes da transação
│   ├── use-cases/
│   │   ├── auth/                    # Authenticate, RefreshToken, IssuePasswordResetCode,
│   │   │                            # ConfirmPasswordReset
│   │   ├── user/                    # CRUD + atualização de status
│   │   ├── customer/                # CRUD completo de clientes (createAccess opcional)
│   │   ├── customer-access/         # GrantCustomerAccess, ListCustomerAccessUsers,
│   │   │                            # ListUserCustomers, RevokeCustomerAccess,
│   │   │                            # UpdateCustomerStatus
│   │   ├── me/                      # ChangeOwnPassword, FindAllMyWorkOrders,
│   │   │                            # FindMyWorkOrderById, FindMyWorkOrdersQuotes,
│   │   │                            # FindMyQuoteById, DecideMyQuote — usuário externo
│   │   │                            # autenticado (identidade via FindUserByIdUseCase,
│   │   │                            # reaproveitado de user/)
│   │   ├── vehicle/                 # CRUD + busca por cliente
│   │   ├── catalog/                 # FindCatalogItems — dados de exibição dos itens,
│   │   │                            # lidos no Inventory pelos Clean Controllers
│   │   ├── service/                 # Métricas por serviço (individual e agregada paginada)
│   │   ├── work-order/              # Criação, busca, atualização, status,
│   │   │                            # status de serviços, histórico
│   │   ├── quote/                   # CRUD, itens, envio por e-mail, rejeição,
│   │   │                            # UpdateStatus e uso de item em orçamento
│   │   │                            # (rotas /internal de quote-usage)
│   │   └── quote-approval/          # Saga de aprovação: ApproveQuote (início),
│   │                                # CompleteQuoteApproval e CompensateQuoteApproval
│   │                                # (respostas do Inventory)
│   ├── exceptions/                  # ResourceNotFoundException, ResourceConflictException,
│   │                                # UnauthorizedAccessException, ServiceRequestRejectedException
│   └── utils/                       # PaginationUtil (sanitização e cálculo de páginas)
│
├── interface-adapters/<domínio>/    # Adapters livres de framework (POJOs, zero @nestjs/*)
│                                    # domínios: auth, customer, customer-access, me,
│                                    # quote, service, user, vehicle, work-order
│   ├── <domínio>.controller.ts      # Clean Controller: orquestra o(s) use-case(s) + Presenter
│   ├── <domínio>.presenter.ts       # Entidade → tipo de resposta PURO (sem @ApiProperty)
│   ├── requests/                    # Tipos de request do controller (defaults de paginação aqui)
│   └── responses/                   # <Dom>Response / <Dom>DataResponse / <Dom>PaginatedResponse
│
├── infrastructure/                  # Implementações concretas (framework e serviços externos)
│   ├── config/                      # app-bootstrap (composição da borda HTTP, compartilhada
│   │                                #   entre main.ts e o helper de E2E) + swagger.config
│   ├── utils/                       # read-pem-key (chave PEM da configuração, usada pelas
│   │                                #   duas strategies JWT e pelo JwtTokenService)
│   ├── health/                      # Saúde operacional, agnóstica de transporte:
│   │   │                            # health.constants (módulo folha: segmentos de rota e o
│   │   │                            #   conjunto fechado de caminhos),
│   │   │                            # postgres.health-check (SELECT 1 com query_timeout
│   │   │                            #   próprio + prazo do chamador; categoria fechada),
│   │   │                            # readiness-state (ready|draining, single-flight, transição)
│   ├── gateways/                    # Adaptadores das portas de gateway, sobre o
│   │                                # InternalHttpClient: inventory/
│   │                                # HttpInventoryCatalogGateway
│   ├── messaging/                   # MessagingModule (@Global: SNSClient, SQSClient),
│   │                                # messaging-clients (clientes SNS/SQS com prazo por pedido),
│   │                                # OutboxRelayService (relay do outbox → SNS FIFO),
│   │                                # SqsConsumerService (sqs-consumer + span CONSUMER),
│   │                                # MessageHandlerRegistry, MessageEnvelopeDto,
│   │                                # messaging-log-bindings (campos messaging.* das linhas),
│   │                                # handlers/ (QuoteApprovalMessageHandlers: respostas
│   │                                # do Inventory à reserva de estoque)
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
│   │   │                            # domínios no singular; auth em controllers/auth/;
│   │   │                            # customer-access/ tem dois controllers
│   │   │                            # (CustomerAccessController, UserCustomersController);
│   │   │                            # me/ expõe as rotas do usuário externo; internal/ as
│   │   │                            # rotas /internal entre serviços; service/ só as
│   │   │                            # métricas; e as rotas de saúde em controllers/health/
│   │   ├── guards/                  # AuthenticationGuard (global, nega por padrão) +
│   │   │                            # JwtAuthGuard, CustomerJwtAuthGuard, AnyAuthGuard
│   │   │                            # (aceita interno OU externo), RolesGuard
│   │   ├── decorators/              # @CurrentUser, @Roles, @Public, @CustomerArea
│   │   ├── strategies/              # JwtStrategy (RS256, interno),
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
│   │   ├── repositories/            # Implementações Prisma (10 repositórios, outbox e Saga incluídos) + PrismaUnitOfWork +
│   │   │                            # RepositoriesModule (@Global) — única pasta a importar @generated/client
│   │   ├── mappers/                 # Conversão Prisma model → Entidade de domínio (13 mappers)
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
│   ├── services/                    # BcryptHashService, JwtTokenService,
│   │                                # MailerEmailSenderService + InfrastructureServicesModule
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
├── unit/                            # 211 suites de testes unitários (espelham src/)
│   ├── domain/                      # entities/, value-objects/, validators/
│   ├── application/use-cases/       # auth, catalog, customer, customer-access, me,
│   │                                # quote, quote-approval, service, user, vehicle,
│   │                                # work-order
│   ├── interface-adapters/          # Clean Controllers + Presenters por domínio
│   └── infrastructure/              # http/ (controllers, filters, interceptors, pipes,
│                                    # validators, auth), persistence/prisma, services
├── contracts/                       # Fixtures do contrato das rotas /internal deste
│                                    # serviço (internal-work-order.json,
│                                    # internal-quote-usage.json) e cópias das do
│                                    # Inventory (inventory/)
└── e2e/                             # 16 suites de testes E2E (Testcontainers: PostgreSQL,
    │                                #   Valkey e LocalStack reais)
    ├── all-exceptions.filter.e2e-spec.ts
    ├── auth.e2e-spec.ts
    ├── customer.e2e-spec.ts
    ├── customer-access.e2e-spec.ts
    ├── health.e2e-spec.ts
    ├── internal.e2e-spec.ts           # rotas /internal contra as fixtures
    ├── logging.e2e-spec.ts
    ├── me.e2e-spec.ts                 # /api/me/*: identidade externa, senha, OS e
    │                                  # orçamentos vinculados, decisão de orçamento
    ├── messaging.e2e-spec.ts          # outbox → SNS → SQS → handler, lock do relay
    ├── quote.e2e-spec.ts
    ├── quote-approval-saga.e2e-spec.ts # aprovação, reserva e compensação pelo LocalStack
    ├── service.e2e-spec.ts            # métricas por serviço
    ├── telemetry.e2e-spec.ts
    ├── user.e2e-spec.ts
    ├── vehicle.e2e-spec.ts
    └── work-order.e2e-spec.ts

app/prisma.config.ts                 # Configuração do Prisma v7 (schema, migrations, seed e datasource)

app/prisma/
├── schema.prisma                    # Schema do banco (20 modelos, 11 enums)
├── migrations/                      # Migrations geradas pelo Prisma — inclui a sequence
│                                    # `work_order_number_seq` (números de OS),
│                                    # endurecimento de cascade deletes,
│                                    # versionamento (colunas `version`) e índices
├── generated/                       # Prisma Client gerado (output local)
├── seed.ts                          # Entry point do seed
└── seeds/                           # Scripts de seed por entidade (work-order-status-info,
                                     # user, customer, user-customer, vehicle, work-order)
                                     # + seed-ids (UUIDs canônicos, ver seed-ids.md)
```

## Modelos do banco de dados

20 modelos, cobrindo identidade/acesso, veículos, Ordem de Serviço, orçamento, o estado da Saga de aprovação e o outbox da mensageria, mais as tabelas de catálogo e estoque, sem uso desde que o Inventory passou a ser o dono delas e removidas numa migration seguinte. Diagrama entidade-relacionamento (com os tipos reais do Postgres), explicação tabela a tabela, enums e convenções de modelagem: ver [`docs/database.md`](database.md).

## DDD — Aggregate Roots, Entidades e Value Objects

O domínio é modelado seguindo princípios de DDD:

- **Aggregate Roots** — `WorkOrder` e `Quote` são raízes de agregado. Toda mutação de itens (serviços, peças/insumos), transições de status e cálculos de totais ocorrem **através** da raiz, que protege os invariantes do agregado.
  - `WorkOrder` encapsula seus `WorkOrderService[]` e `WorkOrderPartSupply[]`, controla as transições de status (state machine), recalcula `totalAmount`, valida o mecânico atribuído (apenas usuários ativos com role `MECHANIC`) e aplica os itens herdados de um orçamento aprovado (`applyQuoteItems`). Os serviços iniciam/finalizam pela raiz (`startServiceItem` / `completeServiceItem`), que promove a OS para `IN_PROGRESS` no primeiro `start` e para `COMPLETED` quando todos os serviços estão concluídos.
  - `Quote` encapsula seus `QuoteService[]` e `QuotePartSupply[]`, recalcula `servicesAmount` / `partsAmount` / `totalAmount` automaticamente e expõe operações `submit()`, `approve()` e `reject()` que validam o status atual antes da transição.
- **Entidades** — `Customer`, `Vehicle`, `User`, `UserCustomer`, `PasswordResetCode`, `StatusHistory`, `SagaInstance`, `WorkOrderService`, `WorkOrderPartSupply`, `QuoteService`, `QuotePartSupply`. Possuem identidade própria, estado mutável e validações de invariantes nos próprios métodos (`changeRole`, `changePassword`, `complete`, `compensate`, etc.). Serviços e peças não são entidades deste serviço: os itens guardam só o id, a quantidade e o preço, e o catálogo é do Inventory.
- **Value Objects** — imutáveis, sem identidade, validados na criação:
  - `Document` (CPF ou CNPJ com dígito verificador), `Email`, `Phone`, `Plate` (placa antiga `ABC-1234` ou Mercosul `ABC1D23` — sanitizada para maiúsculas e sem hífen), `ZipCode`, `Address`, `LineItemPrice` (quantidade × preço unitário com cálculo de total), `WorkOrderNumber` (número da OS validado e normalizado com zero-padding para o comprimento mínimo).
- **Reconstituição** — todas as entidades expõem `static create(...)` (com validações completas) e `static reconstitute(...)` (rehidratação a partir do banco, sem revalidar dados já persistidos). Os mappers da infraestrutura sempre usam `reconstitute`, evitando o custo de revalidar dados já consistentes e permitindo carregar agregados em estados intermediários (ex.: `APPROVED` ou `IN_PROGRESS`) que `create` não autorizaria.
- **Enriquecimento de entidades** — relações expostas em consultas usam **referências completas** (`quote.workOrder`, `wo.customer`, `wo.vehicle`, `wo.assignedUser`) carregadas via Prisma `include`. Os dados de exibição dos itens não são relação: o Clean Controller os lê no Inventory (`FindCatalogItemsUseCase`) e os entrega ao presenter junto com o agregado. Os presenters projetam os campos necessários para o cliente HTTP.

## Concorrência otimista

Os agregados expostos a operações concorrentes (`WorkOrder`, `Quote`) possuem uma coluna `version` (Int) usada como **lock otimista**. Toda atualização verifica `WHERE id = ? AND version = ?` e incrementa a versão. Quando o Prisma retorna o erro `P2025` (registro não encontrado para o filtro), a infraestrutura traduz para uma `ConcurrencyException`, que o filtro de exceções mapeia para **HTTP 409 Conflict**, instruindo o cliente a tentar novamente.

Esse mecanismo protege fluxos críticos como atualização de status de OS e aprovação/rejeição de orçamentos: duas aprovações simultâneas de orçamentos da mesma OS gravam a OS com a mesma versão, então só uma passa e a outra responde 409.

## Perfis de usuário (RBAC)

A **autenticação** é negada por padrão: o `AuthenticationGuard` (`infrastructure/http/guards/authentication.guard.ts`) é registrado como `APP_GUARD` e roda em toda rota. Sem marcação, a rota exige o token de funcionário (`JwtAuthGuard`); `@Public()` dispensa o token; `@CustomerArea()` exige o token do Cliente da Oficina (`CustomerJwtAuthGuard`) e `@CustomerArea('any')` aceita qualquer um dos dois (`AnyAuthGuard`). Uma rota nova sem marcação nasce protegida, e esquecer o guard deixa de abrir a rota. Os usos de `@Public()` são, por método, `POST /auth/login`, `POST /auth/refresh` e `POST /auth/password-reset-confirmations` (não há JWT nesses pontos do fluxo) e, por classe, as rotas de saúde e as rotas `/internal` (ver [Chamadas internas](#chamadas-internas)).

A **autorização interna** é por papel, via `RolesGuard` + decorator `@Roles(...)`, aplicada **por controller** (`@UseGuards(RolesGuard)` na classe). O `RolesGuard` roda depois do guard global, com o `req.user` já preenchido.

| Perfil | Permissões |
|---|---|
| `ADMIN` | Acesso completo (usuários, clientes, veículos, OS, orçamentos, métricas por serviço, concessão/revogação de acesso externo) |
| `MECHANIC` | Operação de OS e orçamentos, atualização de status de serviço |
| `ATTENDANT` | Cadastro de clientes/veículos, criação e gestão de OS e orçamentos, concessão/revogação de acesso externo |

As permissões sobre o catálogo de serviços e peças e sobre o estoque são do Inventory, dono dessas rotas.

O **Cliente da Oficina** (usuário externo) não tem `role` no sentido RBAC — `UserRole` continua com apenas `ADMIN`/`MECHANIC`/`ATTENDANT`, papéis de dentro da oficina. Suas rotas (`/api/me/*`) usam um guard e uma política de autorização completamente separados — ver a seção seguinte.

## Identidade externa, autenticação e autorização por vínculo

Três conceitos que o modelo mantém deliberadamente separados:

- **`User`** — identidade com credenciais (e-mail + senha com hash). Um `User` pode ter uma `role` interna (RBAC), vínculos externos com um ou mais `Customer` (`UserCustomer`), os dois ao mesmo tempo, ou nenhum dos dois ainda.
- **`Customer`** — a parte comercial (pessoa física ou jurídica dona do veículo/OS). Nunca tem credencial própria; uma empresa (`CustomerType.COMPANY`) nunca loga diretamente.
- **`UserCustomer`** — o vínculo (many-to-many) que autoriza um `User` a agir em nome de um `Customer`. Não existe um campo `accessType`: a semântica (acesso à própria pessoa física vs. representação de uma empresa) deriva de `Customer.type`.

Dois fluxos de autenticação totalmente isolados, cada um com sua própria estratégia Passport, chave pública, emissor e audiência, nunca um verificador compartilhado. Um serviço que valide o token de funcionário precisa só de `STAFF_JWT_PUBLIC_KEY` e `STAFF_JWT_KEY_ID`, sem segredo compartilhado; aqui, a `JwtStrategy` ainda relê o usuário no banco a cada requisição:

| | Interno | Externo (Cliente da Oficina) |
|---|---|---|
| Estratégia Passport | `jwt` (`JwtStrategy`) | `customer-jwt` (`CustomerJwtStrategy`) |
| Algoritmo | RS256 (`algorithms: ['RS256']`) | RS256 (`algorithms: ['RS256']`) |
| Chave | `STAFF_JWT_PUBLIC_KEY` para validar, `kid` conferido contra `STAFF_JWT_KEY_ID`; esta API também é a emissora e guarda as privadas (`STAFF_JWT_PRIVATE_KEY`, `STAFF_JWT_REFRESH_PRIVATE_KEY`) | `CUSTOMER_JWT_PUBLIC_KEY` (só a pública — a privada vive na função serverless externa) |
| Emissor do token | `POST /api/auth/login` (interno), com `iss = oficina-identity` e `aud = oficina-services` | Função serverless externa, autenticando por CPF + senha |
| Guard HTTP (escolhido pelo `AuthenticationGuard`) | `JwtAuthGuard` (rota sem marcação) | `CustomerJwtAuthGuard` (`@CustomerArea()`); `AnyAuthGuard` aceita os dois em `GET /api/me` e `PATCH /api/me/password` (`@CustomerArea('any')`) |
| Carrega `role`/`customerId` no payload? | `role`, sim (com `sub`, `email`, `name` e `typ = access`) | **Não** — só `sub` (o `userId`) |

Diagrama de sequência completo desse fluxo (função serverless externa + `AnyAuthGuard` + `CustomerJwtStrategy`): ver [`docs/sequence-diagrams.md`](sequence-diagrams.md#autenticação-externa-do-cliente-da-oficina-cpf).

**A autorização externa é resolvida a cada requisição, nunca embutida no JWT.** O token externo carrega apenas o `userId` (`sub`); nenhuma rota `/api/me/*` confia em um `customerId` do payload. `CustomerJwtStrategy.validate()` já rejeita o principal se o usuário estiver inativo ou não tiver nenhum vínculo ativo (`findActiveCustomerIdsByUserId`), e a `CustomerAccessPolicy` (`application/policies/customer-access.policy.ts`) repete essa resolução em cada caso de uso de `/api/me/*` que precisa autorizar contra um recurso específico (`FindMyWorkOrderById`, `FindAllMyWorkOrders`, `FindMyWorkOrdersQuotes`, `FindMyQuoteById`, `DecideMyQuote`). Isso faz uma remoção de vínculo (`DELETE /customers/:id/users/:userId`) ou uma desativação de cliente (`PATCH /customers/:id`) valer **imediatamente**, sem precisar de lista de revogação de token. Pelo mesmo caminho — o `User` já recarregado do banco a cada requisição —, `JwtStrategy`, `CustomerJwtStrategy` e `RefreshTokenUseCase` também comparam o `iat` do token com `User.passwordChangedAt`: qualquer token emitido antes da última troca de senha (autenticada ou por reset) é recusado, sem lista de revogação de JWT.

**A política nunca lança 403.** `CustomerAccessPolicy.assertCustomerAuthorized` traduz recurso inexistente e recurso não autorizado para o **mesmo** `ResourceNotFoundException` (HTTP 404) — a rota nunca vira um oráculo de enumeração que revela se uma OS ou orçamento de outro cliente existe.

Ver [ADR 0004](./adr/0004-autenticacao-de-clientes.md) para o raciocínio completo por trás dessas decisões.

## Unit of Work

Operações que tocam múltiplos repositórios são executadas dentro de uma transação Prisma gerenciada pelo contrato `IUnitOfWork`. O `PrismaUnitOfWork` injeta todos os repositórios já conectados à transação ativa em uma única callback (`executeTransaction(repos => ...)`), garantindo atomicidade.

Casos de uso transacionais incluem:

- **Criação de OS** — cria a OS + registra `StatusHistory` inicial. Os itens informados são validados e precificados no Inventory **antes** da transação: nenhuma chamada HTTP fica dentro dela.
- **Atualização de status de OS** (`PATCH /work-orders/:id`) — atualiza OS + registra histórico.
- **Atualização de status de serviço da OS** — atualiza item, eventualmente promove OS para `IN_PROGRESS` / `COMPLETED` e registra histórico. Na passagem a `IN_PROGRESS` de uma OS com peças, grava no outbox o comando `inventory.stock.consume`, que pede ao Inventory a baixa do estoque reservado.
- **Aprovação de orçamento e respostas do Inventory** — os três passos da Saga de aprovação (ver [Aprovação de orçamento com reserva de estoque](#aprovação-de-orçamento-com-reserva-de-estoque)), cada um numa transação.
- **Rejeição de orçamento** — rejeita o orçamento; transiciona a OS para `REJECTED` **apenas se não houver outro orçamento ainda em `SENT`** para a mesma OS (propostas concorrentes) e registra histórico — caso contrário a OS permanece `AWAITING_APPROVAL`.
- **Envio de orçamento** — exige que a OS já tenha sido diagnosticada (nunca `RECEIVED`; aceita `IN_DIAGNOSIS`, `AWAITING_APPROVAL` ou `REJECTED`); transiciona o orçamento para `SENT` e avança a OS para `AWAITING_APPROVAL` quando ela ainda está em `IN_DIAGNOSIS`/`REJECTED` (se já estiver `AWAITING_APPROVAL`, permanece — orçamentos concorrentes), registra histórico e dispara e-mail com tokens assinados.
- **Manipulação de itens do orçamento** — adicionar/atualizar/remover serviço ou peça/insumo recalcula totais e persiste o agregado dentro da transação; a inclusão lê o item no Inventory antes de abrir a transação.

## Ciclo de vida da Ordem de Serviço

Diagramas de sequência do login interno e da abertura de OS: ver [`docs/sequence-diagrams.md`](sequence-diagrams.md).

Transições permitidas (state machine validada no agregado `WorkOrder`):

| De | Transições permitidas |
|---|---|
| `RECEIVED` | `IN_DIAGNOSIS`, `CANCELLED` |
| `IN_DIAGNOSIS` | `AWAITING_APPROVAL`, `CANCELLED` |
| `AWAITING_APPROVAL` | `APPROVED`, `REJECTED`, `CANCELLED` |
| `REJECTED` | `AWAITING_APPROVAL` |
| `APPROVED` | `IN_PROGRESS` |
| `IN_PROGRESS` | `COMPLETED` |
| `COMPLETED` | `DELIVERED` |
| `DELIVERED` | (terminal) |
| `CANCELLED` | (terminal) |

Regras adicionais:

- `CANCELLED` exige `notes` no payload.
- Atualização de campos editáveis (`problemDescription`, `internalNotes`, `mileageAtService`, mecânico) só é permitida em `RECEIVED` ou `IN_DIAGNOSIS`.
- O endpoint `PATCH /work-orders/:id` aceita apenas as transições "operacionais" para `IN_DIAGNOSIS`, `CANCELLED` e `DELIVERED` (validado por `WorkOrder.assertAllowedPatchStatus`). As demais (`AWAITING_APPROVAL`, `APPROVED`, `REJECTED`, `IN_PROGRESS`, `COMPLETED`) são disparadas como efeito colateral dos fluxos de orçamento e dos status de serviço.
- Timestamps `approvedAt`, `rejectedAt`, `startedAt`, `finishedAt` e `deliveredAt` são preenchidos automaticamente pelo agregado quando o status correspondente é atingido.
- Apenas mecânicos **ativos** podem ser atribuídos como `assignedUser` (validado tanto na criação quanto na atualização).
- O número da OS é gerado por uma sequence PostgreSQL (`work_order_number_seq`) e formatado com 6 dígitos zero-padded (`000001`, `000002`, …).
- A listagem (`GET /work-orders`) aceita ordenação (`sort`) por `status` e/ou `createdAt`. Ao ordenar por `status`, a ordem segue a `priority` definida na tabela de referência `WorkOrderStatusInfo` (`RECEIVED` → … → `CANCELLED`), não a ordem alfabética. Padrão: `status:desc,createdAt:asc`.

## Ciclo de vida do Orçamento

Transições permitidas no agregado `Quote`:

| De | Transição | Gatilho |
|---|---|---|
| `PENDING` | `SENT` | `submit()` (envio para o cliente — exige ao menos **um serviço**, peças sem serviço não são suficientes; e a OS deve já ter sido diagnosticada — `IN_DIAGNOSIS`, `AWAITING_APPROVAL` ou `REJECTED`, nunca `RECEIVED`, validado por `WorkOrder.ensureCanSubmitQuote()`) |
| `SENT` | `APPROVED` | `approve()` (manual via `PATCH /quotes/:id` ou pela decisão do cliente em `/api/me`), com o autor da decisão em `decidedBy` |
| `SENT` | `REJECTED` | `reject()` (manual ou pela decisão do cliente; `reason` obrigatória) |
| `PENDING` / `SENT` | `REJECTED` | `rejectByApprovalOf()` — a aprovação de outro orçamento da mesma OS, guardado em `replacedByQuoteId` |
| `APPROVED` | `SENT` | `revertApproval()` — compensação da Saga quando falta estoque |
| `REJECTED` | `SENT` / `PENDING` | `undoRejectionByApproval()` — na mesma compensação, o orçamento rejeitado pela aprovação desfeita volta a `SENT` se foi enviado (`sentAt` preenchido) ou a `PENDING` se não foi |

Itens (serviços e peças/insumos) só podem ser adicionados, atualizados ou removidos enquanto o orçamento estiver `PENDING`. A OS deve estar em `IN_DIAGNOSIS`, `AWAITING_APPROVAL` ou `REJECTED` para que um novo orçamento possa ser criado via `POST /quotes`. Exceção: `POST /work-orders` pode criar um orçamento diretamente para uma OS recém-criada (`RECEIVED`) ao receber itens inline — sem passar pelo gate de status, pois a validade é garantida pelo próprio fluxo de criação. Esse orçamento, porém, só pode ser **enviado** (`POST /quotes/:id/submissions`) depois que a OS passar pelo diagnóstico — tentar enviar com a OS ainda em `RECEIVED` retorna **HTTP 409**.

Podem coexistir vários orçamentos `SENT` para a mesma OS (propostas concorrentes — ex.: uma completa e uma econômica). **Aprovar** um rejeita automaticamente os demais `PENDING` e `SENT` e leva a OS a `APPROVED`, na hora ou depois da reserva de estoque (ver a seção seguinte); **rejeitar** um mantém a OS em `AWAITING_APPROVAL` enquanto houver outro `SENT`, levando a OS a `REJECTED` apenas quando o último `SENT` é recusado.

## Aprovação de orçamento com reserva de estoque

O catálogo de serviços e peças e o estoque são do Inventory, o serviço da solução dono deles. A aprovação de um orçamento com peças precisa que o Inventory reserve o estoque, e esse passo remoto pode falhar depois de o work-order gravar a aprovação. Por isso a aprovação é uma **Saga**: uma sequência de transações locais, cada uma num serviço, ligada por mensagens, em que a falha de um passo dispara um passo de **compensação** que desfaz o que os anteriores gravaram. O work-order orquestra a Saga e guarda o estado dela na tabela `saga_instances` (ver [Banco de Dados](database.md#saga-de-aprovação)).

Os três passos são casos de uso em `application/use-cases/quote-approval/`, com as portas em `application/ports/input/quote-approval/`:

1. **Início — `ApproveQuoteUseCase`** (`PATCH /quotes/:id` e a decisão do cliente). Numa transação: grava a OS com a versão (duas aprovações simultâneas da mesma OS não passam as duas), aprova o orçamento com o autor em `decided_by`, rejeita os demais `PENDING` e `SENT` com `replaced_by_quote_id` apontando o aprovado e cria a Saga `QUOTE_APPROVAL` com `correlation_id` igual ao id do orçamento.
   - **Sem peças:** a OS vai a `APPROVED` com os itens do orçamento e o histórico, e a Saga nasce `COMPLETED`.
   - **Com peças:** a OS continua `AWAITING_APPROVAL`, a Saga nasce `RESERVING_STOCK` e o comando `inventory.stock.reserve` (`{ quoteId, items: [{ partSupplyId, quantity }] }`) vai ao outbox. A resposta é `200` com o orçamento `APPROVED`.
   - Um orçamento que já teve a Saga compensada pode ser aprovado de novo: a mesma linha volta a `RESERVING_STOCK` e o comando sai de novo.
2. **Reserva confirmada — `CompleteQuoteApprovalUseCase`**, handler de `inventory.stock.reserved`. Com a Saga em `RESERVING_STOCK`, numa transação: leva a OS a `APPROVED` com os itens (id, quantidade e preço do orçamento) e o total, grava o histórico com o autor lido em `quotes.decided_by` e marca a Saga `COMPLETED`. Depois do commit, apaga a chave da OS no cache.
3. **Falta de estoque — `CompensateQuoteApprovalUseCase`**, handler de `inventory.stock.reservation_failed`. Com a Saga em `RESERVING_STOCK`, numa transação: volta o orçamento a `SENT` (sem `approved_at` e `decided_by`), devolve os orçamentos rejeitados por ele ao status anterior (`SENT` se foram enviados, `PENDING` se não), grava no histórico da OS a entrada `AWAITING_APPROVAL → AWAITING_APPROVAL` com a nota `Aprovação do orçamento <id> desfeita por falta de estoque` e marca a Saga `COMPENSATED` com `failure_reason = INSUFFICIENT_STOCK`. Depois do commit, envia ao cliente o e-mail `Orçamento da Ordem de Serviço <número> - Estoque insuficiente`; uma falha no envio só vai para o log.

Uma resposta que encontra a Saga inexistente ou fora de `RESERVING_STOCK` (mensagem repetida ou fora de hora) é registrada no log e confirmada, sem efeito. A fila FIFO entrega as respostas em ordem por OS.

**Bloqueios durante a reserva.** Enquanto a Saga de uma OS está `RESERVING_STOCK`, a OS segue em `AWAITING_APPROVAL` e o orçamento aprovado não conta como `SENT`. Um orçamento novo, enviado e rejeitado nessa janela levaria a OS a `REJECTED`, de onde a reserva confirmada não conseguiria levá-la a `APPROVED`. Por isso a criação de orçamento, o envio e o cancelamento da OS consultam a Saga e respondem 409 `Ordem de serviço com aprovação de orçamento em andamento: aguarde a confirmação do estoque`. A aprovação de outro orçamento não precisa da consulta: todos os outros estão `REJECTED`, e só `SENT` pode ser aprovado.

**Histórico e métricas.** A entrada da compensação não muda o status e não gera amostra da métrica de permanência por status (`work_order.status.duration`). O cálculo da permanência ignora entradas que não mudam o status ao procurar quando a OS entrou em `AWAITING_APPROVAL`, para que uma compensação não encurte a medida.

**Baixa do estoque.** O Inventory guarda a reserva por OS. Quando o primeiro serviço de uma OS com peças é iniciado e a OS vai a `IN_PROGRESS`, a mesma transação grava no outbox o comando `inventory.stock.consume`, com o id da OS no envelope e payload vazio; o Inventory dá a baixa da reserva daquela OS.

## Aprovação de orçamento pelo Cliente da Oficina autenticado

O fluxo atual exige autenticação do Cliente da Oficina por CPF e senha e mantém a decisão em um `POST` autenticado (ver [ADR 0004](./adr/0004-autenticacao-de-clientes.md)):

1. `POST /quotes/:id/submissions` continua exigindo que a OS já tenha sido diagnosticada — `WorkOrder.ensureCanSubmitQuote()` exige que ela **não** esteja em `RECEIVED` (aceita `IN_DIAGNOSIS`, `AWAITING_APPROVAL` ou `REJECTED`; caso contrário, **HTTP 409**). O agregado `Quote` transiciona para `SENT`; a OS avança para `AWAITING_APPROVAL` quando estava em `IN_DIAGNOSIS`/`REJECTED` (se já estava `AWAITING_APPROVAL` — orçamento concorrente — permanece), com histórico registrado. Um e-mail é enviado ao cliente (via `IEmailSenderService` → MailHog em dev) **avisando** que há um orçamento pendente — sem token de decisão embutido.
2. O Cliente da Oficina se autentica de forma totalmente independente: uma função serverless externa recebe CPF + senha, consulta o banco diretamente e, se as credenciais forem válidas, emite um JWT assimétrico (RS256) contendo apenas `{ sub: userId, iss, aud, iat, exp }` — nunca um `customerId` ou `quoteId`.
3. Com esse token, o cliente consulta seus orçamentos vinculados — `GET /api/me/work-orders`, `GET /api/me/work-orders/:id/quotes`, `GET /api/me/quotes/:id` — e decide em `POST /api/me/quotes/:id/decisions` (body `{ action: 'approve' | 'reject', reason? }`). Cada uma dessas rotas passa pela `CustomerAccessPolicy` antes de tocar o orçamento (ver [seção anterior](#identidade-externa-autenticação-e-autorização-por-vínculo)); um orçamento de um cliente não vinculado ao usuário autenticado responde **HTTP 404**, nunca 403.
4. A materialização da decisão (início da Saga de aprovação, transição de status da OS, rejeição de propostas concorrentes) usa a lógica de domínio compartilhada: `DecideMyQuoteUseCase` delega para `UpdateQuoteStatusUseCase`, também usado por `PATCH /quotes/:id` (aprovação/rejeição manual), que por sua vez chama `ApproveQuoteUseCase`/`RejectQuoteUseCase`.

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
3. procura o handler pelo `type` no `MessageHandlerRegistry`, que os módulos preenchem no `onModuleInit`, e o chama. Hoje os handlers são os das respostas do Inventory à reserva de estoque, `inventory.stock.reserved` e `inventory.stock.reservation_failed`, registrados pelo `QuoteApprovalMessageHandlers` (`infrastructure/messaging/handlers/`).

Toda linha de log desse processamento carrega `messaging.*`, `oficina.messaging.message.type`, `oficina.work_order.id` e `request.id` igual ao `messageId`, então as linhas de uma mensagem se correlacionam como as de uma requisição.

**A mensagem só é apagada da fila quando o handler termina sem erro.** Erro, envelope inválido ou tipo sem handler deixam a mensagem na fila, e o SQS a entrega de novo depois do visibility timeout. Tipo sem handler registra `messaging.message.unhandled` (`warn`): a fila só recebe os tipos que a filter policy roteia ao serviço, então chegar sem handler é uma janela de deploy, e confirmar perderia a mensagem. Na quinta entrega (`ApproximateReceiveCount` = 5, o `maxReceiveCount` da fila) o consumidor registra `messaging.message.dead_lettered` e o SQS move a mensagem para a DLQ (`work-order-dlq.fifo`), de onde ela volta por redrive. Os handlers devem ser idempotentes pelo `messageId`, porque o SQS entrega pelo menos uma vez.

Um recebimento com falha (SQS fora do ar, DNS, conexão recusada) pausa o próximo por 10 s (`RECEIVE_FAILURE_PAUSE_MS`, pelo `preReceiveMessageCallback` da biblioteca). Sozinha, a biblioteca só pausa em erro de credencial, fila inexistente ou throttling; nos outros, ela consulta de novo na hora, e um endpoint inalcançável gerava dezenas de linhas de erro por segundo. A pausa própria da biblioteca fica desligada (`authenticationErrorTimeout: 0`), para que a regra seja uma só e as duas não se somem. Falha de exclusão ou de processamento, que chega com a mensagem, não pausa.

No encerramento, o consumidor para no `beforeApplicationShutdown` com `stop({ abort: true })`, que cancela o long polling, e espera o evento `stopped`. O handler em voo tem 5 s para terminar. O `abort` também cancela o `DeleteMessage` de um handler que acabou de terminar: essa mensagem volta, e a idempotência por `messageId` a absorve. Os pedidos cancelados pelo encerramento não viram log de erro, e uma pausa em curso termina na hora. Fora dele, o cliente SQS tem prazo de 25 s por pedido, acima dos 20 s do long polling, para que uma conexão que não responde não trave o consumidor.

### Cache do detalhe da OS

O detalhe da OS (`GET /api/work-orders/:id` e `GET /internal/work-orders/:id`) usa **cache-aside** no Valkey (ElastiCache no cluster), pela porta `ICache` (`application/ports/output/`) e o `ValkeyCacheAdapter` sobre `ioredis`.

- **Chave e validade:** `work-order:work-order:<id>` (`workOrderCacheKey`), com TTL de `CACHE_TTL_SECONDS` (padrão 43.200 s, 12 h). Um valor que não seja inteiro maior que zero impede o boot: com ele, toda gravação no cache falharia.
- **Valor:** um snapshot JSON da OS montado pelo `WorkOrderCacheMapper`, com `cacheVersion`. O snapshot não leva o usuário atribuído: na leitura do cache, o caso de uso busca o usuário por id, então o hash de senha não vai ao cache e o nome do mecânico não fica velho. Valor que não se lê (JSON inválido, campo que o domínio rejeita ou `cacheVersion` diferente do atual) conta como falta e é relido do banco e regravado. Assim, um valor gravado por outra versão do código não responde 500 depois de um deploy.
- **Invalidação depois da escrita:** os casos de uso que escrevem na OS (`UpdateWorkOrder`, `UpdateWorkOrderStatus`, `UpdateWorkOrderServiceStatus`, `SubmitQuote`, `ApproveQuote`, `CompleteQuoteApproval` e `RejectQuote`), no cliente (`UpdateCustomer` e `UpdateCustomerStatus`) e no veículo (`UpdateVehicle`) apagam as chaves afetadas **depois** da escrita: os que usam transação (`UpdateWorkOrderStatus`, `UpdateWorkOrderServiceStatus` e os de orçamento) depois do commit, com o resultado devolvido do callback, como os eventos de negócio; os demais (`UpdateWorkOrder`, cliente e veículo) logo depois do `update` no repositório. Cliente e veículo buscam as próprias OS para saber quais chaves apagar, e fazem essa leitura **antes** da escrita: se ela falhar, a requisição falha sem ter gravado nada, em vez de responder erro depois de uma escrita confirmada. A exclusão de cliente e de veículo não invalida nada: ela só acontece quando nenhuma OS os referencia.
- **Itens de catálogo:** o snapshot guarda os itens só com id, quantidade, preço e status. Os dados de exibição (nome, descrição, SKU, unidade, categoria) não vão ao cache: o Clean Controller os lê no Inventory a cada leitura, com ou sem acerto no cache, então uma mudança no catálogo aparece na leitura seguinte. A compensação da Saga não apaga a chave, porque não muda a linha da OS nem os itens dela.
- **Cache fora do ar vira leitura no banco**, nunca erro nem fila de espera: o cliente roda com `enableOfflineQueue: false`, `maxRetriesPerRequest: 1` e `commandTimeout` de 500 ms, para que um Valkey que aceita TCP e não responde também caia para o banco. Falha de leitura ou gravação registra `cache.unavailable` (`warn`) e a leitura conta como falta; falha de exclusão registra `cache.invalidation_failed` (`error`), e a chave expira pelo TTL.

A área do Cliente da Oficina (`/api/me/*`) não usa o cache.

### Chamadas internas

As rotas `/internal/...` atendem só outros serviços, pela rede do cluster. Elas ficam em `infrastructure/http/controllers/internal/`, **fora do prefixo `api`** (que é o que o API Gateway encaminha), marcadas com `@Public()` e fora do Swagger (`@ApiExcludeController`). Cada uma delega ao Clean Controller existente.

| Rota | Resposta |
|---|---|
| `GET /internal/work-orders/:id` | `200` com o mesmo corpo de `GET /api/work-orders/:id` (`{ data: { ... } }`), `400` para id que não é UUID, `404` para OS inexistente |
| `GET /internal/services/:serviceId/quote-usage` | `200 { data: { inUse } }`: se algum orçamento usa o serviço. O Inventory consulta antes de apagar o serviço do catálogo. `400` para id que não é UUID |
| `GET /internal/parts-supplies/:partSupplyId/quote-usage` | `200 { data: { inUse } }`: se algum orçamento usa a peça ou insumo, pelo mesmo motivo. `400` para id que não é UUID |

O dono de cada rota versiona a fixture da resposta em `app/test/contracts/`, conferida pelo próprio e2e (ver [Testes](testing.md#contrato-das-rotas-internal)).

Para chamar outro serviço, o caso de uso usa o gateway do dono (`application/ports/output/gateways/<dono>/`), implementado em `infrastructure/gateways/<dono>/` sobre o `InternalHttpClient`, que usa o `HttpService` do `@nestjs/axios`:

- envia o `x-request-id` do contexto atual (o da requisição HTTP ou, num handler de mensagem, o `messageId`). O `traceparent` é injetado pela instrumentação HTTP do OpenTelemetry, e a chamada aparece como span `CLIENT`;
- usa prazo de 2 s por padrão (`timeoutMs` muda o prazo de uma chamada), sem retentativa e sem seguir redirecionamento;
- converte o 4xx do serviço chamado em `ServiceRequestRejectedException`, que o filtro responde com o mesmo status e a mensagem do dono; timeout, falha de conexão e 5xx viram `ServiceIntegrationException` (503).

O único gateway hoje é o do catálogo do Inventory: `IInventoryCatalogGateway` (`application/ports/output/gateways/inventory/`), implementado pelo `HttpInventoryCatalogGateway` (`infrastructure/gateways/inventory/`) com o endereço de `INVENTORY_SERVICE_URL`. Ele busca cada serviço ou peça por `GET /internal/services/:id` e `GET /internal/parts-supplies/:id` do Inventory, em paralelo, trata o `404` como item ausente e qualquer outra falha como `503`. Quem o usa: o `QuoteItemValidator` (itens de OS e de orçamento, antes da transação), a inclusão de item no orçamento, as métricas por serviço e o `FindCatalogItemsUseCase`, que os Clean Controllers chamam para os dados de exibição dos itens (ver [Dados de exibição dos itens](api.md#dados-de-exibição-dos-itens)). As fixtures das duas rotas do Inventory ficam copiadas em `app/test/contracts/inventory/`.

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
executa somente migration/seed; `app-deploy` aplica a imagem e aguarda o rollout; `jwt-private-keys` permanece separado,
somente com as chaves privadas do token de funcionário. Nenhum Pod lê segredo da AWS e não há ESO ou Secrets Store CSI.

Veja o [ADR 0017](adr/0017-materializacao-da-credencial-do-banco-no-cd.md) e o
[fluxo detalhado do CD](infra/ci-cd.md#2-workflow-de-cd-cdyml).

## Decisões de Arquitetura (ADRs)

Decisões arquiteturais relevantes são registradas em [`docs/adr/`](./adr) no formato Markdown:

- [ADR 0001 — Uso do PostgreSQL como Banco de Dados Relacional](./adr/0001-uso-do-postgresql-como-banco-de-dados.md)
- [ADR 0002 — Logging Estruturado em JSON com Nomenclatura OpenTelemetry](./adr/0002-logging-estruturado.md) *(parcialmente superado pelos ADRs 0003 e 0005)*
- [ADR 0003 — Health Checks: Liveness e Readiness como Endpoints Dedicados](./adr/0003-health-checks.md) *(política de volume das probes contrariada pelo 0005)*
- [ADR 0004 — Autenticação externa de clientes por CPF via função serverless](./adr/0004-autenticacao-de-clientes.md)
- [ADR 0005 — Instrumentação OpenTelemetry: traces, correlação e métricas de negócio](./adr/0005-opentelemetry.md) *(emendado pelo 0021)*
- [ADR 0006 — Escolha de nuvem: AWS (EKS + RDS) no ambiente `prod-simulated`](./adr/0006-escolha-de-nuvem-aws.md)
- [ADR 0007 — Padrão de comunicação: REST síncrono num monólito modular](./adr/0007-padrao-de-comunicacao-rest-monolito.md) *(superado em parte pelos ADRs 0018 e 0020)*
- [ADR 0008 — Autoscaling via HPA de pods, não autoscaling de cluster](./adr/0008-autoscaling-via-hpa.md)
- [ADR 0009 — Clean Architecture e DDD em camadas, com fronteira livre de framework](./adr/0009-clean-architecture-ddd-em-camadas.md)
- [ADR 0010 — Concorrência otimista via coluna `version`](./adr/0010-concorrencia-otimista-via-version.md)
- [ADR 0011 — Unit of Work para transações multi-repositório](./adr/0011-unit-of-work-transacoes-multi-repositorio.md)
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
- [ADR 0022 — Token de funcionário em RS256 com chave pública por configuração](./adr/0022-token-de-funcionario-em-rs256.md)
- [ADR 0023 — Catálogo e estoque no Inventory, com reserva pela Saga de aprovação](./adr/0023-catalogo-e-estoque-no-inventory-com-reserva-pela-saga.md)

## Modelo C4

A arquitetura também é documentada com o [C4 model](https://c4model.com) (Contexto, Container e Componente) em [`docs/c4/`](./c4), com as imagens dos diagramas e a descrição de cada nível.

