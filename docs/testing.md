# 🧪 Testes

## Índice

- [Unitários](#unitários)
- [E2E](#e2e)
- [BDD (testes de aceitação)](#bdd-testes-de-aceitação)
- [Cenários de falha F1 a F14](#cenários-de-falha-f1-a-f14)
- [Autenticação externa nos testes (customer-jwt)](#autenticação-externa-nos-testes-customer-jwt)
- [Telemetria: o que o Jest não instrumenta](#telemetria-o-que-o-jest-não-instrumenta)
- [Mensageria e cache no E2E](#mensageria-e-cache-no-e2e)
- [Inventory e Billing no E2E](#inventory-e-billing-no-e2e)
- [Contrato das rotas `/internal`](#contrato-das-rotas-internal)
- [Mensagem de teste no ambiente](#mensagem-de-teste-no-ambiente)
- [Postman / Newman](#postman--newman)
- [Indisponibilidade de dependência e encerramento gracioso](#indisponibilidade-de-dependência-e-encerramento-gracioso)
- [Cobertura E2E — o que não é alcançável por HTTP](#cobertura-e2e--o-que-não-é-alcançável-por-http)

## Unitários

```bash
npm test          # executa os testes
npm run test:cov  # com relatório de cobertura
```

Os scripts rodam o Jest como `node --experimental-vm-modules node_modules/jest/bin/jest.js`, nunca `npx jest`. Os pacotes do NestJS 12 são só ESM, e o Jest só faz `require` de ESM com `vm.SourceTextModule`, que o Node só expõe com essa flag; sem ela, as suítes que importam `@nestjs/*` falham com `Must use import to load ES Module`. Para um arquivo só: `npm test -- <caminho>`.

As suítes cobrem todas as camadas (`application/`, `domain/` — incluindo entidades, value objects e validators —, `interface-adapters/` e `infrastructure/`). Use-cases são instanciados diretamente com mocks do tipo `jest.Mocked<IRepository>` (ou `jest.Mocked<IUnitOfWork>` onde aplicável) — sem NestJS DI, sem banco de dados. Os Clean Controllers são instanciados diretamente com use-cases mockados; a borda HTTP (`@Controller` fino) é exercitada via `jest.spyOn` no Clean Controller real. As factories de mocks (incluindo `UnitOfWorkMockFactory`) estão em `test/helpers/`, organizadas por entidade.

195 suites e 1997 testes, com **100% de cobertura em lines, statements, functions e branches**. O piso é declarado em `package.json` → `jest.coverageThreshold`, então `npm run test:cov` (e com ele o job `unit-tests` do CI) falha quando qualquer uma das quatro métricas cai abaixo de 100% — foi assim que a cobertura voltou a ser um contrato verificado em vez de um número observado.

A cobertura é coletada em todo `src/**` (todas as camadas — `domain/`, `application/`, `interface-adapters/` e `infrastructure/`). As exclusões são por sufixo/caminho, não por camada: `*.module.ts`, `main.ts`, `otel.ts`, `*.enums.ts`, `*.config.ts`, `*.exception.ts`, `*.dto.ts`, `infrastructure/persistence/prisma/prisma.service.ts` e `domain/constants/**` (ver `package.json` → `jest.collectCoverageFrom`). Os arquivos gerados pelo Prisma ficam de fora por viverem em `prisma/generated/`, fora de `src/`.

`src/otel.ts` é excluído pelo mesmo motivo que `main.ts`: é ponto de entrada de processo, não código chamado pela aplicação. O caminho ligado depende de `OTEL_EXPORTER_OTLP_ENDPOINT` e de o SDK ser registrado por `node --require` — e a auto-instrumentação **não funciona sob Jest** (ver [Telemetria: o que o Jest não instrumenta](#telemetria-o-que-o-jest-não-instrumenta)), de forma que um teste ali ficaria verde sem verificar nada e ainda abriria um exportador de fundo nas suítes. Quem o cobre é `npm run test:smoke`, num processo real, dentro do job `build` do CI. O interruptor desligado — a garantia de que sem endpoint nenhum módulo do SDK é carregado — continua asserido em `test/unit/otel.spec.ts`.

## E2E

```bash
npm run test:e2e      # executa os testes
npm run test:e2e:cov  # com cobertura
```

16 suites cobrindo todos os domínios (auth, user, customer, customer-access, vehicle, service — as métricas por serviço —, work-order) mais `me` (rotas do Cliente da Oficina autenticado), uma suite dedicada ao `AllExceptionsFilter`, outra ao logging estruturado, outra aos endpoints de saúde, outra à telemetria (correlação log-trace e métricas de negócio), outra às rotas `/internal`, outra à mensageria, outra à Saga de aprovação e às mensagens de orçamento do Billing e outra à Saga de cobrança. Os testes E2E sobem um PostgreSQL 18 real (`postgres:18-alpine`), um Valkey 9.1 real e um MailHog via **Testcontainers 12** (sem necessidade de banco externo), mais o LocalStack nas suítes de mensageria e das Sagas (ver [Mensageria e cache no E2E](#mensageria-e-cache-no-e2e)), e respondem pelo Inventory e pelo Billing com um stub HTTP (ver [Inventory e Billing no E2E](#inventory-e-billing-no-e2e)) e usam helpers compartilhados em `test/helpers/` (`test-app.helper.ts`, `auth.helper.ts`, `db-cleanup.helper.ts`) para subir o `INestApplication`, autenticar e limpar o banco entre testes. Configuração em `test/jest-e2e.json` (timeout de 10 minutos para acomodar a inicialização dos containers).

O motivo de testar contra um Postgres real (em vez de mocks Prisma) é validar comportamentos que dependem do banco — constraints de unicidade, cascade deletes, sequences, conversões de tipos, índices e a corrida implícita de updates condicionados (`WHERE version = ?`) — e detectar regressões em migrations.

### Captura de logs no E2E

Não existe `LOG_LEVEL=silent` global: isso silenciaria também a suite de logging que precisa capturar a saída. Os testes unitários ficam quietos por usarem `createMockLogger()` (`test/helpers/logger-mock.factory.ts`); o E2E define destino e nível explicitamente.

`setupTestApp({ captureLogs: true })` injeta um stream de captura na configuração **de produção** do `LoggingModule` e expõe `ctx.logCapture`, com as linhas já parseadas como JSON:

```ts
ctx = await setupTestApp({ captureLogs: true });

await request(ctx.httpServer).get('/api/customers').expect(401);

const [line] = ctx.logCapture!.lines().filter((l) => l.message === 'http request');
expect(line['http.response.status_code']).toBe(401);
```

O seam é real: o `LoggingModule` é configurado com `LoggerModule.forRootAsync` e tokens de DI para o **destino** (`LOGGER_DESTINATION`) e o **nível efetivo** (`LOGGER_LEVEL`), que o helper sobrescreve antes de compilar o módulo. Um `forRoot()` estático não poderia ser redirecionado depois que o `AppModule` já foi importado, e `captureLogs` não capturaria nada. Trocar o módulo inteiro também não serviria — substituiria justamente o middleware e o comportamento de `AsyncLocalStorage` que estão sob teste.

O helper **não** duplica a configuração de bootstrap: ele chama `configureApp()`
(`src/infrastructure/config/app-bootstrap.ts`), a mesma função que o `main.ts` usa.

Duas opções extras, usadas só pela suíte de logging para que as outras quinze não paguem o custo:

| Opção | O que liga |
| --- | --- |
| `captureBootstrap` | Implica `captureLogs`, liga `bufferLogs` + `useLogger` e guarda uma fotografia das linhas de boot em `ctx.logCapture.bootstrapLines()` **antes** de o `beforeEach` chamar `clear()`. É o único caminho para o teste do dicionário alcançar as chaves que só aparecem quando o próprio Nest loga. |
| `withSwagger` | Registra o Swagger **antes** do `app.init()`. Sem ele, `/api/docs` é um 404 comum do router e a fronteira D19 não é verificável — era por isso que o teste da fronteira afirmava o oposto do próprio nome. |

Shutdown hooks continuam desligados no E2E: ligá-los acumularia listeners de processo entre as suítes.

## BDD (testes de aceitação)

```bash
npm run test:bdd  # a partir de app/, com o Docker em execução
```

BDD (Behavior-Driven Development) descreve o comportamento esperado em cenários de linguagem natural, que rodam como teste. Aqui os cenários ficam em `app/test/bdd/features/`, em Gherkin pt-BR (`# language: pt`, com as palavras-chave `Funcionalidade`, `Contexto`, `Cenário`, `Dado`, `Quando`, `Então` e `E`), e rodam pelo `@cucumber/cucumber` 13.3 contra o work-order real. São três features e cinco cenários:

| Feature | Cenário | O que confere |
|---|---|---|
| `fluxo-completo.feature` | OS da abertura à entrega com a cobrança total paga | A OS aberta com um serviço e uma peça passa por diagnóstico, envio e aprovação do orçamento, reserva da peça, cobrança do valor total paga (com o e-mail do link no MailHog), execução com a baixa do estoque pedida ao Inventory, conclusão e entrega; o histórico mostra `RECEIVED, IN_DIAGNOSIS, AWAITING_APPROVAL, APPROVED, AWAITING_PAYMENT, APPROVED, IN_PROGRESS, COMPLETED, DELIVERED` |
| `compensacao-da-aprovacao.feature` | Reserva confirmada aprova a OS | O Billing aprova, o work-order pede a reserva ao Inventory, o Inventory confirma e a OS fica `APPROVED` |
| `compensacao-da-aprovacao.feature` | Falta de estoque devolve o orçamento e a reaprovação conclui a Saga (F2) | O Inventory recusa a reserva, a reversão é pedida ao Billing para `SENT`, a Saga fica `COMPENSATED` e a OS `AWAITING_APPROVAL`; o Billing aprova de novo, a reserva é confirmada e a mesma Saga fica `COMPLETED`, com a OS `APPROVED` |
| `compensacao-da-cobranca.feature` | Cobrança expirada devolve a OS ao status de origem (F7) | A OS aprovada vai a `AWAITING_PAYMENT`; com a cobrança expirada, a Saga fica `COMPENSATED` e a OS volta a `APPROVED` |
| `compensacao-da-cobranca.feature` | Cobrança com a OS já em execução é cancelada (F6) | Com o serviço iniciado, o pedido de cobrança leva ao cancelamento pedido ao Billing e à Saga `COMPENSATING`; com o cancelamento confirmado, a Saga fica `COMPENSATED`, a OS segue `IN_PROGRESS` e nenhum e-mail com link sai |

**Como roda.** `app/cucumber.js` aponta as features e carrega os passos e o suporte pelo `ts-node`, que lê a seção `ts-node` do `app/tsconfig.json` (`transpileOnly`, `experimentalResolver` e `rootDir`): sem o resolvedor, o client gerado do Prisma, que importa `./x.js` de arquivos `.ts`, não carrega, e o TypeScript 6 recusa a compilação sem `rootDir`.

- `test/bdd/support/hooks.ts` sobe, uma vez por execução (`BeforeAll`), o stub HTTP e o work-order real pelo mesmo `setupTestApp` do E2E, com PostgreSQL, Valkey, LocalStack e MailHog por Testcontainers, e cria o funcionário, o cliente com veículo e o usuário de acesso vinculado que recebe os e-mails. O `AfterAll` derruba tudo.
- `test/bdd/support/world.ts` define o `OficinaWorld`, o estado de cada cenário (o Cucumber cria um por cenário): a OS do cenário, o orçamento, a cobrança e as esperas pela OS e pela Saga, sempre por condição (consulta repetida), nunca por pausa fixa.
- `test/bdd/steps/` separa os passos por participante: `work-order.steps.ts` (as ações dos funcionários e as verificações da OS, do histórico e do MailHog), `billing.steps.ts` e `inventory.steps.ts`.

**Participantes simulados.** Billing e Inventory não sobem. As respostas síncronas vêm do stub HTTP do E2E (ver [Inventory e Billing no E2E](#inventory-e-billing-no-e2e)), com os corpos das fixtures de contrato dos donos. Os eventos que eles publicariam são publicados no tópico do LocalStack pelos passos (`publishEvent`, em `test/bdd/support/sns-events.helper.ts`), com o mesmo envelope do relay, e os comandos que o work-order manda são lidos nas filas `billing.fifo` e `inventory.fifo` pelo `receiveCommands` do E2E. Assim o BDD passa por todos os tipos de mensagem que o work-order troca e confere também as filter policies do script de topologia (`app/localstack/init-topology.sh`). O Identity não participa: os usuários ainda são deste serviço.

**Relatório.** Cada execução grava `app/reports/bdd/cucumber-report.html` (pasta fora do Git), com cada cenário e passo e o resultado. No CI, o job `bdd` (nome `BDD`) roda o mesmo comando e publica a pasta como artifact `bdd-report`, mesmo quando falha (ver [Infra · CI/CD](infra/ci-cd.md)).

## Cenários de falha F1 a F14

A solução numera de F1 a F14 os cenários de falha das Sagas e da mensageria. A tabela liga cada um ao teste que o cobre, com o arquivo e o nome do teste. Os testes de outros repositórios estão na `main` do [Billing](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service) e do [Inventory](https://github.com/FIAP-15SOAT/oficina-mecanica-inventory-service); os caminhos sem repositório são deste, a partir de `app/test/`.

| # | Cenário | Tratamento esperado | Onde é coberto |
|---|---|---|---|
| F1 | O orçamento deixou de estar `SENT` (decisão concorrente) | O 409 do Billing volta como está; nada começa | `e2e/me.e2e-spec.ts` — `should answer the Billing 409 on a concurrent decision` |
| F2 | Estoque insuficiente na reserva | Reversão para `SENT`, Saga `COMPENSATED`, OS em `AWAITING_APPROVAL`; a reaprovação reabre a Saga | `e2e/quote-approval-saga.e2e-spec.ts` — `should compensate the approval when the Inventory refuses the reservation and reopen the saga on a new approval`; `bdd/features/compensacao-da-aprovacao.feature` — `Falta de estoque devolve o orçamento e a reaprovação conclui a Saga` |
| F3 | OS cancelada entre a aprovação e o início da Saga | Reversão para `REJECTED`, Saga `COMPENSATED` | `e2e/quote-approval-saga.e2e-spec.ts` — `should request the reversal to REJECTED when the work order was cancelled before the approval arrived` |
| F4 | Billing ou Inventory fora na abertura da OS | 503, nada gravado | `e2e/work-order.e2e-spec.ts` — `should answer 503 when the Billing is unavailable without consuming a work order number` |
| F5 | A gravação da OS falha depois de o orçamento ser criado | O orçamento é apagado no Billing | `e2e/work-order.e2e-spec.ts` — `should delete the initial quote when the work order write fails` |
| F6 | A OS mudou de status antes de `billing.payment.requested` chegar | `billing.payment.cancel`, Saga `COMPENSATED`, OS inalterada, nenhum e-mail | `e2e/payment-saga.e2e-spec.ts` — `should ask the Billing to cancel the payment when the work order is already in progress`; `bdd/features/compensacao-da-cobranca.feature` — `Cobrança com a OS já em execução é cancelada`; `unit/application/use-cases/payment/start-payment.use-case.spec.ts` — `should start the saga compensating and ask the Billing to cancel the payment when the work order is not payable` |
| F7 | A cobrança expirou, foi recusada ou cancelada pelo funcionário | A OS volta à origem, Saga `COMPENSATED` com o motivo | `e2e/payment-saga.e2e-spec.ts` — `should return the work order to its origin and compensate the saga when the payment expires`; `bdd/features/compensacao-da-cobranca.feature` — `Cobrança expirada devolve a OS ao status de origem`; `unit/application/use-cases/payment/apply-payment-result.use-case.spec.ts` — `should return the work order to its origin and compensate the saga with the payment failure reason (%s)`, com `EXPIRED`, `REJECTED` e `CANCELLED` |
| F8 | O cliente pagou antes de o cancelamento da compensação chegar ao Mercado Pago | O Billing publica `billing.payment.approved`; Saga `COMPLETED`, OS inalterada | `unit/application/use-cases/payment/apply-payment-result.use-case.spec.ts` — `should complete a compensating saga without touching the work order when the payment was approved`; Billing: `app/test/unit/application/use-cases/payment/cancel-payment.use-case.spec.ts` — `should resolve as APPROVED and raise a conflict when the checkout was paid`, e `app/test/unit/infrastructure/messaging/handlers/payment/payment-message-handlers.spec.ts` — `should acknowledge a command whose payment cannot be cancelled` |
| F9 | Mercado Pago fora na criação da cobrança | Nada é gravado; erro ao funcionário | Billing: `app/test/unit/application/use-cases/payment/create-payment.use-case.spec.ts` — `should save nothing when the payment provider fails` |
| F10 | Participante fora do ar: as mensagens acumulam na fila | Nova entrega pela fila; DLQ e alerta depois de 5 recebimentos; a Saga retoma no redrive | `unit/infrastructure/messaging/sqs-consumer.service.spec.ts` — `should rethrow a handler failure and log messaging.message.failed when ApproximateReceiveCount is below 5` e `should log messaging.message.dead_lettered and rethrow when ApproximateReceiveCount is 5`; `e2e/messaging.e2e-spec.ts` — `should keep the group order when the first message fails`. O redrive é manual, pelo [runbook do infra-messaging](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-messaging/blob/main/docs/runbook.md) |
| F11 | Mensagem duplicada | Registra `saga.step_skipped` e confirma, sem efeito | `unit/application/use-cases/payment/start-payment.use-case.spec.ts` — `should skip a redelivered payment request`; `unit/application/use-cases/payment/apply-payment-result.use-case.spec.ts` — `should skip a result for an unknown or settled saga (saga status %s)`; `unit/application/use-cases/quote-approval/start-quote-approval.use-case.spec.ts` — `should skip a repeated approval when the saga is %s`; `compensate-quote-approval.use-case.spec.ts` — `should skip a reservation failure when the saga is not reserving stock (%s)`; `confirm-quote-approval-reversal.use-case.spec.ts` — `should skip a reversal when the saga is %s` |
| F12 | O work-order reinicia no meio de uma Saga | Estado e outbox duráveis; relay e consumidor retomam | Nenhum teste reinicia o processo; o que a retomada exige está coberto em `e2e/messaging.e2e-spec.ts` — `should publish an outbox message and consume it back through a test handler` (a mensagem sai de uma linha do banco, não da memória) e `should leave no outbox row when the transaction rolls back`; `unit/infrastructure/messaging/outbox-relay.service.spec.ts` — `should stop at the first failed publish, keep that row and the next ones and log messaging.outbox.publish_failed with the messaging bindings`; e na Saga, cujo próximo passo é lido de `saga_instances` a cada mensagem (todos os testes de F2 a F8) |
| F13 | A baixa de estoque falha | Nova entrega, DLQ e alerta; a OS segue em `IN_PROGRESS` | `unit/application/use-cases/work-order/update-work-order-service-status.use-case.spec.ts` — `should write the consume command when the first started service moves a work order with parts to IN_PROGRESS`; Inventory: `app/test/e2e/consume-reserved-stock.e2e-spec.ts` — `should roll everything back when the part version changes between read and write`, e `app/test/unit/infrastructure/messaging/sqs-consumer.service.spec.ts` — `should log messaging.message.dead_lettered and rethrow when ApproximateReceiveCount is 5` |
| F14 | O aviso do Mercado Pago (webhook) não chega | O funcionário cancela a cobrança; com a ordem já expirada, o Billing encerra a cobrança como `EXPIRED` e a OS volta pela F7 | Billing: `app/test/unit/application/use-cases/payment/cancel-payment.use-case.spec.ts` — `should close the payment with the checkout status when the cancellation is refused and the checkout already ended (%s)`; a volta da OS, pelos testes da F7 |

## Autenticação externa nos testes (customer-jwt)

A função serverless que emite o token `customer-jwt` (RS256) fica **fora do escopo desta entrega** (ver [ADR 0004](./adr/0004-autenticacao-de-clientes.md)) e vive num repositório à parte, [`oficina-mecanica-lambda-customer-auth`](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth). Para exercitar `/api/me/*` sem criar uma dependência de CI entre os dois repositórios, `test/helpers/customer-jwt.helper.ts` gera um **par de chaves RS256 em tempo de execução** (`generateKeyPairSync`, nunca um PEM comitado no repositório) e expõe `signTestCustomerToken(userId, expiresInSeconds?)`, que assina um token de teste com o mesmo formato de claims que a função serverless emite (`{ sub: userId }`, `iss`/`aud` fixos, RS256).

`setupTestApp()` (`test/helpers/test-app.helper.ts`) injeta a chave **pública** gerada em `process.env.CUSTOMER_JWT_PUBLIC_KEY` antes de compilar o módulo — o mesmo caminho de configuração (`CustomerJwtStrategy` lendo `CUSTOMER_JWT_PUBLIC_KEY`/`CUSTOMER_JWT_ISSUER`/`CUSTOMER_JWT_AUDIENCE` via `ConfigService`) que roda em produção, só que com uma chave efêmera. Isso mantém o teste fiel à verificação real de assinatura/emissor/audiência, sem exigir a Lambda no ambiente de CI.

```ts
import { signTestCustomerToken } from '../helpers/customer-jwt.helper';

const token = signTestCustomerToken(user.id);
await request(ctx.httpServer)
  .get('/api/me/work-orders')
  .set('Authorization', `Bearer ${token}`)
  .expect(200);
```

`test/e2e/me.e2e-spec.ts` é a suite que exercita esse caminho — identidade externa (`GET /api/me`), troca da própria senha via `AnyAuthGuard` (`PATCH /api/me/password`, provando que a rota aceita tanto o token interno quanto o externo, com a nova senha realmente persistida), listagem/consulta de OS e orçamentos vinculados por `CustomerAccessPolicy`, com os orçamentos lidos no stub do Billing, e decisão de orçamento (repasse ao Billing, 404 sem vínculo sem repassar, 409 com aprovação em andamento e o 409 do Billing numa decisão concorrente) — incluindo o caso de um `sub` sem nenhum vínculo ativo (token assinado para um `userId` aleatório) para confirmar a rejeição em `CustomerJwtStrategy.validate()`.

**O DAST cobre `/api/me/*` com uma segunda passagem autenticada como Cliente da Oficina.** O workflow `dast.yml` gera um par de chaves RS256 efêmero **no próprio job de CI**, injeta a chave pública no serviço `api` (substituindo a que a stack usa para o primeiro passe, autenticado como usuário interno) e roda um **segundo** `zap-api-scan.py` com um Bearer `customer-jwt` assinado pela chave privada correspondente, para um usuário externo já semeado — exatamente o mesmo mecanismo de `test/helpers/customer-jwt.helper.ts` descrito acima, só que rodando no job em vez de dentro da suite E2E. Isso não depende da função serverless externa (fora de escopo, ver acima): o próprio job assina, isolado, o token que ela emitiria. Ver [Infra · CI/CD](infra/ci-cd.md#4-workflow-de-dast-dastyml) para o passo a passo do workflow.

## Mensageria e cache no E2E

Toda suíte E2E sobe, além do PostgreSQL, um **Valkey real** (`valkey/valkey:9.1`, `@testcontainers/valkey`), porque o detalhe da OS passa pelo cache em qualquer rota que o lê. O LocalStack só sobe com `setupTestApp({ withMessaging: true })`, a opção das suítes `messaging.e2e-spec.ts`, `quote-approval-saga.e2e-spec.ts` e `payment-saga.e2e-spec.ts` e do BDD: ela inicia o `localstack/localstack:4.14.0` (`@testcontainers/localstack`) com o mesmo `app/localstack/init-topology.sh` do compose, roda o relay e o consumidor reais e aponta `AWS_ENDPOINT_URL` para o container. Nas outras suítes, o relay e o consumidor são substituídos por versões vazias, então nenhuma delas paga o LocalStack.

`messaging.e2e-spec.ts` cobre o que os unitários só simulam:

| Teste | O que prova |
|---|---|
| Ida e volta | Uma linha gravada no outbox sai pelo relay, passa pelo tópico e pela filter policy, volta pela fila `work-order.fifo` e chega a um handler de teste com o envelope `{ messageId, type, occurredAt, workOrderId, payload }`; a linha some do outbox e a fila fica vazia |
| Rollback | Uma transação desfeita não deixa linha no outbox |
| Lock do relay | Com outra transação segurando o `pg_advisory_xact_lock` do relay, nada é publicado; depois do `COMMIT` dela, a mensagem sai |
| Ordem do grupo | A falha da primeira mensagem de uma OS segura as seguintes do mesmo grupo |
| Sem handler | Mensagem sem handler registrado não é confirmada e volta a ser entregue. A suíte troca o módulo de mensageria da cobrança por um vazio, para que `billing.payment.failed`, que a fila do serviço recebe, chegue sem handler |
| Campos de log | As linhas da mensageria só emitem campos declarados no dicionário |

O cache tem e2e próprio em `work-order.e2e-spec.ts` (`GET /api/work-orders/:id — cache`): a segunda leitura sai do cache com o mesmo corpo, a mudança de status e a troca de placa do veículo aparecem na leitura seguinte (a invalidação depois do commit funciona), o nome novo de um serviço renomeado no Inventory aparece mesmo com a OS em cache (os dados de exibição não vão ao cache) e, com o Valkey pausado, a rota responde pelo PostgreSQL e registra `cache.unavailable`.

## Inventory e Billing no E2E

O work-order lê o catálogo no Inventory e os orçamentos no Billing por HTTP, então todo e2e que abre OS com itens, mostra os itens da OS, passa pela área do cliente ou trata uma mensagem de orçamento precisa dos dois. Em vez de subir os serviços de verdade, a suíte sobe um stub HTTP (`startInternalServicesStub()`, em `test/helpers/internal-services-stub.ts`) e passa a URL dele a `setupTestApp({ internalServicesUrl })`, que a grava em `INVENTORY_SERVICE_URL` e em `BILLING_SERVICE_URL`. Sem a opção, as duas apontam para uma porta que recusa conexão (`http://127.0.0.1:9`), e uma rota que chama um deles responde 503.

O stub declara as rotas numa tabela de `'MÉTODO /caminho/:param'` para o handler, casada pelo `URLPattern` do Node, e guarda os dados em mapas em memória:

| Dono | Rotas | Comportamento |
|---|---|---|
| Inventory | `GET /internal/services/:id`, `GET /internal/parts-supplies/:id` | Corpo das fixtures copiadas do Inventory; id fora dos mapas responde 404 |
| Billing | `POST /internal/quotes` | Cria o orçamento com o corpo da fixture resumo do Billing e o guarda em `stub.quotes`, sem itens |
| Billing | `GET /internal/quotes/:id`, `DELETE /internal/quotes/:id` | Lê ou apaga o orçamento guardado (`204`); id ausente responde 404 |
| Billing | `POST /internal/quotes/:id/decisions` | Grava no orçamento guardado o status decidido e o autor |
| Billing | `GET /internal/work-orders/:workOrderId/quotes` | Resumo dos orçamentos guardados daquela OS |
| Billing | `GET /internal/work-orders/:workOrderId/balance` | Saldo zero (`paidTotal` igual ao `approvedTotal` da fixture), porque os ciclos completos das suítes entregam a OS |
| Billing | `GET /internal/work-orders/:workOrderId/payments` | As cobranças da fixture, com o `workOrderId` da rota |

Um id em `failingIds` responde 500, o caminho do 503, e `nextResponses` guarda uma resposta de uso único por `'MÉTODO caminho'`, consultada antes das rotas (é assim que um teste faz o Billing responder 409 ou um saldo a pagar). Item ou orçamento que só precisa existir nasce no stub, com `stubService(stub)`, `stubPartSupply(stub)` ou direto em `stub.quotes`, escrito em cada teste.

A suíte `quote-approval-saga.e2e-spec.ts` cobre as Sagas e as mensagens de orçamento pelo LocalStack e pelo MailHog do harness. As mensagens do Billing (`billing.quote.*`) e do Inventory (`inventory.stock.*`) entram pelo outbox do próprio work-order, que as publica no tópico e as recebe de volta na fila `work-order.fifo`: o caminho até o handler é o mesmo de uma mensagem do outro serviço. Os comandos que o work-order manda (`inventory.stock.reserve` e `billing.quote.revert_approval`) são lidos das filas `inventory.fifo` e `billing.fifo` do LocalStack, como o dono os leria, pelo `receiveCommands` de `test/helpers/sqs-commands.helper.ts`, que apaga tudo o que recebe e guarda só os comandos da OS do teste. Os cenários de falha F1 a F5 (a numeração está em [Cenários de falha F1 a F14](#cenários-de-falha-f1-a-f14)) ficam nesta suíte e nas de `me` e `work-order`:

| Cenário | Suíte | O que prova |
|---|---|---|
| Reserva confirmada | `quote-approval-saga` | Com a reserva confirmada, a OS vai a `APPROVED` com os itens do orçamento lido no Billing e o histórico com o autor, e a Saga fica `COMPLETED` |
| Aprovação sem peças | `quote-approval-saga` | A OS vai a `APPROVED` sem reserva e a Saga nasce `COMPLETED` |
| F1 — decisão concorrente | `me` | O 409 do Billing numa decisão do cliente volta como está |
| F2 — falta de estoque e reaprovação | `quote-approval-saga` | Com a reserva recusada, a Saga vai a `COMPENSATING` e manda `billing.quote.revert_approval` (`SENT`); com `billing.quote.approval_reverted`, fica `COMPENSATED`, o histórico ganha a nota e o cliente recebe o e-mail no MailHog. Aprovar de novo o mesmo orçamento reabre a Saga e manda um novo `inventory.stock.reserve` |
| F3 — OS cancelada antes da aprovação | `quote-approval-saga` | A Saga nasce `COMPENSATING` e manda `billing.quote.revert_approval` (`REJECTED`) |
| F4 — Billing fora na abertura | `work-order` | `POST /api/work-orders` com itens responde 503 sem consumir número de OS |
| F5 — falha da gravação da OS | `work-order` | Com a transação da abertura falhando, o orçamento é apagado no stub do Billing e nenhuma OS fica gravada |
| Envio e rejeição | `quote-approval-saga` | `billing.quote.sent` leva a OS a `AWAITING_APPROVAL` e manda o e-mail; `billing.quote.rejected` sem outro orçamento enviado leva a OS a `REJECTED` |

A suíte `payment-saga.e2e-spec.ts` cobre a Saga de cobrança do mesmo jeito: os eventos `billing.payment.*` entram pelo outbox do work-order, e o comando `billing.payment.cancel` é lido da fila `billing.fifo`. As OS são postas em `APPROVED`, `COMPLETED` ou `IN_PROGRESS` direto no banco, porque a aprovação e a execução têm as suítes delas:

| Teste | O que prova |
|---|---|
| Pagamento aprovado com origem `APPROVED` | A OS vai a `AWAITING_PAYMENT`, a Saga guarda `APPROVED` como origem, o cliente recebe no MailHog o e-mail com o link, e com `billing.payment.approved` a OS volta a `APPROVED` com a data da aprovação intacta e o histórico com as duas notas |
| Pagamento aprovado com origem `COMPLETED` | A OS volta a `COMPLETED` e é entregue em seguida, com o saldo zero do stub |
| F7 — cobrança expirada | Com `billing.payment.failed` (`EXPIRED`), a OS volta à origem e a Saga fica `COMPENSATED` com `PAYMENT_EXPIRED` |
| F6 — OS já em execução | `billing.payment.requested` com a OS em `IN_PROGRESS` manda `billing.payment.cancel` e deixa a Saga `COMPENSATING`; com `billing.payment.failed` (`CANCELLED`), a Saga fica `COMPENSATED`, a OS segue em `IN_PROGRESS` e nenhum e-mail sai |

## Contrato das rotas `/internal`

O dono de uma rota `/internal` versiona a fixture da resposta em `app/test/contracts/` (aqui, `internal-work-order.json`, o detalhe completo de uma OS). O e2e do dono (`internal.e2e-spec.ts`) compara a **forma** da resposta real com a da fixture pelo `jsonShape`: as chaves e o tipo JSON de cada valor, não os valores. Arrays são comparados elemento a elemento, então o tamanho conta, e `null` é um tipo próprio.

Quem consome a rota copia a fixture para `app/test/contracts/<dono>/`, mantém o campo `$source` com a origem e testa o próprio adaptador contra ela. Este serviço consome as rotas de catálogo do Inventory e as de orçamento do Billing:

- `app/test/contracts/inventory/internal-service.json` e `internal-part-supply.json` alimentam o spec do `HttpInventoryCatalogGateway` e o stub do e2e;
- `app/test/contracts/billing/internal-quote-summary.json` (resposta de `POST /internal/quotes`), `internal-quote.json` (`GET /internal/quotes/:id` e `POST /internal/quotes/:id/decisions`, com itens) e `internal-work-order-quotes.json` (`GET /internal/work-orders/:workOrderId/quotes`) alimentam o spec do `HttpBillingQuotesGateway` e o stub do e2e;
- `app/test/contracts/billing/internal-work-order-balance.json` (`GET /internal/work-orders/:workOrderId/balance`) e `internal-work-order-payments.json` (`GET /internal/work-orders/:workOrderId/payments`) alimentam o spec do `HttpBillingPaymentsGateway`, o stub do e2e e o do DAST.

Os payloads das mensagens `billing.quote.*` e `billing.payment.*` são conferidos pelo catálogo tipado de `domain/messaging/`, cópia do catálogo do Billing. Mudou a resposta do dono, a fixture muda no mesmo PR; as cópias dos consumidores mudam no PR de cada um, conferidas por diff contra a origem.

## Mensagem de teste no ambiente

Para ver uma mensagem sair do outbox, passar pelo tópico e voltar pela fila do serviço (no log e no trace), insira uma linha na tabela `outbox`. O tipo `billing.payment.failed` é roteado para a fila `work-order.fifo` e não precisa de OS no envelope. Com um `paymentId` que nenhuma Saga conhece, o handler da Saga de cobrança não encontra Saga, registra `saga.step_skipped` e confirma a mensagem, sem mudar nada. Com `work_order_id` nulo, a mensagem forma um grupo só dela e não segura as mensagens de OS alguma.

Na stack do compose (a partir de `app/`):

```bash
docker compose exec postgres psql -U postgres -d work_order -c "INSERT INTO outbox (message_id, type, work_order_id, payload) VALUES (gen_random_uuid(), 'billing.payment.failed', NULL, jsonb_build_object('paymentId', gen_random_uuid(), 'reason', 'EXPIRED'))"
```

Para ver o caminho da falha até a DLQ (fila de mensagens que falharam, `work-order-dlq.fifo`), troque o payload por `'{}'`: sem `paymentId`, a validação do payload recusa a mensagem, o consumidor registra `messaging.message.failed` nas quatro primeiras entregas e `messaging.message.dead_lettered` na quinta, e o SQS a move para a DLQ.

No banco de um ambiente implantado, o mesmo `INSERT` vale em qualquer cliente SQL conectado ao banco do serviço. `message_id` não tem valor padrão no banco, por isso o `gen_random_uuid()`; um `work_order_id` preenchido precisa ser de uma OS existente, por causa da FK.

## Postman / Newman

A coleção e o environment estão em `collections/`. Importe `collections/oficina-collection.json` e `collections/oficina-environment.json` no Postman e selecione o environment **"Work Order API"**.

`baseUrl` representa somente a origem, sem `/api`. O valor padrão é `http://localhost:3000`; as requests da aplicação acrescentam `/api` explicitamente, enquanto o login serverless usa `/customer-auth/login`. Quando o API Gateway estiver implantado, substitua apenas `baseUrl` pela URL base efêmera do gateway. Não é necessário criar outro environment nem manter uma variável exclusiva para o gateway.

O environment já vem com `adminEmail`/`adminPassword` e `customerCpf`/`customerPassword` correspondentes ao seed. As senhas e os três tokens (`authToken`, `refreshToken` e `customerJwtToken`) permanecem com tipo `secret`; os identificadores produzidos pelos scripts também estão declarados para que a importação resolva todas as variáveis da collection.

A collection mantém as pastas de domínio sem numeração ou agrupadores adicionais. Execute-as de cima para baixo: **Health → Autenticação → Gestão de Usuários → Gestão de Clientes → Validação → Acesso Externo de Clientes → Gestão de Veículos → Gestão de Ordens de Serviço → Minha Conta → Relatórios e Métricas**. Essa ordem mantém as requests produtoras antes das consumidoras: `Gestão de Ordens de Serviço` usa o cliente e o veículo criados nas pastas anteriores, e `Minha Conta` usa o `authToken` do login interno para preparar a própria OS.

O cadastro de serviços, peças e estoque não está nesta collection: é do Inventory, que tem a collection própria. Os orçamentos também não: são do Billing, cuja collection cobre as rotas de orçamento. As OS usam um serviço e uma peça do seed do Inventory, com os ids canônicos de [Ids canônicos do seed](seed-ids.md) já gravados no environment (`serviceId` = `Troca de óleo`, `partSupplyId` = `FILT-OL-001`).

O fluxo da OS passa pelo Billing, então a pasta **Gestão de Ordens de Serviço** só roda inteira pelo API Gateway, que encaminha as rotas de orçamento e de cobrança ao Billing. `TC-WO-02` abre a OS com itens (o orçamento inicial nasce no Billing); `TC-WO-30` descobre o id desse orçamento pela lista de orçamentos da OS, envia-o ao cliente e consulta a OS a cada segundo, até 15 vezes, até vê-la `AWAITING_APPROVAL`; `TC-WO-31` aprova o orçamento e consulta a OS até vê-la `APPROVED`, porque a OS só muda depois que o Inventory confirma a reserva do estoque; `TC-WO-32` cria no Billing uma cobrança de sinal de R$ 10,00 (`POST /api/payments`, que grava `paymentId`) e consulta a OS até vê-la `AWAITING_PAYMENT`; e `TC-WO-33` cancela essa cobrança (`POST /api/payments/:id/cancellations`) e consulta a OS até vê-la de volta em `APPROVED`. Como nenhuma cobrança é paga (o pagamento passa pela página do Mercado Pago), a entrega no fim do fluxo, `TC-WO-07`, espera o **409** do saldo a pagar. Com só este serviço no ar, rode as pastas que não dependem do Billing, por exemplo:

```bash
npx newman run collections/oficina-collection.json -e collections/oficina-environment.json \
  --folder "Health" --folder "Autenticação" --folder "Gestão de Usuários" \
  --folder "Gestão de Clientes" --folder "Gestão de Veículos"
```

O grupo **Autenticação** mantém os dois fluxos separados: o login interno grava `authToken` e `refreshToken`, e `POST /customer-auth/login` é `noauth` e grava somente `customerJwtToken`. O grupo **Minha Conta** exercita `/api/me/*` com `Bearer {{customerJwtToken}}`, sobrescrevendo o bearer interno herdado da collection. O login de cliente é o do usuário semeado `joao.silva@email.com` (CPF `customerCpf`), vinculado ao cliente semeado `myCustomerId`, dono do veículo `myVehicleId`; a OS e os orçamentos criados em **Gestão de Ordens de Serviço** são de outro cliente, que esse usuário não vê, e chegam a esta pasta já entregues. Por isso a pasta prepara a própria OS com o token interno e regrava `workOrderId` e `quoteId` com ela:

- `TC-ME-03` troca a senha do cliente para `NovaSenha@456`. A troca invalida os tokens emitidos antes dela, então `TC-ME-03B` faz login com a senha nova, `TC-ME-04B` devolve a senha original e `TC-ME-04C` faz login de novo, o que deixa a collection pronta para rodar outra vez;
- `TC-ME-05A` a `TC-ME-05E` abrem uma OS de `myCustomerId` com um serviço (o orçamento inicial nasce no Billing), colocam-na em diagnóstico, enviam esse orçamento, esperam a OS chegar a `AWAITING_APPROVAL` e criam e enviam um segundo orçamento (`rejectQuoteId`);
- `TC-ME-11` rejeita o segundo orçamento antes de `TC-ME-10` aprovar o inicial, porque a aprovação rejeita os outros orçamentos da OS;
- `TC-ME-13` lista as cobranças da OS vinculada (`GET /api/me/work-orders/:id/payments`), lidas no Billing; a OS da pasta não tem cobrança, então a lista volta vazia.

Com apenas a API local em execução, ignore os logins serverless (`TC-AUTH-06`, `TC-ME-03B` e `TC-ME-04C`) e a troca de senha (`TC-ME-03` e `TC-ME-04B`), que invalidaria o token preenchido à mão, e preencha `customerJwtToken` por um destes caminhos:

- **Token de teste manual** — use o mesmo mecanismo de `test/helpers/customer-jwt.helper.ts`, descrito acima; a Lambda não precisa estar em execução.
- **Token real da Lambda local** — configure [`oficina-mecanica-lambda-customer-auth`](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth) contra o mesmo banco e execute `npm run invoke`; use `customerCpf`/`customerPassword` do seed e copie o `accessToken` retornado para `customerJwtToken`.

Com o gateway implantado, basta trocar `baseUrl` e executar também o login serverless; o script preenche `customerJwtToken` automaticamente.

Ou via linha de comando com a aplicação rodando:

```bash
npx newman run collections/oficina-collection.json -e collections/oficina-environment.json
```

**Localmente, a collection precisa do Inventory de pé e na mesma mensageria.** Cada stack local sobe o próprio LocalStack, e a reserva de estoque só se completa se o Inventory ler o comando da fila `inventory.fifo` do LocalStack do work-order e responder no tópico dele. Suba o Inventory apontando para esse LocalStack, com um arquivo de override do Docker Compose (um arquivo que sobrescreve valores do `docker-compose.yml`), e carregue o seed dele:

```yaml
# inventory-shared-localstack.yml, fora do repositório
services:
  api:
    environment:
      AWS_ENDPOINT_URL: http://host.docker.internal:4566
```

```bash
# A partir de app/ do oficina-mecanica-inventory-service, com o compose do work-order já no ar
docker compose -f docker-compose.yml -f inventory-shared-localstack.yml up -d --build --wait
DATABASE_URL=postgresql://postgres:postgres@localhost:5435/inventory npm run prisma:seed
```

O LocalStack do work-order já cria a fila `inventory.fifo` e a assinatura dela no tópico. Pelo API Gateway, os serviços implantados compartilham o SNS e o SQS de verdade, e nada disso é necessário.

## Indisponibilidade de dependência e encerramento gracioso

A suíte `health.e2e-spec.ts` cobre três cenários que exigem manipular a infraestrutura do próprio teste.

**Banco indisponível desde o boot.** Um `describe` sem infraestrutura alguma — sem containers e sem migration — aponta a `DATABASE_URL` para um endereço que recusa a conexão e sobe a aplicação por `configureApp()`, a mesma composição que o `main.ts` usa. Ele assere que a porta **abre**, que `/live` responde `200` e que `/ready` responde `503`: é a propriedade cloud-native de que o `$connect()` do adapter é preguiçoso, da qual o desenho depende sem implementar. Se uma versão futura do adapter passar a validar conectividade no `connect()`, isso viraria `CrashLoopBackOff` em produção — e falha aqui primeiro. O mesmo `describe` assere o **contrato publicado** em `/api/docs-json`: um schema por desfecho, para que o OpenAPI não afirme que `/live` pode responder `unavailable` nem que o `503` pode responder `ok`.

**Dependência fora.** Um `describe` próprio sobe a stack, confirma `/api/health/ready` = `200`, **para o container do PostgreSQL** e então assere `/ready` = `503` **enquanto** `/live` continua `200`. É o teste que carrega o desenho: ele falha no instante em que alguém reintroduzir verificação de banco na vivacidade. `setupTestApp()` sobe um PostgreSQL **dedicado por chamada**, então não há container compartilhado a proteger — mas o teardown é ordenado à mão, porque depois do `stop()` o `app.close()` chama `$disconnect()` contra um servidor morto e essa espera não tem prazo. E como o `stop()` é memoizado pelo testcontainers, um `restart()` **não** é caminho de recuperação: a transição de volta para saudável fica coberta pelo unitário do detector, não pelo E2E.

**Os dois testes de encerramento protegem coisas diferentes, e isso importa.**

| Teste | O que prova |
|---|---|
| `/ready` = `503` e `/live` = `200` durante a janela de `close('SIGTERM')` | O **contrato de saúde** no encerramento |
| Requisição de negócio em voo que usa o banco **conclui com sucesso** durante a janela | A **ordem de liberação dos recursos** |

O primeiro **não** substitui o segundo, e é essa a armadilha: se o `$disconnect()` migrasse para `onModuleDestroy`, `/ready` responderia `503` pelo estado de `draining` e `/live` responderia `200` de qualquer forma — os dois status passariam e a regressão ficaria invisível. Quem a pega é a requisição em voo, que roda com `app.listen(0)`, é segurada por um gate no acesso ao banco e só executa a consulta **depois** de o encerramento começar. Somam-se a ela dois unitários: o de `PrismaService`, que assere que o `$disconnect()` não está em `onModuleDestroy` e está em `onApplicationShutdown`, e o de `ReadinessState`, que assere que um `close()` **sem sinal** marca `draining` e não sustenta a janela.

O drain **é** alcançável neste harness: `enableShutdownHooks()` apenas registra listeners de sinais do processo, e `close(signal)` executa os hooks de qualquer forma — o servidor HTTP só fecha no `dispose()`, depois da janela. Por isso ele não aparece na lista de branches inalcançáveis abaixo. A janela, porém, só é sustentada no ambiente orquestrado (`NODE_ENV=production`), então o `describe` de encerramento declara esse ambiente no `beforeEach` e o restaura depois — é o que faz a suíte exercitar o comportamento real em vez de um caminho de teste próprio.

As três `describe`s esperam a prontidão assentar em `200` antes de assertar o contrato. A primeira verificação depois do boot paga TCP + autenticação com o pool ainda vazio, e o prazo próprio do chamador é de 3,5 s — o `query_timeout` de 2 s vale só para a consulta e não cobre a aquisição da conexão: com dezesseis suítes E2E em paralelo, cada uma subindo os próprios containers, esse caso frio estoura o prazo e a prontidão responde `503` uma vez — exatamente como responderia em produção antes de o `failureThreshold` ser atingido. A propriedade continua asserida (se a prontidão nunca ficar `200`, a suíte falha); o que a espera remove é a dependência de uma única amostra fria sob inanição de CPU.

**Asserções de log.** Com `setupTestApp({ captureLogs: true })`, a suíte assere que uma probe saudável produz **zero** linhas de access log; que uma probe que falha produz **exatamente uma**, em `error`, **sem** stack trace e **sem** `error.type`/`oficina.error.message` (a resposta é deliberada e não lança, então não há exceção resolvida de onde derivá-los); e que a transição emite exatamente um `health.degraded` com a categoria da causa. Fecha com uma asserção **negativa**: o corpo do `503` não contém host, porta, cadeia de conexão nem stack.

## Telemetria: o que o Jest não instrumenta

**A auto-instrumentação do OpenTelemetry não funciona sob Jest, e isso reorganiza toda a verificação.** Medido: um `setupFiles` que substitui `Module._load` permanece instalado dentro do teste — mesmo objeto `module`, patch visível — e registra **zero** chamadas ao requerer `express`, `pino`, `pg` e até `http`. O `jest-runtime` tem registro de módulos próprio e não passa pelo carregador do Node, que é onde `require-in-the-middle` engancha.

O perigo não é o que deixa de ser testado; é o que passa **vazio**. Um E2E afirmando "o dicionário continua fechado com a instrumentação ativa" ficaria verde porque não há instrumentação ativa, logo não há chave nova. Um E2E afirmando "linhas de bootstrap não carregam `trace_id`" ficaria verde porque não há span algum. **Um teste vazio é pior que a ausência do teste, porque compra confiança.**

A divisão é deliberada:

| Onde | O que |
| --- | --- |
| **Unitário (Jest)** | Predicado `isHealthProbePath` e o filtro de exclusão; o hook de atributos de span chamado com um `IncomingMessage` sintético (caminho sanitizado igual ao do log, query ausente, endereço validado, agente truncado); resolução de `Resource`; registry e adaptador de métricas, incluindo a agregação que distingue 60 s de 3 h e de 5 dias; cálculo de permanência e dos dois totais, com reentrada; posição do hook de encerramento. Tudo função pura ou classe — **sem patching**. |
| **E2E (Jest)** | Correlação log-trace, viável porque a correlação é um `mixin` nosso e não uma instrumentação: registra-se um `TracerProvider` em memória, abre-se um span num middleware do próprio teste (que reproduz o `context.bind` da resposta feito pelo `instrumentation-http`) e verifica-se que a linha de access log carrega `trace_id`, `span_id` e `request.id`. Métricas de negócio com `MeterProvider` explícito e leitura em memória — a API de Meter também não depende de patching. |
| **Smoke fora do Jest** (`npm run test:smoke`) | O que exige um processo de verdade, **versionado e rodando no CI**: o interruptor não carregando módulo algum do SDK, configuração inválida não impedindo o boot, `OTEL_LOG_LEVEL` não poluindo o stdout, a degradação com endpoint inalcançável saindo só pelo canal de erro em JSON, e o `express` carregado por `import`, como o NestJS 12 faz, saindo instrumentado pelo hook ESM. Ver `test/smoke/telemetry-preload.smoke.mjs`. |
| **Smoke manual sobre o compose** | O que exige um coletor: spans de servidor e `pg`, `http.route` parametrizado, exclusão das probes (descendentes inclusive), ausência de `url.query` e de `url.full`, orçamento de encerramento e a medição de overhead (p95 e RSS). A stack de `app/docker-compose.yml` sobe a imagem com o `CMD` real e o preload. |

O que **não** se faz: tentar instrumentar via `setupFiles` (o patch fica instalado e nunca é chamado), nem chamar as funções internas de patch das instrumentações à mão (passa a testar a biblioteca, não o nosso código).

O smoke de preload roda no job `build` do CI, depois do `npm run build`, porque depende do `dist`. Ele existe porque duas regressões reais passaram pela verificação manual: um `OTEL_METRIC_EXPORT_INTERVAL` plausível derrubava o processo no boot, e `OTEL_LOG_LEVEL=debug` escrevia uma linha crua em stdout.

Nenhuma suíte define `OTEL_EXPORTER_OTLP_ENDPOINT`, então o SDK **não inicia** em teste algum: sem exportador de fundo e sem conexão de saída.

## Cobertura E2E — o que não é alcançável por HTTP

O E2E exercita o fluxo HTTP completo contra um PostgreSQL real, e é isso que ele mede bem:
rota, guard, pipe, use-case, repositório e banco. Uma parte do `src/` fica **estruturalmente**
fora do alcance dele — não por falta de teste, mas porque nenhuma requisição HTTP consegue
produzir aquele estado. Todo esse código está coberto pelo suíte unitário, que é 100%.

As categorias, e por que cada uma não é alcançável:

| Categoria | Onde | Por quê |
|---|---|---|
| Preload de telemetria | `src/otel.ts`, `infrastructure/telemetry/**` | O SDK só é registrado por `node --require` e **nenhuma suíte define `OTEL_EXPORTER_OTLP_ENDPOINT`**; além disso a auto-instrumentação não funciona sob Jest (ver [seção acima](#telemetria-o-que-o-jest-não-instrumenta)). Cobertos por unitário + `npm run test:smoke`. |
| Validação de entidade de domínio | `domain/entities/**` | Os DTOs da borda (`class-validator`) recusam o payload antes de a entidade ser construída, então as guardas de `create()`/`reconstitute()` não são atingíveis por requisição. |
| Capturas defensivas do Prisma | `persistence/prisma/repositories/**` | `P2002`/`P2025` cobrem corridas entre a verificação e a escrita: reproduzir isso exigiria pausar a transação no meio, o que o E2E não controla. |
| Falha do envio de e-mail | `use-cases/user/create-user`, `use-cases/customer-access/grant-customer-access`, `services/mailer-email-sender.service.ts` | O MailHog do harness sempre aceita a mensagem; o `catch` que registra o envio falhado e segue (a criação **não** é desfeita) depende de um SMTP indisponível. |
| Falha do próprio logger | `logging/logging-diagnostics.ts`, `logging/bootstrap-failure.ts`, `logging/logging-destination.ts` | Só executam quando a escrita em stdout/stderr falha ou quando o boot falha — estados que o harness não produz. |
| Bootstrap fora do harness | `config/app-bootstrap.ts` | Parte da composição só é atingida por `main.ts` (`listen`, hooks de sinal), que o E2E não usa. |
| Fallback de relação obrigatória | ver tabela abaixo | FK `NOT NULL` com `include` obrigatório: o lado `null` do ternário não existe em runtime. |

### Fallbacks de relação obrigatória

| Localização | Branch não coberto | Motivo |
|---|---|---|
| `interface-adapters/me/me.presenter.ts` — `workOrder.vehicle ? … : null` | Ramo `null` | `work_orders.vehicle_id` é `NOT NULL` e o `include` do detalhe externo sempre traz o veículo. |
| `interface-adapters/work-order/work-order.presenter.ts` — `entry.changedBy ? … : null` | Ramo `null` | Toda transição feita por requisição carrega o usuário autenticado. `changed_by_id` só fica `null` na entrada que a compensação da Saga de aprovação grava ao tratar a mensagem `billing.quote.approval_reverted`, e o e2e da compensação confere essa entrada no banco, sem passar por `GET /api/work-orders/:id/status-history`. |

### Branches de aplicação sem caminho HTTP

| Localização | Branch não coberto | Motivo |
|---|---|---|
| `use-cases/work-order/update-work-order-status.use-case.ts` — `PATCH_STATUS_ALLOWED.has(...)` | Ramo de recusa | O `@IsEnum` do `UpdateWorkOrderStatusRequestDto` declara **o mesmo** conjunto: um status fora dele vira `400` na validação, antes do use-case. A guarda protege o uso programático. |
| `use-cases/me/{find-my-quote-by-id,decide-my-quote}.use-case.ts` — `if (!workOrder)` | Ramo verdadeiro | O Billing só cria orçamento para uma OS que este serviço conhece, e uma OS não é apagada; o stub do e2e só guarda orçamentos de OS criadas no teste. O unitário cobre o ramo. |
| `metrics/work-order-duration.ts` — guardas de histórico | Ramos defensivos | A função é pura e recebe o histórico como está no banco. Transição ausente, status terminal, entrada de chegada truncada e carimbo inválido/negativo não são produzíveis por requisição — o unitário monta esses históricos diretamente. |
| `use-cases/me/change-own-password.use-case.ts` — `if (!user)` | Ramo verdadeiro | O guard resolve o principal a partir de um usuário existente; um `sub` desconhecido é recusado em `CustomerJwtStrategy.validate()` antes do use-case. |

> A lista descreve o comportamento atual e é revisada junto com o código. Quando uma relação
> obrigatória permite afirmar em vez de defender, prefira `!` a `??`/`?.`: isso elimina o branch
> em vez de deixá-lo permanentemente descoberto. Os dados de exibição dos itens não são relação:
> vêm do Inventory e podem faltar, então o presenter usa `?.`/`?? null` e o item que o Inventory
> não acha mais é coberto pelo e2e do detalhe da OS.
