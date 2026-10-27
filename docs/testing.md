# 🧪 Testes

## Índice

- [Unitários](#unitários)
- [E2E](#e2e)
- [Autenticação externa nos testes (customer-jwt)](#autenticação-externa-nos-testes-customer-jwt)
- [Telemetria: o que o Jest não instrumenta](#telemetria-o-que-o-jest-não-instrumenta)
- [Mensageria e cache no E2E](#mensageria-e-cache-no-e2e)
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

230 suites e 2243 testes, com **100% de cobertura em lines, statements, functions e branches**. O piso é declarado em `package.json` → `jest.coverageThreshold`, então `npm run test:cov` (e com ele o job `unit-tests` do CI) falha quando qualquer uma das quatro métricas cai abaixo de 100% — foi assim que a cobertura voltou a ser um contrato verificado em vez de um número observado.

A cobertura é coletada em todo `src/**` (todas as camadas — `domain/`, `application/`, `interface-adapters/` e `infrastructure/`). As exclusões são por sufixo/caminho, não por camada: `*.module.ts`, `main.ts`, `otel.ts`, `*.enums.ts`, `*.config.ts`, `*.exception.ts`, `*.dto.ts`, `infrastructure/persistence/prisma/prisma.service.ts` e `domain/constants/**` (ver `package.json` → `jest.collectCoverageFrom`). Os arquivos gerados pelo Prisma ficam de fora por viverem em `prisma/generated/`, fora de `src/`.

`src/otel.ts` é excluído pelo mesmo motivo que `main.ts`: é ponto de entrada de processo, não código chamado pela aplicação. O caminho ligado depende de `OTEL_EXPORTER_OTLP_ENDPOINT` e de o SDK ser registrado por `node --require` — e a auto-instrumentação **não funciona sob Jest** (ver [Telemetria: o que o Jest não instrumenta](#telemetria-o-que-o-jest-não-instrumenta)), de forma que um teste ali ficaria verde sem verificar nada e ainda abriria um exportador de fundo nas suítes. Quem o cobre é `npm run test:smoke`, num processo real, dentro do job `build` do CI. O interruptor desligado — a garantia de que sem endpoint nenhum módulo do SDK é carregado — continua asserido em `test/unit/otel.spec.ts`.

## E2E

```bash
npm run test:e2e      # executa os testes
npm run test:e2e:cov  # com cobertura
```

17 suites cobrindo todos os domínios (auth, user, customer, customer-access, vehicle, service, part-supply, work-order, quote, stock) mais `me` (rotas do Cliente da Oficina autenticado), uma suite dedicada ao `AllExceptionsFilter`, outra ao logging estruturado, outra aos endpoints de saúde, outra à telemetria (correlação log-trace e métricas de negócio), outra às rotas `/internal` e outra à mensageria. Os testes E2E sobem um PostgreSQL 18 real (`postgres:18-alpine`) e um Valkey 9.1 real via **Testcontainers 12** (sem necessidade de banco externo), mais o LocalStack na suíte de mensageria (ver [Mensageria e cache no E2E](#mensageria-e-cache-no-e2e)) e usam helpers compartilhados em `test/helpers/` (`test-app.helper.ts`, `auth.helper.ts`, `db-cleanup.helper.ts`) para subir o `INestApplication`, autenticar e limpar o banco entre testes. Configuração em `test/jest-e2e.json` (timeout de 10 minutos para acomodar a inicialização dos containers).

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

Duas opções extras, usadas só pela suíte de logging para que as outras quatorze não paguem o custo:

| Opção | O que liga |
| --- | --- |
| `captureBootstrap` | Implica `captureLogs`, liga `bufferLogs` + `useLogger` e guarda uma fotografia das linhas de boot em `ctx.logCapture.bootstrapLines()` **antes** de o `beforeEach` chamar `clear()`. É o único caminho para o teste do dicionário alcançar as chaves que só aparecem quando o próprio Nest loga. |
| `withSwagger` | Registra o Swagger **antes** do `app.init()`. Sem ele, `/api/docs` é um 404 comum do router e a fronteira D19 não é verificável — era por isso que o teste da fronteira afirmava o oposto do próprio nome. |

Shutdown hooks continuam desligados no E2E: ligá-los acumularia listeners de processo entre as suítes.

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

`test/e2e/me.e2e-spec.ts` é a suite que exercita esse caminho — identidade externa (`GET /api/me`), troca da própria senha via `AnyAuthGuard` (`PATCH /api/me/password`, provando que a rota aceita tanto o token interno quanto o externo, com a nova senha realmente persistida), listagem/consulta de OS e orçamentos vinculados por `CustomerAccessPolicy`, e decisão de orçamento (aprovação/rejeição) — incluindo o caso de um `sub` sem nenhum vínculo ativo (token assinado para um `userId` aleatório) para confirmar a rejeição em `CustomerJwtStrategy.validate()`.

**O DAST cobre `/api/me/*` com uma segunda passagem autenticada como Cliente da Oficina.** O workflow `dast.yml` gera um par de chaves RS256 efêmero **no próprio job de CI**, injeta a chave pública no serviço `api` (substituindo a que a stack usa para o primeiro passe, autenticado como usuário interno) e roda um **segundo** `zap-api-scan.py` com um Bearer `customer-jwt` assinado pela chave privada correspondente, para um usuário externo já semeado — exatamente o mesmo mecanismo de `test/helpers/customer-jwt.helper.ts` descrito acima, só que rodando no job em vez de dentro da suite E2E. Isso não depende da função serverless externa (fora de escopo, ver acima): o próprio job assina, isolado, o token que ela emitiria. Ver [Infra · CI/CD](infra/ci-cd.md#4-workflow-de-dast-dastyml) para o passo a passo do workflow.

## Mensageria e cache no E2E

Toda suíte E2E sobe, além do PostgreSQL, um **Valkey real** (`valkey/valkey:9.1`, `@testcontainers/valkey`), porque o detalhe da OS passa pelo cache em qualquer rota que o lê. O LocalStack só sobe com `setupTestApp({ withMessaging: true })`, a opção da suíte `messaging.e2e-spec.ts`: ela inicia o `localstack/localstack:4.14.0` (`@testcontainers/localstack`) com o mesmo `app/localstack/init-topology.sh` do compose, roda o relay e o consumidor reais e aponta `AWS_ENDPOINT_URL` para o container. Nas outras suítes, o relay e o consumidor são substituídos por versões vazias, então nenhuma delas paga o LocalStack.

`messaging.e2e-spec.ts` cobre o que os unitários só simulam:

| Teste | O que prova |
|---|---|
| Ida e volta | Uma linha gravada no outbox sai pelo relay, passa pelo tópico e pela filter policy, volta pela fila `work-order.fifo` e chega a um handler de teste com o envelope `{ messageId, type, occurredAt, workOrderId, payload }`; a linha some do outbox e a fila fica vazia |
| Rollback | Uma transação desfeita não deixa linha no outbox |
| Lock do relay | Com outra transação segurando o `pg_advisory_xact_lock` do relay, nada é publicado; depois do `COMMIT` dela, a mensagem sai |
| Ordem do grupo | A falha da primeira mensagem de uma OS segura as seguintes do mesmo grupo |
| Sem handler | Mensagem sem handler registrado não é confirmada e volta a ser entregue |
| Campos de log | As linhas da mensageria só emitem campos declarados no dicionário |

O cache tem e2e próprio em `work-order.e2e-spec.ts` (`GET /api/work-orders/:id — cache`): a segunda leitura sai do cache com o mesmo corpo, a mudança de status e a troca de placa do veículo aparecem na leitura seguinte (a invalidação depois do commit funciona), renomear um serviço não muda o nome no detalhe em cache (escrita de catálogo não invalida a OS) e, com o Valkey pausado, a rota responde pelo PostgreSQL e registra `cache.unavailable`.

## Contrato das rotas `/internal`

O dono de uma rota `/internal` versiona a fixture da resposta em `app/test/contracts/` (`internal-work-order.json`, o detalhe completo de uma OS). O e2e do dono (`internal.e2e-spec.ts`) compara a **forma** da resposta real com a da fixture pelo `jsonShape`: as chaves e o tipo JSON de cada valor, não os valores. Arrays são comparados elemento a elemento, então o tamanho conta, e `null` é um tipo próprio.

Quem consome a rota copia a fixture para `app/test/contracts/<dono>/`, mantém o campo `$source` com a origem e testa o próprio adaptador contra ela. Mudou a resposta do dono, a fixture muda no mesmo PR; as cópias dos consumidores mudam no PR de cada um, conferidas por diff contra a origem.

## Mensagem de teste no ambiente

Para ver uma mensagem sair do outbox, passar pelo tópico e voltar pela fila do serviço (no log e no trace), insira uma linha na tabela `outbox`. O tipo `inventory.stock.reserved` é roteado para a fila `work-order.fifo`. Como o serviço não registra handler para ele, o consumidor registra `messaging.message.unhandled` a cada entrega e, na quinta, `messaging.message.dead_lettered`, e a mensagem vai para a `work-order-dlq.fifo`. Com `work_order_id` nulo, a mensagem forma um grupo só dela e não segura as mensagens de OS alguma.

Na stack do compose (a partir de `app/`):

```bash
docker compose exec postgres psql -U postgres -d work_order -c "INSERT INTO outbox (message_id, type, work_order_id, payload) VALUES (gen_random_uuid(), 'inventory.stock.reserved', NULL, '{\"quoteId\": \"00000000-0000-4000-8000-000000000000\"}')"
```

No banco de um ambiente implantado, o mesmo `INSERT` vale em qualquer cliente SQL conectado ao banco do serviço. `message_id` não tem valor padrão no banco, por isso o `gen_random_uuid()`; um `work_order_id` preenchido precisa ser de uma OS existente, por causa da FK.

## Postman / Newman

A coleção e o environment estão em `collections/`. Importe `collections/oficina-collection.json` e `collections/oficina-environment.json` no Postman e selecione o environment **"Work Order API (local)"**.

`baseUrl` representa somente a origem, sem `/api`. O valor padrão é `http://localhost:3000`; as requests da aplicação acrescentam `/api` explicitamente, enquanto o login serverless usa `/customer-auth/login`. Quando o API Gateway estiver implantado, substitua apenas `baseUrl` pela URL base efêmera do gateway. Não é necessário criar outro environment nem manter uma variável exclusiva para o gateway.

O environment já vem com `adminEmail`/`adminPassword` e `customerCpf`/`customerPassword` correspondentes ao seed. As senhas e os três tokens (`authToken`, `refreshToken` e `customerJwtToken`) permanecem com tipo `secret`; os identificadores produzidos pelos scripts também estão declarados para que a importação resolva todas as variáveis da collection.

A collection mantém as pastas de domínio sem numeração ou agrupadores adicionais. Execute-as de cima para baixo: **Health → Autenticação → Gestão de Usuários → Gestão de Serviços → Gestão de Peças e Insumos → Gestão de Clientes → Validação → Acesso Externo de Clientes → Gestão de Veículos → Gestão de Ordens de Serviço → Gestão de Orçamentos → Minha Conta → Gestão de Estoque - Relatórios → Relatórios e Métricas**. Essa ordem mantém as requests produtoras antes das consumidoras, inclusive `Minha Conta` fica depois de ordens e orçamentos porque seus cenários consomem `workOrderId` e `quoteId` produzidos anteriormente.

O grupo **Autenticação** mantém os dois fluxos separados: o login interno grava `authToken` e `refreshToken`, e `POST /customer-auth/login` é `noauth` e grava somente `customerJwtToken`. O grupo **Minha Conta** exercita `/api/me/*` com `Bearer {{customerJwtToken}}`, sobrescrevendo o bearer interno herdado da collection.

Com apenas a API local em execução, ignore o login serverless e preencha `customerJwtToken` por um destes caminhos:

- **Token de teste manual** — use o mesmo mecanismo de `test/helpers/customer-jwt.helper.ts`, descrito acima; a Lambda não precisa estar em execução.
- **Token real da Lambda local** — configure [`oficina-mecanica-lambda-customer-auth`](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth) contra o mesmo banco e execute `npm run invoke`; use `customerCpf`/`customerPassword` do seed e copie o `accessToken` retornado para `customerJwtToken`.

Com o gateway implantado, basta trocar `baseUrl` e executar também o login serverless; o script preenche `customerJwtToken` automaticamente.

Ou via linha de comando com a aplicação rodando:

```bash
npx newman run collections/oficina-collection.json -e collections/oficina-environment.json
```

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

As três `describe`s esperam a prontidão assentar em `200` antes de assertar o contrato. A primeira verificação depois do boot paga TCP + autenticação com o pool ainda vazio, e o prazo próprio do chamador é de 3,5 s — o `query_timeout` de 2 s vale só para a consulta e não cobre a aquisição da conexão: com dezessete suítes E2E em paralelo, cada uma subindo os próprios containers, esse caso frio estoura o prazo e a prontidão responde `503` uma vez — exatamente como responderia em produção antes de o `failureThreshold` ser atingido. A propriedade continua asserida (se a prontidão nunca ficar `200`, a suíte falha); o que a espera remove é a dependência de uma única amostra fria sob inanição de CPU.

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
| `interface-adapters/work-order/work-order.presenter.ts` — `entry.changedBy ? … : null` | Ramo `null` | Toda transição feita por requisição carrega o usuário autenticado; `changed_by_id` só fica `null` em transição sem usuário, que nenhuma rota produz. |

### Branches de aplicação sem caminho HTTP

| Localização | Branch não coberto | Motivo |
|---|---|---|
| `use-cases/work-order/update-work-order-status.use-case.ts` — `PATCH_STATUS_ALLOWED.has(...)` | Ramo de recusa | O `@IsEnum` do `UpdateWorkOrderStatusRequestDto` declara **o mesmo** conjunto: um status fora dele vira `400` na validação, antes do use-case. A guarda protege o uso programático. |
| `use-cases/quote/reject-quote.use-case.ts` — `notes ?? \`Orçamento … rejeitado\`` | Ramo direito | `UpdateQuoteStatusUseCase` exige justificativa para rejeitar (`400` sem ela), então `notes` nunca chega vazio por HTTP. |
| `use-cases/quote/{approve,reject}-quote.use-case.ts` — `userId ?? null` | Ramo direito | As rotas são autenticadas; `userId` nunca é nulo vindo da borda. |
| `use-cases/me/{find-my-quote-by-id,decide-my-quote}.use-case.ts` — `if (!workOrder)` | Ramo verdadeiro | `quotes.work_order_id` é `NOT NULL` com `ON DELETE CASCADE`: um orçamento sem ordem não existe no banco. |
| `metrics/work-order-duration.ts` — guardas de histórico | Ramos defensivos | A função é pura e recebe o histórico como está no banco. Transição ausente, status terminal, entrada de chegada truncada e carimbo inválido/negativo não são produzíveis por requisição — o unitário monta esses históricos diretamente. |
| `use-cases/me/change-own-password.use-case.ts` — `if (!user)` | Ramo verdadeiro | O guard resolve o principal a partir de um usuário existente; um `sub` desconhecido é recusado em `CustomerJwtStrategy.validate()` antes do use-case. |

> A lista descreve o comportamento atual e é revisada junto com o código. Quando uma relação
> obrigatória permite afirmar em vez de defender, prefira `!` a `??`/`?.`: isso elimina o branch
> em vez de deixá-lo permanentemente descoberto.
