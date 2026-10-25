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
- [Estoque, reservas e movimentações](#estoque-reservas-e-movimentações)
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
│   │                                # QuoteDecisionAction, StockMovementType, Unit,
│   │                                # PartSupplyCategory, SortDirection
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
│   │   └── output/                  # IEmailSenderService, IHashService, ITokenService,
│   │                                # ILogger, IMetrics, ICache, IInternalHttpClient
│   │                                # (output ports)
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
│   │   ├── service/                 # CRUD + métricas (individual e agregada paginada)
│   │   ├── part-supply/             # CRUD + movimentação de estoque
│   │   ├── stock/                   # Consulta de movimentações e reservas
│   │   ├── work-order/              # Criação, busca, atualização, status,
│   │   │                            # status de serviços, histórico
│   │   └── quote/                   # CRUD, itens, envio por e-mail, aprovação/rejeição
│   │                                # (Approve/Reject/Submit/UpdateStatus)
│   ├── exceptions/                  # ResourceNotFoundException, ResourceConflictException,
│   │                                # UnauthorizedAccessException, ServiceRequestRejectedException
│   └── utils/                       # PaginationUtil (sanitização e cálculo de páginas)
│
├── interface-adapters/<domínio>/    # Adapters livres de framework (POJOs, zero @nestjs/*)
│                                    # domínios: auth, customer, customer-access, me,
│                                    # part-supply, quote, service, stock, user, vehicle,
│                                    # work-order
│   ├── <domínio>.controller.ts      # Clean Controller: orquestra o(s) use-case(s) + Presenter
│   ├── <domínio>.presenter.ts       # Entidade → tipo de resposta PURO (sem @ApiProperty)
│   ├── requests/                    # Tipos de request do controller (defaults de paginação aqui)
│   └── responses/                   # <Dom>Response / <Dom>DataResponse / <Dom>PaginatedResponse
│
├── infrastructure/                  # Implementações concretas (framework e serviços externos)
│   ├── config/                      # app-bootstrap (composição da borda HTTP, compartilhada
│   │                                #   entre main.ts e o helper de E2E) + swagger.config
│   ├── health/                      # Saúde operacional, agnóstica de transporte:
│   │   │                            # health.constants (módulo folha: segmentos de rota e o
│   │   │                            #   conjunto fechado de caminhos),
│   │   │                            # postgres.health-check (SELECT 1 com query_timeout
│   │   │                            #   próprio + prazo do chamador; categoria fechada),
│   │   │                            # readiness-state (ready|draining, single-flight, transição)
│   ├── messaging/                   # MessagingModule (@Global: SNSClient, SQSClient),
│   │                                # messaging-clients (clientes SNS/SQS com prazo por pedido),
│   │                                # OutboxRelayService (relay do outbox → SNS FIFO),
│   │                                # SqsConsumerService (sqs-consumer + span CONSUMER),
│   │                                # MessageHandlerRegistry, MessageEnvelopeDto,
│   │                                # messaging-log-bindings (campos messaging.* das linhas)
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
│   │   │                            # rotas /internal entre serviços; e as rotas
│   │   │                            # de saúde em controllers/health/
│   │   ├── guards/                  # AuthenticationGuard (global, nega por padrão) +
│   │   │                            # JwtAuthGuard, CustomerJwtAuthGuard, AnyAuthGuard
│   │   │                            # (aceita interno OU externo), RolesGuard
│   │   ├── decorators/              # @CurrentUser, @Roles, @Public, @CustomerArea
│   │   ├── strategies/              # JwtStrategy (HS256, interno),
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
│   │   ├── repositories/            # Implementações Prisma (13 repositórios, outbox incluído) + PrismaUnitOfWork +
│   │   │                            # RepositoriesModule (@Global) — única pasta a importar @generated/client
│   │   ├── mappers/                 # Conversão Prisma model → Entidade de domínio (16 mappers)
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
├── unit/                            # 229 suites de testes unitários (espelham src/)
│   ├── domain/                      # entities/, value-objects/, validators/
│   ├── application/use-cases/       # auth, customer, customer-access, me,
│   │                                # part-supply, quote, service, stock, user,
│   │                                # vehicle, work-order
│   ├── interface-adapters/          # Clean Controllers + Presenters por domínio
│   └── infrastructure/              # http/ (controllers, filters, interceptors, pipes,
│                                    # validators, auth), persistence/prisma, services
├── contracts/                       # Fixtures do contrato das rotas /internal
│                                    # (internal-work-order.json)
└── e2e/                             # 17 suites de testes E2E (Testcontainers: PostgreSQL,
    │                                #   Valkey e LocalStack reais)
    ├── all-exceptions.filter.e2e-spec.ts
    ├── auth.e2e-spec.ts
    ├── customer.e2e-spec.ts
    ├── customer-access.e2e-spec.ts
    ├── health.e2e-spec.ts
    ├── internal.e2e-spec.ts           # GET /internal/work-orders/:id contra a fixture
    ├── logging.e2e-spec.ts
    ├── me.e2e-spec.ts                 # /api/me/*: identidade externa, senha, OS e
    │                                  # orçamentos vinculados, decisão de orçamento
    ├── messaging.e2e-spec.ts          # outbox → SNS → SQS → handler, lock do relay
    ├── part-supply.e2e-spec.ts
    ├── quote.e2e-spec.ts
    ├── service.e2e-spec.ts
    ├── stock.e2e-spec.ts
    ├── telemetry.e2e-spec.ts
    ├── user.e2e-spec.ts
    ├── vehicle.e2e-spec.ts
    └── work-order.e2e-spec.ts

app/prisma.config.ts                 # Configuração do Prisma v7 (schema, migrations, seed e datasource)

app/prisma/
├── schema.prisma                    # Schema do banco (19 modelos, 8 enums)
├── migrations/                      # Migrations geradas pelo Prisma — inclui a sequence
│                                    # `work_order_number_seq` (números de OS),
│                                    # endurecimento de cascade deletes,
│                                    # versionamento (colunas `version`) e índices
├── generated/                       # Prisma Client gerado (output local)
├── seed.ts                          # Entry point do seed
└── seeds/                           # Scripts de seed por entidade (work-order-status-info,
                                     # user, customer, vehicle, service, part-supply, work-order)
                                     # + seed-ids (UUIDs canônicos, ver seed-ids.md)
```

## Modelos do banco de dados

19 modelos, cobrindo identidade/acesso, veículos, catálogo, Ordem de Serviço, orçamento, estoque e o outbox da mensageria. Diagrama entidade-relacionamento (com os tipos reais do Postgres), explicação tabela a tabela, enums e convenções de modelagem: ver [`docs/database.md`](database.md).

## DDD — Aggregate Roots, Entidades e Value Objects

O domínio é modelado seguindo princípios de DDD:

- **Aggregate Roots** — `WorkOrder` e `Quote` são raízes de agregado. Toda mutação de itens (serviços, peças/insumos), transições de status e cálculos de totais ocorrem **através** da raiz, que protege os invariantes do agregado.
  - `WorkOrder` encapsula seus `WorkOrderService[]` e `WorkOrderPartSupply[]`, controla as transições de status (state machine), recalcula `totalAmount`, valida o mecânico atribuído (apenas usuários ativos com role `MECHANIC`) e aplica os itens herdados de um orçamento aprovado (`applyQuoteItems`). Os serviços iniciam/finalizam pela raiz (`startServiceItem` / `completeServiceItem`), que promove a OS para `IN_PROGRESS` no primeiro `start` e para `COMPLETED` quando todos os serviços estão concluídos.
  - `Quote` encapsula seus `QuoteService[]` e `QuotePartSupply[]`, recalcula `servicesAmount` / `partsAmount` / `totalAmount` automaticamente e expõe operações `submit()`, `approve()` e `reject()` que validam o status atual antes da transição.
- **Entidades** — `Customer`, `Vehicle`, `Service`, `PartSupply`, `User`, `StatusHistory`, `StockMovement`, `StockReservation`, `WorkOrderService`, `WorkOrderPartSupply`, `QuoteService`, `QuotePartSupply`. Possuem identidade própria, estado mutável e validações de invariantes nos próprios métodos (`changeRole`, `changePassword`, `reserve`, `release`, etc.).
- **Value Objects** — imutáveis, sem identidade, validados na criação:
  - `Document` (CPF ou CNPJ com dígito verificador), `Email`, `Phone`, `Plate` (placa antiga `ABC-1234` ou Mercosul `ABC1D23` — sanitizada para maiúsculas e sem hífen), `ZipCode`, `Address`, `LineItemPrice` (quantidade × preço unitário com cálculo de total), `WorkOrderNumber` (número da OS validado e normalizado com zero-padding para o comprimento mínimo).
- **Reconstituição** — todas as entidades expõem `static create(...)` (com validações completas) e `static reconstitute(...)` (rehidratação a partir do banco, sem revalidar dados já persistidos). Os mappers da infraestrutura sempre usam `reconstitute`, evitando o custo de revalidar dados já consistentes e permitindo carregar agregados em estados intermediários (ex.: `APPROVED` ou `IN_PROGRESS`) que `create` não autorizaria.
- **Enriquecimento de entidades** — relações expostas em consultas usam **referências completas** (`item.service`, `item.partSupply`, `quote.workOrder`, `wo.customer`, `wo.vehicle`, `wo.assignedUser`) carregadas via Prisma `include`. Os presenters projetam os campos necessários para o cliente HTTP.

## Concorrência otimista

Os agregados expostos a operações concorrentes (`WorkOrder`, `Quote`, `PartSupply`) possuem uma coluna `version` (Int) usada como **lock otimista**. Toda atualização verifica `WHERE id = ? AND version = ?` e incrementa a versão. Quando o Prisma retorna o erro `P2025` (registro não encontrado para o filtro), a infraestrutura traduz para uma `ConcurrencyException`, que o filtro de exceções mapeia para **HTTP 409 Conflict**, instruindo o cliente a tentar novamente.

Esse mecanismo protege fluxos críticos como atualização de status de OS, aprovação/rejeição de orçamentos e movimentações concorrentes de estoque (incluindo reservas durante a aprovação de um orçamento).

## Perfis de usuário (RBAC)

A **autenticação** é negada por padrão: o `AuthenticationGuard` (`infrastructure/http/guards/authentication.guard.ts`) é registrado como `APP_GUARD` e roda em toda rota. Sem marcação, a rota exige o token de funcionário (`JwtAuthGuard`); `@Public()` dispensa o token; `@CustomerArea()` exige o token do Cliente da Oficina (`CustomerJwtAuthGuard`) e `@CustomerArea('any')` aceita qualquer um dos dois (`AnyAuthGuard`). Uma rota nova sem marcação nasce protegida, e esquecer o guard deixa de abrir a rota. Os usos de `@Public()` são, por método, `POST /auth/login`, `POST /auth/refresh` e `POST /auth/password-reset-confirmations` (não há JWT nesses pontos do fluxo) e, por classe, as rotas de saúde e as rotas `/internal` (ver [Chamadas internas](#chamadas-internas)).

A **autorização interna** é por papel, via `RolesGuard` + decorator `@Roles(...)`, aplicada **por controller** (`@UseGuards(RolesGuard)` na classe). O `RolesGuard` roda depois do guard global, com o `req.user` já preenchido.

| Perfil | Permissões |
|---|---|
| `ADMIN` | Acesso completo (usuários, serviços, peças/insumos, clientes, veículos, OS, orçamentos, métricas, estoque, concessão/revogação de acesso externo) |
| `MECHANIC` | Operação de OS e orçamentos, atualização de status de serviço, consulta de catálogos (serviços, peças/insumos) |
| `ATTENDANT` | Cadastro de clientes/veículos, criação e gestão de OS e orçamentos, movimentação manual de estoque, concessão/revogação de acesso externo |

O **Cliente da Oficina** (usuário externo) não tem `role` no sentido RBAC — `UserRole` continua com apenas `ADMIN`/`MECHANIC`/`ATTENDANT`, papéis de dentro da oficina. Suas rotas (`/api/me/*`) usam um guard e uma política de autorização completamente separados — ver a seção seguinte.

## Identidade externa, autenticação e autorização por vínculo

Três conceitos que o modelo mantém deliberadamente separados:

- **`User`** — identidade com credenciais (e-mail + senha com hash). Um `User` pode ter uma `role` interna (RBAC), vínculos externos com um ou mais `Customer` (`UserCustomer`), os dois ao mesmo tempo, ou nenhum dos dois ainda.
- **`Customer`** — a parte comercial (pessoa física ou jurídica dona do veículo/OS). Nunca tem credencial própria; uma empresa (`CustomerType.COMPANY`) nunca loga diretamente.
- **`UserCustomer`** — o vínculo (many-to-many) que autoriza um `User` a agir em nome de um `Customer`. Não existe um campo `accessType`: a semântica (acesso à própria pessoa física vs. representação de uma empresa) deriva de `Customer.type`.

Dois fluxos de autenticação totalmente isolados, cada um com sua própria estratégia Passport, nunca um verificador compartilhado:

| | Interno | Externo (Cliente da Oficina) |
|---|---|---|
| Estratégia Passport | `jwt` (`JwtStrategy`) | `customer-jwt` (`CustomerJwtStrategy`) |
| Algoritmo | HS256 | RS256 |
| Chave | `JWT_SECRET` (simétrica) | `CUSTOMER_JWT_PUBLIC_KEY` (só a pública — a privada vive na função serverless externa) |
| Emissor do token | `POST /api/auth/login` (interno) | Função serverless externa, autenticando por CPF + senha |
| Guard HTTP (escolhido pelo `AuthenticationGuard`) | `JwtAuthGuard` (rota sem marcação) | `CustomerJwtAuthGuard` (`@CustomerArea()`); `AnyAuthGuard` aceita os dois em `GET /api/me` e `PATCH /api/me/password` (`@CustomerArea('any')`) |
| Carrega `role`/`customerId` no payload? | `role`, sim | **Não** — só `sub` (o `userId`) |

Diagrama de sequência completo desse fluxo (função serverless externa + `AnyAuthGuard` + `CustomerJwtStrategy`): ver [`docs/sequence-diagrams.md`](sequence-diagrams.md#autenticação-externa-do-cliente-da-oficina-cpf).

**A autorização externa é resolvida a cada requisição, nunca embutida no JWT.** O token externo carrega apenas o `userId` (`sub`); nenhuma rota `/api/me/*` confia em um `customerId` do payload. `CustomerJwtStrategy.validate()` já rejeita o principal se o usuário estiver inativo ou não tiver nenhum vínculo ativo (`findActiveCustomerIdsByUserId`), e a `CustomerAccessPolicy` (`application/policies/customer-access.policy.ts`) repete essa resolução em cada caso de uso de `/api/me/*` que precisa autorizar contra um recurso específico (`FindMyWorkOrderById`, `FindAllMyWorkOrders`, `FindMyWorkOrdersQuotes`, `FindMyQuoteById`, `DecideMyQuote`). Isso faz uma remoção de vínculo (`DELETE /customers/:id/users/:userId`) ou uma desativação de cliente (`PATCH /customers/:id`) valer **imediatamente**, sem precisar de lista de revogação de token. Pelo mesmo caminho — o `User` já recarregado do banco a cada requisição —, `JwtStrategy`, `CustomerJwtStrategy` e `RefreshTokenUseCase` também comparam o `iat` do token com `User.passwordChangedAt`: qualquer token emitido antes da última troca de senha (autenticada ou por reset) é recusado, sem lista de revogação de JWT.

**A política nunca lança 403.** `CustomerAccessPolicy.assertCustomerAuthorized` traduz recurso inexistente e recurso não autorizado para o **mesmo** `ResourceNotFoundException` (HTTP 404) — a rota nunca vira um oráculo de enumeração que revela se uma OS ou orçamento de outro cliente existe.

Ver [ADR 0004](./adr/0004-autenticacao-de-clientes.md) para o raciocínio completo por trás dessas decisões.

## Unit of Work

Operações que tocam múltiplos repositórios são executadas dentro de uma transação Prisma gerenciada pelo contrato `IUnitOfWork`. O `PrismaUnitOfWork` injeta todos os repositórios já conectados à transação ativa em uma única callback (`executeTransaction(repos => ...)`), garantindo atomicidade.

Casos de uso transacionais incluem:

- **Criação de OS** — cria a OS + registra `StatusHistory` inicial.
- **Atualização de status de OS** (`PATCH /work-orders/:id`) — atualiza OS + registra histórico.
- **Atualização de status de serviço da OS** — atualiza item, eventualmente promove OS para `IN_PROGRESS` / `COMPLETED`, consome reservas e gera `StockMovement` de saída quando aplicável, registra histórico.
- **Aprovação de orçamento** — aprova orçamento, reserva estoque, materializa itens na OS, transiciona OS para `APPROVED`, rejeita demais orçamentos pendentes da mesma OS e registra histórico.
- **Rejeição de orçamento** — rejeita o orçamento; transiciona a OS para `REJECTED` **apenas se não houver outro orçamento ainda em `SENT`** para a mesma OS (propostas concorrentes) e registra histórico — caso contrário a OS permanece `AWAITING_APPROVAL`.
- **Envio de orçamento** — exige que a OS já tenha sido diagnosticada (nunca `RECEIVED`; aceita `IN_DIAGNOSIS`, `AWAITING_APPROVAL` ou `REJECTED`); transiciona o orçamento para `SENT` e avança a OS para `AWAITING_APPROVAL` quando ela ainda está em `IN_DIAGNOSIS`/`REJECTED` (se já estiver `AWAITING_APPROVAL`, permanece — orçamentos concorrentes), registra histórico e dispara e-mail com tokens assinados.
- **Movimentação manual de estoque** — atualiza `PartSupply` + cria `StockMovement` (com `workOrderId` opcional).
- **Manipulação de itens do orçamento** — adicionar/atualizar/remover serviço ou peça/insumo recalcula totais e persiste o agregado dentro da transação.

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
| `SENT` | `APPROVED` | `approve()` (manual via PATCH ou link de e-mail) |
| `SENT` | `REJECTED` | `reject()` (manual ou via link; `reason` opcional no PATCH) |

Itens (serviços e peças/insumos) só podem ser adicionados, atualizados ou removidos enquanto o orçamento estiver `PENDING`. A OS deve estar em `IN_DIAGNOSIS`, `AWAITING_APPROVAL` ou `REJECTED` para que um novo orçamento possa ser criado via `POST /quotes`. Exceção: `POST /work-orders` pode criar um orçamento diretamente para uma OS recém-criada (`RECEIVED`) ao receber itens inline — sem passar pelo gate de status, pois a validade é garantida pelo próprio fluxo de criação. Esse orçamento, porém, só pode ser **enviado** (`POST /quotes/:id/submissions`) depois que a OS passar pelo diagnóstico — tentar enviar com a OS ainda em `RECEIVED` retorna **HTTP 409**.

Podem coexistir vários orçamentos `SENT` para a mesma OS (propostas concorrentes — ex.: uma completa e uma econômica). **Aprovar** um materializa seus itens, leva a OS a `APPROVED` e rejeita automaticamente os demais (`rejectPendingByWorkOrderId`, que cobre `PENDING` e `SENT`); **rejeitar** um mantém a OS em `AWAITING_APPROVAL` enquanto houver outro `SENT`, levando a OS a `REJECTED` apenas quando o último `SENT` é recusado.

## Estoque, reservas e movimentações

Cada `PartSupply` controla três campos: `stock` (estoque físico), `reservedStock` (já comprometido com OS aprovadas) e `version` (lock otimista). Tipos de movimentação: `ENTRY`, `EXIT`, `ADJUSTMENT`.

Fluxo automático no ciclo de vida da OS:

1. **Aprovação de orçamento** — para cada peça/insumo do quote aprovado, o caso de uso valida estoque disponível (`stock - reservedStock`), incrementa `reservedStock` no `PartSupply` e cria um registro em `StockReservation`. Os itens são materializados como `WorkOrderPartSupply` na OS e o `totalAmount` da OS é recalculado.
2. **Início do primeiro serviço (`IN_PROGRESS`)** — quando um serviço da OS é iniciado e a OS transiciona para `IN_PROGRESS`, todas as reservas vinculadas à OS são consumidas: o `PartSupply` tem `stock` e `reservedStock` decrementados, é criado um `StockMovement` de tipo `EXIT` por reserva (com `reason` automático `"Saída por Ordem de Serviço <número>"`) e os registros de `StockReservation` são removidos.
3. **Movimentação manual** — o endpoint `PATCH /parts-supplies/:id` permite registrar `ENTRY`, `EXIT` ou `ADJUSTMENT` com `reason` e `workOrderId` opcionais, sempre validando que a saída não comprometa o estoque já reservado.

## Aprovação de orçamento pelo Cliente da Oficina autenticado

O fluxo atual exige autenticação do Cliente da Oficina por CPF e senha e mantém a decisão em um `POST` autenticado (ver [ADR 0004](./adr/0004-autenticacao-de-clientes.md)):

1. `POST /quotes/:id/submissions` continua exigindo que a OS já tenha sido diagnosticada — `WorkOrder.ensureCanSubmitQuote()` exige que ela **não** esteja em `RECEIVED` (aceita `IN_DIAGNOSIS`, `AWAITING_APPROVAL` ou `REJECTED`; caso contrário, **HTTP 409**). O agregado `Quote` transiciona para `SENT`; a OS avança para `AWAITING_APPROVAL` quando estava em `IN_DIAGNOSIS`/`REJECTED` (se já estava `AWAITING_APPROVAL` — orçamento concorrente — permanece), com histórico registrado. Um e-mail é enviado ao cliente (via `IEmailSenderService` → MailHog em dev) **avisando** que há um orçamento pendente — sem token de decisão embutido.
2. O Cliente da Oficina se autentica de forma totalmente independente: uma função serverless externa recebe CPF + senha, consulta o banco diretamente e, se as credenciais forem válidas, emite um JWT assimétrico (RS256) contendo apenas `{ sub: userId, iss, aud, iat, exp }` — nunca um `customerId` ou `quoteId`.
3. Com esse token, o cliente consulta seus orçamentos vinculados — `GET /api/me/work-orders`, `GET /api/me/work-orders/:id/quotes`, `GET /api/me/quotes/:id` — e decide em `POST /api/me/quotes/:id/decisions` (body `{ action: 'approve' | 'reject', reason? }`). Cada uma dessas rotas passa pela `CustomerAccessPolicy` antes de tocar o orçamento (ver [seção anterior](#identidade-externa-autenticação-e-autorização-por-vínculo)); um orçamento de um cliente não vinculado ao usuário autenticado responde **HTTP 404**, nunca 403.
4. A materialização da decisão (reserva de estoque, transição de status da OS, rejeição de propostas concorrentes) usa a lógica de domínio compartilhada: `DecideMyQuoteUseCase` delega para `UpdateQuoteStatusUseCase`, também usado por `PATCH /quotes/:id` (aprovação/rejeição manual), que por sua vez chama `ApproveQuoteUseCase`/`RejectQuoteUseCase`.

## Mensageria, cache e chamadas internas

O serviço conversa com os outros serviços da oficina por dois caminhos: **mensagens** assíncronas num tópico SNS FIFO (`oficina-events.fifo`), entregues a cada serviço pela própria fila SQS FIFO, e **chamadas REST internas** (`/internal/...`) pela rede do cluster. Cada serviço é o único cliente do próprio PostgreSQL e do próprio cache: nenhum lê o banco de outro.

### Outbox e relay

Uma mensagem nunca é publicada de dentro do caso de uso. Ela é gravada na tabela `outbox` pelo `IOutboxRepository` (`repos.outbox.add(message)`), dentro da **mesma transação** do Unit of Work que muda o estado: ou as duas escritas são confirmadas, ou nenhuma. Não há dupla escrita entre banco e broker.

- O tipo e o payload vêm do catálogo tipado e fechado de `domain/messaging/` (`inventory`, `billing` e `notification`). `OutboxMessage` é uma união discriminada por `type`: tipo fora do catálogo, ou payload de outro tipo, não compila.
- A linha guarda `id` sequencial (ordem de criação), `message_id` (UUID v4, a identidade da mensagem entre serviços), `type`, `work_order_id`, `payload` (`jsonb`), `trace_context` (o contexto W3C ativo no momento do `add`) e `created_at` (`timestamptz`). `work_order_id` tem FK `Restrict` para `work_orders`.
- O `OutboxRelayService` roda no próprio processo a cada 500 ms (um `setTimeout` rearmado ao fim de cada lote, então dois lotes nunca se sobrepõem). Cada lote abre uma transação e tenta `pg_try_advisory_xact_lock`: só uma réplica publica por vez, e as outras pulam a rodada em vez de esperar.
- Com o lock, o relay lê até **10 linhas** por `id`, publica uma a uma por `PublishCommand`, com o contexto de trace da linha restaurado, e apaga as publicadas na mesma transação. Ele **para no primeiro erro**, para não furar a ordem: a linha que falhou e as seguintes ficam para o próximo lote. Cada falha registra `messaging.outbox.publish_failed`. O lote tem de caber nos 5 s da transação interativa do Prisma, senão as exclusões são desfeitas e o mesmo início é republicado a cada rodada. Por isso cada `Publish` tem prazo de 2 s, sem retentativa do SDK (a retentativa é o próximo lote), e o relay não começa uma publicação depois de 2 s de lote: as que ficaram saem na rodada seguinte.
- A mensagem publicada leva o envelope `{ messageId, type, occurredAt, workOrderId, payload }`, o `MessageGroupId` igual ao `workOrderId` (ordem por OS; sem OS, o próprio `messageId`), o `MessageDeduplicationId` igual ao `messageId` e o atributo `type`, que as filter policies do tópico usam para rotear.
- No encerramento, o relay para no `beforeApplicationShutdown` e espera o lote em voo, antes de o Prisma desconectar.

### Consumo de mensagens

O `SqsConsumerService` lê a fila do serviço (`WORK_ORDER_QUEUE_NAME`, URL resolvida por `GetQueueUrl`) com `sqs-consumer`, em long polling de 20 s e **uma mensagem por vez** (`batchSize: 1`): com lote maior, a biblioteca processaria as mensagens em paralelo e furaria a ordem por OS.

Para cada mensagem, o consumidor:

1. extrai o contexto W3C dos atributos e abre um span `CONSUMER` (`process work-order.fifo`), a única instrumentação manual da aplicação (ver [Observabilidade](observability.md#consumo-de-mensagens));
2. valida o envelope (`MessageEnvelopeDto`, class-validator) e, quando o handler declara uma classe de payload, o payload. A mensagem de erro leva só os nomes das propriedades, nunca valores;
3. procura o handler pelo `type` no `MessageHandlerRegistry`, que os módulos preenchem no `onModuleInit`, e o chama.

Toda linha de log desse processamento carrega `messaging.*`, `oficina.messaging.message.type`, `oficina.work_order.id` e `request.id` igual ao `messageId`, então as linhas de uma mensagem se correlacionam como as de uma requisição.

**A mensagem só é apagada da fila quando o handler termina sem erro.** Erro, envelope inválido ou tipo sem handler deixam a mensagem na fila, e o SQS a entrega de novo depois do visibility timeout. Tipo sem handler registra `messaging.message.unhandled` (`warn`): a fila só recebe os tipos que a filter policy roteia ao serviço, então chegar sem handler é uma janela de deploy, e confirmar perderia a mensagem. Na quinta entrega (`ApproximateReceiveCount` = 5, o `maxReceiveCount` da fila) o consumidor registra `messaging.message.dead_lettered` e o SQS move a mensagem para a DLQ (`work-order-dlq.fifo`), de onde ela volta por redrive. Os handlers devem ser idempotentes pelo `messageId`, porque o SQS entrega pelo menos uma vez.

No encerramento, o consumidor para no `beforeApplicationShutdown` com `stop({ abort: true })`, que cancela o long polling, e espera o evento `stopped`. O handler em voo tem 5 s para terminar. O `abort` também cancela o `DeleteMessage` de um handler que acabou de terminar: essa mensagem volta, e a idempotência por `messageId` a absorve. Os pedidos cancelados pelo encerramento não viram log de erro. Fora dele, o cliente SQS tem prazo de 25 s por pedido, acima dos 20 s do long polling, para que uma conexão que não responde não trave o consumidor.

### Cache do detalhe da OS

O detalhe da OS (`GET /api/work-orders/:id` e `GET /internal/work-orders/:id`) usa **cache-aside** no Valkey (ElastiCache no cluster), pela porta `ICache` (`application/ports/output/`) e o `ValkeyCacheAdapter` sobre `ioredis`.

- **Chave e validade:** `work-order:work-order:<id>` (`workOrderCacheKey`), com TTL de `CACHE_TTL_SECONDS` (padrão 43.200 s, 12 h).
- **Valor:** um snapshot JSON da OS montado pelo `WorkOrderCacheMapper`, com `cacheVersion`. O snapshot não leva o usuário atribuído: na leitura do cache, o caso de uso busca o usuário por id, então o hash de senha não vai ao cache e o nome do mecânico não fica velho. Valor que não se lê (JSON inválido, campo que o domínio rejeita ou `cacheVersion` diferente do atual) conta como falta e é relido do banco e regravado. Assim, um valor gravado por outra versão do código não responde 500 depois de um deploy.
- **Invalidação depois do commit:** os casos de uso que escrevem na OS (`UpdateWorkOrder`, `UpdateWorkOrderStatus`, `UpdateWorkOrderServiceStatus`, `SubmitQuote`, `ApproveQuote` e `RejectQuote`), no cliente (`UpdateCustomer`) e no veículo (`UpdateVehicle`) apagam as chaves afetadas **depois** da transação, com o resultado devolvido do callback, como os eventos de negócio. Cliente e veículo buscam as próprias OS para saber quais chaves apagar. A exclusão de cliente e de veículo não invalida nada: ela só acontece quando nenhuma OS os referencia.
- **Itens de catálogo:** escrita em serviço ou peça não invalida o detalhe das OS. Nome, descrição, SKU, unidade e categoria dos itens podem ficar até 12 h desatualizados no cache; preço, quantidade, total e status não, porque o item da OS guarda o próprio preço e as escritas na OS apagam a chave.
- **Cache fora do ar vira leitura no banco**, nunca erro nem fila de espera: o cliente roda com `enableOfflineQueue: false`, `maxRetriesPerRequest: 1` e `commandTimeout` de 500 ms, para que um Valkey que aceita TCP e não responde também caia para o banco. Falha de leitura ou gravação registra `cache.unavailable` (`warn`) e a leitura conta como falta; falha de exclusão registra `cache.invalidation_failed` (`error`), e a chave expira pelo TTL.

A área do Cliente da Oficina (`/api/me/*`) não usa o cache.

### Chamadas internas

As rotas `/internal/...` atendem só outros serviços, pela rede do cluster. Elas ficam em `infrastructure/http/controllers/internal/`, **fora do prefixo `api`** (que é o que o API Gateway encaminha), marcadas com `@Public()` e fora do Swagger (`@ApiExcludeController`). Cada uma delega ao Clean Controller existente.

| Rota | Resposta |
|---|---|
| `GET /internal/work-orders/:id` | `200` com o mesmo corpo de `GET /api/work-orders/:id` (`{ data: { ... } }`), `400` para id que não é UUID, `404` para OS inexistente |

O dono de cada rota versiona a fixture da resposta em `app/test/contracts/`, conferida pelo próprio e2e (ver [Testes](testing.md#contrato-das-rotas-internal)).

Para chamar outro serviço, o caso de uso usa a porta `IInternalHttpClient` (`application/ports/output/`), implementada pelo `InternalHttpClient` sobre o `HttpService` do `@nestjs/axios`:

- envia o `x-request-id` do contexto atual (o da requisição HTTP ou, num handler de mensagem, o `messageId`). O `traceparent` é injetado pela instrumentação HTTP do OpenTelemetry, e a chamada aparece como span `CLIENT`;
- usa prazo de 2 s por padrão (`timeoutMs` muda o prazo de uma chamada), sem retentativa e sem seguir redirecionamento;
- converte o 4xx do serviço chamado em `ServiceRequestRejectedException`, que o filtro responde com o mesmo status e a mensagem do dono; timeout, falha de conexão e 5xx viram `ServiceIntegrationException` (503).

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
executa somente migration/seed; `app-deploy` aplica a imagem e aguarda o rollout; `api-secret` permanece separado,
somente com material JWT. Nenhum Pod lê AWS e não há ESO ou Secrets Store CSI.

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
- [ADR 0013 — Autenticação interna via JWT stateless (access + refresh)](./adr/0013-autenticacao-interna-jwt-stateless.md)
- [ADR 0014 — Pipelines de CI, CD, SAST e DAST separados](./adr/0014-pipelines-ci-cd-sast-dast-separados.md)
- [ADR 0015 — Testes E2E contra PostgreSQL real via Testcontainers, não mocks](./adr/0015-testcontainers-e2e-postgresql-real.md)
- [ADR 0016 — Sanitização e validação de entrada em duas camadas](./adr/0016-sanitizacao-e-validacao-em-duas-camadas.md)
- [ADR 0017 — Materialização da credencial do banco no CD](./adr/0017-materializacao-da-credencial-do-banco-no-cd.md)
- [ADR 0018 — Mensageria SNS/SQS FIFO com outbox transacional](./adr/0018-mensageria-sns-sqs-fifo-com-outbox.md)
- [ADR 0019 — Cache do dono no ElastiCache](./adr/0019-cache-do-dono-no-elasticache.md)
- [ADR 0020 — Chamadas internas pela rede do cluster e rotas públicas negadas por padrão](./adr/0020-chamadas-internas-e-rotas-negadas-por-padrao.md)
- [ADR 0021 — Span de consumo de mensagens](./adr/0021-span-de-consumo-de-mensagens.md)

## Modelo C4

A arquitetura também é documentada com o [C4 model](https://c4model.com) (Contexto, Container e Componente) em [`docs/c4/`](./c4), com as imagens dos diagramas e a descrição de cada nível.

