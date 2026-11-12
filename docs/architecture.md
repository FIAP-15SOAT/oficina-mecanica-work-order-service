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
- [Orçamentos na área do Cliente da Oficina](#orçamentos-na-área-do-cliente-da-oficina)
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
│   │                                # de serviços e peças lido no Inventory;
│   │                                # billing/: IBillingQuotesGateway, orçamentos
│   │                                # lidos, criados e decididos no Billing)
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
│   │   ├── work-order/              # Criação (Saga de abertura), busca, atualização,
│   │   │                            # status, status de serviços, histórico e
│   │   │                            # ApplySentQuote / ApplyRejectedQuote (mensagens
│   │   │                            # de envio e rejeição do Billing)
│   │   └── quote-approval/          # Saga de aprovação: StartQuoteApproval,
│   │                                # CompleteQuoteApproval, CompensateQuoteApproval
│   │                                # e ConfirmQuoteApprovalReversal
│   ├── exceptions/                  # ResourceNotFoundException, ResourceConflictException,
│   │                                # UnauthorizedAccessException, ServiceRequestRejectedException
│   └── utils/                       # PaginationUtil (sanitização e cálculo de páginas)
│
├── interface-adapters/<domínio>/    # Adapters livres de framework (POJOs, zero @nestjs/*)
│                                    # domínios: auth, customer, customer-access, me,
│                                    # service, user, vehicle, work-order
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
│   │                                # HttpInventoryCatalogGateway e billing/
│   │                                # HttpBillingQuotesGateway
│   ├── messaging/                   # MessagingModule (@Global: SNSClient, SQSClient),
│   │                                # messaging-clients (clientes SNS/SQS com prazo por pedido),
│   │                                # OutboxRelayService (relay do outbox → SNS FIFO),
│   │                                # SqsConsumerService (sqs-consumer + span CONSUMER),
│   │                                # MessageHandlerRegistry, MessageEnvelopeDto,
│   │                                # messaging-log-bindings (campos messaging.* das linhas),
│   │                                # handlers/ (quote/: envio e rejeição do Billing;
│   │                                # quote-approval/: passos da Saga de aprovação)
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
│   │   ├── repositories/            # Implementações Prisma (9 repositórios, outbox e Saga incluídos) + PrismaUnitOfWork +
│   │   │                            # RepositoriesModule (@Global) — única pasta a importar @generated/client
│   │   ├── mappers/                 # Conversão Prisma model → Entidade de domínio (10 mappers)
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
├── unit/                            # 188 suites de testes unitários (espelham src/)
│   ├── domain/                      # entities/, value-objects/, validators/
│   ├── application/use-cases/       # auth, catalog, customer, customer-access, me,
│   │                                # quote-approval, service, user, vehicle,
│   │                                # work-order
│   ├── interface-adapters/          # Clean Controllers + Presenters por domínio
│   └── infrastructure/              # http/ (controllers, filters, interceptors, pipes,
│                                    # validators, auth), persistence/prisma, services
├── contracts/                       # Fixture do contrato da rota /internal deste
│                                    # serviço (internal-work-order.json) e cópias
│                                    # das do Inventory (inventory/) e do Billing
│                                    # (billing/)
└── e2e/                             # 15 suites de testes E2E (Testcontainers: PostgreSQL,
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
    ├── quote-approval-saga.e2e-spec.ts # Sagas de abertura e de aprovação e eventos de
    │                                  # orçamento pelo LocalStack, com stub do Billing
    ├── service.e2e-spec.ts            # métricas por serviço
    ├── telemetry.e2e-spec.ts
    ├── user.e2e-spec.ts
    ├── vehicle.e2e-spec.ts
    └── work-order.e2e-spec.ts

app/prisma.config.ts                 # Configuração do Prisma v7 (schema, migrations, seed e datasource)

app/prisma/
├── schema.prisma                    # Schema do banco (16 modelos, 8 enums)
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

16 modelos, cobrindo identidade/acesso, veículos, Ordem de Serviço, o estado da Saga de aprovação e o outbox da mensageria, mais as três tabelas antigas de orçamento, sem uso até a migration que as remove. Diagrama entidade-relacionamento (com os tipos reais do Postgres), explicação tabela a tabela, enums e convenções de modelagem: ver [`docs/database.md`](database.md).

## DDD — Aggregate Roots, Entidades e Value Objects

O domínio é modelado seguindo princípios de DDD:

- **Aggregate Root** — `WorkOrder` é a raiz de agregado. Toda mutação de itens (serviços, peças/insumos), transições de status e cálculos de totais ocorrem **através** da raiz, que protege os invariantes do agregado.
  - `WorkOrder` encapsula seus `WorkOrderService[]` e `WorkOrderPartSupply[]`, controla as transições de status (state machine), recalcula `totalAmount`, valida o mecânico atribuído (apenas usuários ativos com role `MECHANIC`) e aplica os itens do orçamento aprovado no Billing (`applyApprovedItems`). Os serviços iniciam/finalizam pela raiz (`startServiceItem` / `completeServiceItem`), que promove a OS para `IN_PROGRESS` no primeiro `start` e para `COMPLETED` quando todos os serviços estão concluídos.
- **Entidades** — `Customer`, `Vehicle`, `User`, `UserCustomer`, `PasswordResetCode`, `StatusHistory`, `SagaInstance`, `WorkOrderService`, `WorkOrderPartSupply`. Possuem identidade própria, estado mutável e validações de invariantes nos próprios métodos (`changeRole`, `changePassword`, `complete`, `compensate`, etc.). Serviços e peças não são entidades deste serviço: os itens guardam só o id, a quantidade e o preço, e o catálogo é do Inventory. Orçamentos também não: são do Billing (ver [Orçamentos no Billing](#orçamentos-no-billing)).
- **Value Objects** — imutáveis, sem identidade, validados na criação:
  - `Document` (CPF ou CNPJ com dígito verificador), `Email`, `Phone`, `Plate` (placa antiga `ABC-1234` ou Mercosul `ABC1D23` — sanitizada para maiúsculas e sem hífen), `ZipCode`, `Address`, `LineItemPrice` (quantidade × preço unitário com cálculo de total), `WorkOrderNumber` (número da OS validado e normalizado com zero-padding para o comprimento mínimo).
- **Reconstituição** — todas as entidades expõem `static create(...)` (com validações completas) e `static reconstitute(...)` (rehidratação a partir do banco, sem revalidar dados já persistidos). Os mappers da infraestrutura sempre usam `reconstitute`, evitando o custo de revalidar dados já consistentes e permitindo carregar agregados em estados intermediários (ex.: `APPROVED` ou `IN_PROGRESS`) que `create` não autorizaria.
- **Enriquecimento de entidades** — relações expostas em consultas usam **referências completas** (`wo.customer`, `wo.vehicle`, `wo.assignedUser`) carregadas via Prisma `include`. Os dados de exibição dos itens não são relação: o Clean Controller os lê no Inventory (`FindCatalogItemsUseCase`) e os entrega ao presenter junto com o agregado. Os presenters projetam os campos necessários para o cliente HTTP.

## Concorrência otimista

O agregado exposto a operações concorrentes (`WorkOrder`) possui uma coluna `version` (Int) usada como **lock otimista**. Toda atualização verifica `WHERE id = ? AND version = ?` e incrementa a versão. Quando o Prisma retorna o erro `P2025` (registro não encontrado para o filtro), a infraestrutura traduz para uma `ConcurrencyException`, que o filtro de exceções mapeia para **HTTP 409 Conflict**, instruindo o cliente a tentar novamente.

Esse mecanismo protege a atualização de status da OS e os passos das Sagas, que gravam a OS com a versão antes de gravar uma mensagem no outbox: duas transações sobre a mesma OS não passam as duas, e a ordem das mensagens dela segue a dos commits (ver [Outbox e relay](#outbox-e-relay)).

## Perfis de usuário (RBAC)

A **autenticação** é negada por padrão: o `AuthenticationGuard` (`infrastructure/http/guards/authentication.guard.ts`) é registrado como `APP_GUARD` e roda em toda rota. Sem marcação, a rota exige o token de funcionário (`JwtAuthGuard`); `@Public()` dispensa o token; `@CustomerArea()` exige o token do Cliente da Oficina (`CustomerJwtAuthGuard`) e `@CustomerArea('any')` aceita qualquer um dos dois (`AnyAuthGuard`). Uma rota nova sem marcação nasce protegida, e esquecer o guard deixa de abrir a rota. Os usos de `@Public()` são, por método, `POST /auth/login`, `POST /auth/refresh` e `POST /auth/password-reset-confirmations` (não há JWT nesses pontos do fluxo) e, por classe, as rotas de saúde e as rotas `/internal` (ver [Chamadas internas](#chamadas-internas)).

A **autorização interna** é por papel, via `RolesGuard` + decorator `@Roles(...)`, aplicada **por controller** (`@UseGuards(RolesGuard)` na classe). O `RolesGuard` roda depois do guard global, com o `req.user` já preenchido.

| Perfil | Permissões |
|---|---|
| `ADMIN` | Acesso completo (usuários, clientes, veículos, OS, métricas por serviço, concessão/revogação de acesso externo) |
| `MECHANIC` | Operação de OS, atualização de status de serviço |
| `ATTENDANT` | Cadastro de clientes/veículos, criação e gestão de OS, concessão/revogação de acesso externo |

As permissões sobre o catálogo de serviços e peças e sobre o estoque são do Inventory, e as sobre orçamentos, do Billing, donos dessas rotas.

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

- **Criação de OS** — cria a OS + registra `StatusHistory` inicial. Com itens, o orçamento inicial é criado no Billing **antes** da transação (ver [Saga de abertura](#saga-de-abertura)): nenhuma chamada HTTP fica dentro dela.
- **Atualização de status de OS** (`PATCH /work-orders/:id`) — atualiza OS + registra histórico.
- **Atualização de status de serviço da OS** — atualiza item, eventualmente promove OS para `IN_PROGRESS` / `COMPLETED` e registra histórico. Na passagem a `IN_PROGRESS` de uma OS com peças, grava no outbox o comando `inventory.stock.consume`, que pede ao Inventory a baixa do estoque reservado.
- **Passos da Saga de aprovação** — cada mensagem da Saga (ver [Aprovação de orçamento com reserva de estoque](#aprovação-de-orçamento-com-reserva-de-estoque)) é tratada numa transação que grava a Saga e, conforme o passo, a OS, o histórico e o comando no outbox.
- **Envio e rejeição de orçamento** — as mensagens `billing.quote.sent` e `billing.quote.rejected` movem a OS e registram o histórico numa transação; o e-mail do envio sai depois do commit (ver [Fluxo do orçamento, do envio à aprovação](#fluxo-do-orçamento-do-envio-à-aprovação)).

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
- O endpoint `PATCH /work-orders/:id` aceita apenas as transições "operacionais" para `IN_DIAGNOSIS`, `CANCELLED` e `DELIVERED` (validado por `WorkOrder.assertAllowedPatchStatus`). As demais (`AWAITING_APPROVAL`, `APPROVED`, `REJECTED`, `IN_PROGRESS`, `COMPLETED`) são disparadas como efeito colateral das mensagens de orçamento do Billing e dos status de serviço.
- Timestamps `approvedAt`, `rejectedAt`, `startedAt`, `finishedAt` e `deliveredAt` são preenchidos automaticamente pelo agregado quando o status correspondente é atingido.
- Apenas mecânicos **ativos** podem ser atribuídos como `assignedUser` (validado tanto na criação quanto na atualização).
- O número da OS é gerado por uma sequence PostgreSQL (`work_order_number_seq`) e formatado com 6 dígitos zero-padded (`000001`, `000002`, …).
- A listagem (`GET /work-orders`) aceita ordenação (`sort`) por `status` e/ou `createdAt`. Ao ordenar por `status`, a ordem segue a `priority` definida na tabela de referência `WorkOrderStatusInfo` (`RECEIVED` → … → `CANCELLED`), não a ordem alfabética. Padrão: `status:desc,createdAt:asc`.

## Orçamentos no Billing

Os orçamentos são do **Billing**, o serviço da solução dono dos orçamentos e dos pagamentos ([`oficina-mecanica-billing-service`](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service)). Criação, itens, envio, aprovação, rejeição e o ciclo de vida do orçamento (`PENDING` → `SENT` → `APPROVED` ou `REJECTED`) ficam lá, e o API Gateway encaminha ao Billing `/api/quotes` e `GET /api/work-orders/{id}/quotes`. Este serviço não grava orçamento. Ele:

- abre a OS com o orçamento inicial criado no Billing ([Saga de abertura](#saga-de-abertura));
- reage às mensagens que o Billing publica quando um orçamento é enviado, rejeitado ou aprovado, movendo a OS ([Fluxo do orçamento, do envio à aprovação](#fluxo-do-orçamento-do-envio-à-aprovação));
- orquestra a aprovação, que reserva o estoque no Inventory e, se a reserva falhar, pede ao Billing que desfaça a aprovação ([Aprovação de orçamento com reserva de estoque](#aprovação-de-orçamento-com-reserva-de-estoque));
- serve os orçamentos na área do Cliente da Oficina, lendo-os no Billing e repassando a decisão a ele ([Orçamentos na área do Cliente da Oficina](#orçamentos-na-área-do-cliente-da-oficina)).

Do orçamento, a OS guarda só os itens aprovados (id, quantidade e preço), materializados quando ela vai a `APPROVED`. As tabelas antigas de orçamento continuam no banco, sem uso, até a migration que as remove (ver [Banco de Dados](database.md#tabelas-de-orçamento-sem-uso)).

Os dois fluxos que gravam neste serviço e no Billing são **Sagas**: uma sequência de transações locais, cada uma num serviço, ligadas por chamadas ou mensagens, em que a falha de um passo dispara um passo de **compensação** que desfaz o que os anteriores gravaram.

## Saga de abertura

`POST /api/work-orders` com algum item (serviço ou peça) grava o orçamento inicial no Billing e a OS aqui. O `CreateWorkOrderUseCase` segue quatro passos:

1. valida cliente, veículo e mecânico no próprio banco e gera o id da OS (UUID), fora de transação;
2. cria o orçamento no Billing por `IBillingQuotesGateway.createInitialQuote` (`POST /internal/quotes`, com o id da OS e os itens), com prazo de 5 s, porque o Billing lê o catálogo no Inventory antes de responder. O Billing valida e precifica os itens e devolve o orçamento `PENDING`; uma recusa dele (peças sem serviço, item repetido ou desconhecido) volta ao chamador com o mesmo status, e nada foi gravado aqui;
3. abre a transação que aloca o número da OS e grava a OS `RECEIVED` com o histórico inicial;
4. se essa transação falhar, apaga o orçamento (`deleteQuote`, `DELETE /internal/quotes/:id`, em que um `404` conta como já apagado) e relança o erro da gravação. Se a exclusão também falhar, o orçamento sem OS fica registrado no evento de log `work_order.opening.compensation_failed` (`warn`), com os ids do orçamento e da OS.

- **Por que o Billing primeiro:** o erro mais comum, um item inválido, não cria nada nem consome número de OS. Na ordem inversa, cada item inválido criaria e apagaria uma OS.
- **Sem estado persistido:** a Saga começa e termina na requisição, sem linha em `saga_instances`. Sobra um orçamento `PENDING` sem OS (órfão) se o processo cair entre o passo 2 e o 3, se o Billing gravar o orçamento e responder depois do prazo de 5 s (o work-order responde 503 sem conhecer o id do orçamento) ou se a exclusão de compensação falhar. O órfão não chega ao cliente nem às leituras por OS, mas aparece na listagem de orçamentos dos funcionários no Billing (`GET /api/quotes`) com `workOrder: null`, porque o work-order não conhece aquela OS, e o Billing registra o evento de log `quote.work_order_missing`.
- **Sem itens**, a OS é aberta sem chamar o Billing.

A decisão e as alternativas descartadas estão no [ADR 0024](adr/0024-saga-de-abertura-com-orcamento-inicial-no-billing.md); o diagrama, em [`docs/sequence-diagrams.md`](sequence-diagrams.md).

## Aprovação de orçamento com reserva de estoque

A aprovação é síncrona no Billing: pela rota do funcionário ou pela decisão do cliente repassada por este serviço, o Billing responde `200`, marca o orçamento `APPROVED`, rejeita os outros orçamentos `PENDING` e `SENT` da OS e grava no outbox dele a mensagem `billing.quote.approved`, com os itens (ids, quantidades e preços) e o total. A OS só pode ir a `APPROVED` com as peças reservadas no Inventory, e a reserva pode falhar depois de o Billing gravar a aprovação. Por isso a aprovação é a **Saga de aprovação**, orquestrada por este serviço, com o estado em `saga_instances`: uma linha `QUOTE_APPROVAL` por orçamento, com `correlation_id` igual ao id dele, única junto com o tipo (ver [Banco de Dados](database.md#saga-de-aprovação)).

Cada mensagem é tratada por um caso de uso de `application/use-cases/quote-approval/` (portas em `application/ports/input/quote-approval/`), registrado no `QuoteApprovalMessageHandlers` de `infrastructure/messaging/handlers/quote-approval/`. Cada passo roda numa transação que grava a Saga e, conforme o passo, a OS com a `version` (o que ordena as mensagens dela no outbox), o histórico e o comando no outbox:

| Mensagem que chega | Situação | O que o work-order faz | Caso de uso |
|---|---|---|---|
| `billing.quote.approved` | OS em `AWAITING_APPROVAL`, orçamento com peças | Cria a Saga em `RESERVING_STOCK` e manda `inventory.stock.reserve` (`{ quoteId, items: [{ partSupplyId, quantity }] }`) | `StartQuoteApprovalUseCase` |
| `billing.quote.approved` | OS em `AWAITING_APPROVAL`, orçamento sem peças | Leva a OS a `APPROVED` com os itens da mensagem e o histórico (autor `decidedBy`) e cria a Saga já `COMPLETED` | `StartQuoteApprovalUseCase` |
| `billing.quote.approved` | OS fora de `AWAITING_APPROVAL` (cancelada entre a decisão e a mensagem) | Cria a Saga em `COMPENSATING` com `failure_reason = WORK_ORDER_NOT_AWAITING` e manda `billing.quote.revert_approval` (`{ quoteId, revertTo: 'REJECTED' }`) | `StartQuoteApprovalUseCase` |
| `billing.quote.approved` | Saga do orçamento `COMPENSATED` por `INSUFFICIENT_STOCK` (reaprovação) | Reabre a mesma linha, pelas mesmas regras das três linhas acima: `RESERVING_STOCK` e reserva de novo, ou `COMPENSATING` com `revertTo = REJECTED` se a OS saiu de `AWAITING_APPROVAL` | `StartQuoteApprovalUseCase` |
| `inventory.stock.reserved` | Saga em `RESERVING_STOCK` | Lê o orçamento aprovado no Billing (`GET /internal/quotes/:id`, 5 s), leva a OS a `APPROVED` com os itens e o total dele, grava o histórico com o autor `decidedBy` e marca a Saga `COMPLETED` | `CompleteQuoteApprovalUseCase` |
| `inventory.stock.reservation_failed` | Saga em `RESERVING_STOCK` | Saga vai a `COMPENSATING` com `failure_reason = INSUFFICIENT_STOCK` e manda `billing.quote.revert_approval` (`revertTo = 'SENT'`) | `CompensateQuoteApprovalUseCase` |
| `billing.quote.approval_reverted` | Saga em `COMPENSATING` | Saga vai a `COMPENSATED`; o histórico da OS ganha uma entrada com o mesmo status de entrada e saída e a nota do motivo; com falta de estoque, e-mail ao cliente depois do commit | `ConfirmQuoteApprovalReversalUseCase` |
| Qualquer mensagem acima | Outra combinação (mensagem repetida ou fora de hora) | Registra `quote_approval.step_skipped` e confirma a mensagem, sem efeito | — |

- **Idempotência:** a unicidade de `(QUOTE_APPROVAL, quoteId)` é o que torna `billing.quote.approved` idempotente. Uma reentrega depois de a OS ir a `APPROVED` encontra a Saga `COMPLETED` e é ignorada; sem a linha, ela veria a OS fora de `AWAITING_APPROVAL` e reverteria um orçamento válido. Por isso a aprovação sem peças também grava a Saga. A única linha reaberta é a compensada por falta de estoque: o orçamento voltou a `SENT`, então um novo `billing.quote.approved` é uma nova aprovação.
- **Billing fora do ar na reserva confirmada:** a leitura do orçamento falha, o handler lança e a mensagem volta à fila, até ir para a DLQ (fila de mensagens mortas, de onde volta por redrive) na quinta entrega.
- **Notas do histórico na confirmação da reversão:** `Aprovação do orçamento <quoteId> desfeita por falta de estoque` ou `Aprovação do orçamento <quoteId> desfeita: a Ordem de Serviço não aguardava aprovação`. O e-mail da falta de estoque tem o assunto `Orçamento da Ordem de Serviço <número> - Estoque insuficiente` e diz que o orçamento voltou a aguardar aprovação; uma falha no envio só vai para o log.
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
| 2. O handler aplica o envio (`ApplySentQuoteUseCase`) | `SENT` | `AWAITING_APPROVAL` (já estava, fica); e-mail ao cliente depois do commit | — |
| 3. Funcionário ou cliente rejeita o orçamento | `REJECTED` | `AWAITING_APPROVAL` | `billing.quote.rejected` (com `remainingSentCount`, os orçamentos da OS ainda `SENT`) |
| 4. O handler aplica a rejeição (`ApplyRejectedQuoteUseCase`) | `REJECTED` | `REJECTED` se `remainingSentCount = 0`; senão `AWAITING_APPROVAL` | — |

O e-mail do envio vai aos usuários ativos vinculados ao cliente ou, sem nenhum, ao e-mail do cliente, com uma linha por item e o total da mensagem. Se a OS não está num status que aceita o passo (uma OS cancelada no intervalo, por exemplo), nada muda, nenhum e-mail sai, e o handler registra `quote_event.skipped` e confirma a mensagem.

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
- o envio e a rejeição chegam por mensagem, e o e-mail do envio sai depois do commit: uma falha no e-mail não desfaz o envio;
- a aprovação começa no Billing, e a compensação é um comando ao Billing (`billing.quote.revert_approval`), confirmado por `billing.quote.approval_reverted`; a Saga ganhou o estado `COMPENSATING` para esperar essa confirmação;
- os itens aprovados são lidos no Billing na conclusão da reserva, porque a resposta do Inventory só traz o id do orçamento;
- a área do cliente lê os orçamentos no Billing e repassa a decisão a ele.

## Orçamentos na área do Cliente da Oficina

O Cliente da Oficina se autentica por CPF e senha numa função serverless externa (ver [ADR 0004](./adr/0004-autenticacao-de-clientes.md)) e, com o token, consulta e decide os orçamentos das OS vinculadas a ele. Os orçamentos vêm do Billing pelo `IBillingQuotesGateway`, e a autorização por vínculo (`CustomerAccessPolicy`, ver [seção acima](#identidade-externa-autenticação-e-autorização-por-vínculo)) fica aqui, porque o vínculo entre usuário e cliente é deste serviço:

- **`GET /api/me/work-orders/:id/quotes`** (`FindMyWorkOrdersQuotesUseCase`) confere o vínculo com a OS e então lista os orçamentos dela no Billing (`GET /internal/work-orders/:workOrderId/quotes`, prazo padrão de 2 s: a listagem só devolve resumos, sem consultar o Inventory).
- **`GET /api/me/quotes/:id`** (`FindMyQuoteByIdUseCase`) lê antes o orçamento no Billing (`GET /internal/quotes/:id`, 5 s, porque o detalhe do Billing lê o catálogo no Inventory), já que só o Billing sabe a qual OS ele pertence, e então confere o vínculo.
- **`POST /api/me/quotes/:id/decisions`** (`DecideMyQuoteUseCase`) lê o orçamento da mesma forma, confere o vínculo, a OS em `AWAITING_APPROVAL` e a ausência de Saga ativa, e só então repassa a decisão (`POST /internal/quotes/:id/decisions`, 5 s, porque o Billing lê o catálogo antes de decidir), com o usuário autenticado como autor. Uma decisão recusada aqui nunca chega ao Billing.

Sem vínculo, a resposta é **404**, e nada do orçamento é devolvido nem repassado. As respostas de cada desfecho estão em [Referência da API › Minha Conta](api.md#endpoints-disponíveis).

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
3. procura o handler pelo `type` no `MessageHandlerRegistry`, que os módulos preenchem no `onModuleInit`, e o chama. Hoje são dois grupos, cada um com as classes de payload em `dto/`: o `QuoteMessageHandlers` (`handlers/quote/`, composto pelo `QuoteMessagingModule`) trata `billing.quote.sent` e `billing.quote.rejected`, e o `QuoteApprovalMessageHandlers` (`handlers/quote-approval/`, composto pelo `QuoteApprovalMessagingModule`) trata os passos da Saga de aprovação: `billing.quote.approved`, `inventory.stock.reserved`, `inventory.stock.reservation_failed` e `billing.quote.approval_reverted`. Uma mensagem de orçamento sem o id da OS no envelope é recusada (`Mensagem sem a ordem de serviço no envelope`) e vai para a DLQ. Os valores em dinheiro dos payloads chegam como texto com duas casas decimais e são conferidos por esse formato antes de virar número.

Toda linha de log desse processamento carrega `messaging.*`, `oficina.messaging.message.type`, `oficina.work_order.id` e `request.id` igual ao `messageId`, então as linhas de uma mensagem se correlacionam como as de uma requisição.

**A mensagem só é apagada da fila quando o handler termina sem erro.** Erro, envelope inválido ou tipo sem handler deixam a mensagem na fila, e o SQS a entrega de novo depois do visibility timeout. Tipo sem handler registra `messaging.message.unhandled` (`warn`): a fila só recebe os tipos que a filter policy roteia ao serviço, então chegar sem handler é uma janela de deploy, e confirmar perderia a mensagem. Na quinta entrega (`ApproximateReceiveCount` = 5, o `maxReceiveCount` da fila) o consumidor registra `messaging.message.dead_lettered` e o SQS move a mensagem para a DLQ (`work-order-dlq.fifo`), de onde ela volta por redrive. Os handlers devem ser idempotentes pelo `messageId`, porque o SQS entrega pelo menos uma vez.

Um recebimento com falha (SQS fora do ar, DNS, conexão recusada) pausa o próximo por 10 s (`RECEIVE_FAILURE_PAUSE_MS`, pelo `preReceiveMessageCallback` da biblioteca). Sozinha, a biblioteca só pausa em erro de credencial, fila inexistente ou throttling; nos outros, ela consulta de novo na hora, e um endpoint inalcançável gerava dezenas de linhas de erro por segundo. A pausa própria da biblioteca fica desligada (`authenticationErrorTimeout: 0`), para que a regra seja uma só e as duas não se somem. Falha de exclusão ou de processamento, que chega com a mensagem, não pausa.

No encerramento, o consumidor para no `beforeApplicationShutdown` com `stop({ abort: true })`, que cancela o long polling, e espera o evento `stopped`. O handler em voo tem 5 s para terminar. O `abort` também cancela o `DeleteMessage` de um handler que acabou de terminar: essa mensagem volta, e a idempotência por `messageId` a absorve. Os pedidos cancelados pelo encerramento não viram log de erro, e uma pausa em curso termina na hora. Fora dele, o cliente SQS tem prazo de 25 s por pedido, acima dos 20 s do long polling, para que uma conexão que não responde não trave o consumidor.

### Cache do detalhe da OS

O detalhe da OS (`GET /api/work-orders/:id` e `GET /internal/work-orders/:id`) usa **cache-aside** no Valkey (ElastiCache no cluster), pela porta `ICache` (`application/ports/output/`) e o `ValkeyCacheAdapter` sobre `ioredis`.

- **Chave e validade:** `work-order:work-order:<id>` (`workOrderCacheKey`), com TTL de `CACHE_TTL_SECONDS` (padrão 43.200 s, 12 h). Um valor que não seja inteiro maior que zero impede o boot: com ele, toda gravação no cache falharia.
- **Valor:** um snapshot JSON da OS montado pelo `WorkOrderCacheMapper`, com `cacheVersion`. O snapshot não leva o usuário atribuído: na leitura do cache, o caso de uso busca o usuário por id, então o hash de senha não vai ao cache e o nome do mecânico não fica velho. Valor que não se lê (JSON inválido, campo que o domínio rejeita ou `cacheVersion` diferente do atual) conta como falta e é relido do banco e regravado. Assim, um valor gravado por outra versão do código não responde 500 depois de um deploy.
- **Invalidação depois da escrita:** os casos de uso que escrevem na OS (`UpdateWorkOrder`, `UpdateWorkOrderStatus`, `UpdateWorkOrderServiceStatus`, `ApplySentQuote`, `ApplyRejectedQuote`, `StartQuoteApproval` e `CompleteQuoteApproval`), no cliente (`UpdateCustomer` e `UpdateCustomerStatus`) e no veículo (`UpdateVehicle`) apagam as chaves afetadas **depois** da escrita: os que usam transação (`UpdateWorkOrderStatus`, `UpdateWorkOrderServiceStatus` e os de orçamento e da Saga, só quando o status da OS mudou) depois do commit, com o resultado devolvido do callback, como os eventos de negócio; os demais (`UpdateWorkOrder`, cliente e veículo) logo depois do `update` no repositório. Cliente e veículo buscam as próprias OS para saber quais chaves apagar, e fazem essa leitura **antes** da escrita: se ela falhar, a requisição falha sem ter gravado nada, em vez de responder erro depois de uma escrita confirmada. A exclusão de cliente e de veículo não invalida nada: ela só acontece quando nenhuma OS os referencia.
- **Itens de catálogo:** o snapshot guarda os itens só com id, quantidade, preço e status. Os dados de exibição (nome, descrição, SKU, unidade, categoria) não vão ao cache: o Clean Controller os lê no Inventory a cada leitura, com ou sem acerto no cache, então uma mudança no catálogo aparece na leitura seguinte. A compensação da Saga não apaga a chave, porque não muda campo nem item da OS (só incrementa a `version`, que nenhuma resposta mostra).
- **Cache fora do ar vira leitura no banco**, nunca erro nem fila de espera: o cliente roda com `enableOfflineQueue: false`, `maxRetriesPerRequest: 1` e `commandTimeout` de 500 ms, para que um Valkey que aceita TCP e não responde também caia para o banco. Falha de leitura ou gravação registra `cache.unavailable` (`warn`) e a leitura conta como falta; falha de exclusão registra `cache.invalidation_failed` (`error`), e a chave expira pelo TTL.

A área do Cliente da Oficina (`/api/me/*`) não usa o cache.

### Chamadas internas

As rotas `/internal/...` atendem só outros serviços, pela rede do cluster. Elas ficam em `infrastructure/http/controllers/internal/`, **fora do prefixo `api`** (que é o que o API Gateway encaminha), marcadas com `@Public()` e fora do Swagger (`@ApiExcludeController`). Cada uma delega ao Clean Controller existente.

| Rota | Resposta |
|---|---|
| `GET /internal/work-orders/:id` | `200` com o mesmo corpo de `GET /api/work-orders/:id` (`{ data: { ... } }`), `400` para id que não é UUID, `404` para OS inexistente |

O dono de cada rota versiona a fixture da resposta em `app/test/contracts/`, conferida pelo próprio e2e (ver [Testes](testing.md#contrato-das-rotas-internal)).

Para chamar outro serviço, o caso de uso usa o gateway do dono (`application/ports/output/gateways/<dono>/`), implementado em `infrastructure/gateways/<dono>/` sobre o `InternalHttpClient`, que usa o `HttpService` do `@nestjs/axios`:

- envia o `x-request-id` do contexto atual (o da requisição HTTP ou, num handler de mensagem, o `messageId`). O `traceparent` é injetado pela instrumentação HTTP do OpenTelemetry, e a chamada aparece como span `CLIENT`;
- usa prazo de 2 s por padrão (`timeoutMs` muda o prazo de uma chamada), sem retentativa e sem seguir redirecionamento;
- converte o 4xx do serviço chamado em `ServiceRequestRejectedException`, que o filtro responde com o mesmo status e a mensagem do dono; timeout, falha de conexão e 5xx viram `ServiceIntegrationException` (503).

São dois gateways. O do catálogo do Inventory é o `IInventoryCatalogGateway` (`application/ports/output/gateways/inventory/`), implementado pelo `HttpInventoryCatalogGateway` (`infrastructure/gateways/inventory/`) com o endereço de `INVENTORY_SERVICE_URL`. Ele busca cada serviço ou peça por `GET /internal/services/:id` e `GET /internal/parts-supplies/:id` do Inventory, em paralelo, trata o `404` como item ausente e qualquer outra falha como `503`. Quem o usa: as métricas por serviço e o `FindCatalogItemsUseCase`, que os Clean Controllers chamam para os dados de exibição dos itens da OS (ver [Dados de exibição dos itens](api.md#dados-de-exibição-dos-itens)). As fixtures das duas rotas do Inventory ficam copiadas em `app/test/contracts/inventory/`.

O dos orçamentos do Billing é o `IBillingQuotesGateway` (`application/ports/output/gateways/billing/`), implementado pelo `HttpBillingQuotesGateway` (`infrastructure/gateways/billing/`) com o endereço de `BILLING_SERVICE_URL`:

| Método | Rota do Billing | Prazo | Quem usa |
|---|---|---|---|
| `createInitialQuote` | `POST /internal/quotes` | 5 s | Saga de abertura |
| `deleteQuote` | `DELETE /internal/quotes/:id` (`404` conta como já apagado) | 2 s | Compensação da Saga de abertura |
| `getQuote` | `GET /internal/quotes/:id` | 5 s | Detalhe e decisão na área do cliente; conclusão da reserva |
| `listWorkOrderQuotes` | `GET /internal/work-orders/:workOrderId/quotes` | 2 s | Listagem na área do cliente |
| `decide` | `POST /internal/quotes/:id/decisions` | 5 s | Decisão na área do cliente |

As chamadas com 5 s são as que o Billing só responde depois de ler o catálogo no Inventory: uma cadeia de dois saltos, em que o prazo de fora precisa caber o de dentro. As fixtures das respostas do Billing ficam copiadas em `app/test/contracts/billing/`.

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
- [ADR 0023 — Catálogo e estoque no Inventory, com reserva pela Saga de aprovação](./adr/0023-catalogo-e-estoque-no-inventory-com-reserva-pela-saga.md) *(a aprovação e a compensação passaram ao Billing, ver o 0024)*
- [ADR 0024 — Saga de abertura com orçamento inicial no Billing](./adr/0024-saga-de-abertura-com-orcamento-inicial-no-billing.md)

## Modelo C4

A arquitetura também é documentada com o [C4 model](https://c4model.com) (Contexto, Container e Componente) em [`docs/c4/`](./c4), com as imagens dos diagramas e a descrição de cada nível.

