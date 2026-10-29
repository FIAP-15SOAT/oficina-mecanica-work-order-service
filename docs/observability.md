# 🔭 Observabilidade da API

Arquitetura de logs, correlação, traces e métricas da aplicação. A topologia de coleta, os dashboards e os alertas da solução estão descritos em [Infraestrutura · Visão Geral](infra/overview.md#camada-de-coleta-de-plataforma-namespace-platform-e-configuração-do-cd).

## Índice

- [Logs estruturados](#logs-estruturados)
- [Telemetria: traces e métricas](#telemetria-traces-e-métricas)
- [Documentação relacionada](#documentação-relacionada)

## Logs estruturados

A aplicação emite **um objeto JSON por linha em stdout** e nada mais — sem transport de fornecedor, sem arquivo, sem destino de rede. O formato é idêntico em desenvolvimento e em produção; a saída legível vem de um pipe (`pino-pretty`) no `start:dev`, nunca de configuração no código. Os nomes **e os tipos** dos atributos seguem as Semantic Conventions do OpenTelemetry como chaves planas pontilhadas, com o namespace próprio `oficina.*` apenas onde a convenção não define nada. Ver [ADR 0002](./adr/0002-logging-estruturado.md).

### As três partes que não se sobrepõem

```
requisição
   │
   ├─ middleware pino-http ──── abre o contexto ALS, semeia request.id
   │
   ├─ GUARDS ────────────────── 401 termina AQUI; 403 termina AQUI
   │                             ↑ req.user já está populado no 403
   │                             ↓ nenhum interceptor roda para os dois
   ├─ RequestContextInterceptor  escreve o handler — NÃO emite linha
   ├─ pipes → handler → caso de uso ─── ILogger, só eventos de negócio
   │
   ├─ exception filters ─────── escrevem o erro resolvido no contexto;
   │                             emitem UMA linha só quando status >= 500
   │
   └─ res.finish ───────────── pino-http monta A linha de access log, lendo
                               o contexto da requisição E o req.user final
```

| Evento | Responsável | Emite | Por quê |
|---|---|---|---|
| Access log (≤1/requisição) | hook de encerramento do `pino-http` | 1 linha | É o único componente que vê toda requisição que alcança o middleware do módulo, inclusive as que os guards recusam. As que terminam antes são a fronteira declarada |
| Metadados do handler | `RequestContextInterceptor` | 0 linhas | É o único lugar com `ExecutionContext` (controller + método) |
| Atributos de autor | hook de encerramento, a partir do `req.user` final | 0 linhas | **Não** o interceptor — ver abaixo |
| Detalhe de `5xx` com stack | Exception filter | 1 linha | É o único lugar que segura o objeto de exceção |
| `4xx` | Exception filter | 0 linhas | Escreve `error.type`/`oficina.error.message` no contexto da requisição |
| Evento de negócio | Caso de uso via `ILogger` | 1 linha | Um fato pós-commit que a camada HTTP não tem como saber |

### Correlação

`genReqId` lê `x-request-id`, depois `x-correlation-id` (precedência declarada), **valida** o valor contra um charset e um comprimento máximo, e gera um UUID v4 quando ausente ou malformado. O valor é devolvido no cabeçalho `x-request-id` e exposto via `exposedHeaders` do CORS. O `nestjs-pino` liga um logger filho ao `AsyncLocalStorage`, então um caso de uso que loga já nasce correlacionado sem receber o id.

> **Armadilha:** o adaptador **nunca** pode chamar `pino.child()`. `child()` liga no momento da construção e descarta a referência ao `AsyncLocalStorage`, fazendo `request.id` sumir de toda linha emitida por aquela instância. `forContext()` mescla o escopo **por chamada** e emite `otel.scope.name`. É uma falha silenciosa, não um crash — e tem spec dedicado.

### Desfecho da requisição, quando não houve resposta

O nível vem do status, mas só depois de o **desfecho** ser resolvido pelo estado do socket — não pela presença de um `err`, porque o `pino-http` fabrica um `Error` sintético em todo `5xx` concluído e registra o mesmo handler em `close` e em `error`. São dois valores estáveis e distintos em `error.type`, e a distinção importa porque a ação do operador difere: `client_aborted` quando a leitura foi interrompida (o cliente desligou), e `transport_error` quando a resposta não se concluiu **e** o transporte reportou erro (a conexão quebrou do nosso lado). Em ambos, `http.response.status_code` e o corpo são omitidos: não houve entrega para descrever.

### Por que o autor é resolvido no encerramento

`JwtAuthGuard` popula `req.user`, e então `RolesGuard` pode lançar `ForbiddenException` — um `403`. O interceptor nunca roda, então um autor vinculado ao interceptor estaria ausente exatamente no evento mais digno de auditoria: um usuário autenticado recusado por RBAC. Ler `req.user` no encerramento cobre 200, 403 e tudo entre eles. O mapeamento vem do payload real do `JwtStrategy`: `sub → user.id`, `[role] → user.roles`. O `email` nunca é emitido.

### Porta `ILogger` e os dois catálogos

```
application/ports/output/logger.service.interface.ts   ILogger — TS puro, exigido pela cerca do ESLint
application/logging/business-event.catalog.ts          catálogo tipado e fechado dos eventos de negócio

infrastructure/logging/pino-logger.adapter.ts          implementa ILogger
infrastructure/logging/technical-event.catalog.ts      eventos de HTTP, bootstrap, banco e integrações
infrastructure/logging/field-registry.ts               nome lógico → chave física, tipo e sensibilidade
infrastructure/logging/access-log.builder.ts           atributos da linha de acesso + status → nível
infrastructure/logging/url-attributes.ts               caminho canonicalizado + query classificada
infrastructure/logging/http-error-message.ts           mensagem de erro do log (404 do framework, validação)
infrastructure/health/readiness-state.ts               emite health.degraded / health.recovered
```

`ILogger` expõe **apenas** `debug`/`info`/`warn`/`error`/`event`/`forContext`. Deliberadamente **não tem `assign()`**: enriquecimento de contexto de requisição é responsabilidade da infraestrutura. `error` aceita `unknown`, não `Error`, porque quem chama normalmente segura um binding de `catch` de tipo desconhecido.

Os métodos por nível recebem **só a mensagem** — não existe parâmetro de contexto livre. A saída é um esquema fechado e o `normalizeLogRecord` descarta toda chave que o dicionário não declara, então um contexto solto sumiria **em silêncio** a caminho do stdout. `event()` é o único caminho estruturado, e sua assinatura (`NoExtraFields`) rejeita campo não declarado inclusive quando o objeto é montado numa variável antes da chamada — situação em que a checagem de excesso do TypeScript sozinha não vale.

Eventos de **negócio** vivem em `application/`; eventos **técnicos** e o resolvedor de nível por status HTTP vivem em `infrastructure/`, porque 2xx/4xx/5xx é política de apresentação HTTP e não pertence a uma camada proibida de importar `@nestjs/*`.

Casos de uso declaram **nomes lógicos** (`quoteId`) no tipo da entrada do catálogo, e o adaptador faz o mapeamento exaustivo para a chave física (`oficina.quote.id`). A aplicação nunca nomeia uma chave de telemetria — o que é melhor camada e o que torna a regra de namespace reservado à prova de fuga em ambas as direções.

O vocabulário lógico (`application/logging/log-field.ts`) e o registro em `infrastructure/logging/field-registry.ts` são a **única** declaração de um campo: dele saem a chave física, a entrada do dicionário e a sensibilidade que decide o mascaramento. O registro é um `Record<LogicalFieldName, …>`, então esquecer uma entrada é erro de compilação — e um teste de tipo em `field-registry.spec.ts` fecha a outra direção, falhando quando um campo declarado não é emitido por nenhum evento.

A sensibilidade declarada é o que mascara: `subjectName`/`subjectEmail` saem mascarados sem que o caso de uso faça nada, e `partSupplyName`/`workOrderServiceName` — nome de catálogo, não de pessoa — saem em claro por declaração explícita, não por acidente.

### Sucesso transacional é registrado depois do commit

O Prisma só pede o COMMIT quando o callback de `$transaction` retorna, então a última linha dentro de `executeTransaction` ainda roda *antes* do commit. O padrão é retornar um **composto**, desestruturá-lo depois do `await` e só então emitir:

```ts
const { quote, workOrderId, previousStatus } = await this.unitOfWork.executeTransaction(
  async (repos) => {
    // ...
    return { quote, workOrderId: workOrder.id, previousStatus };
  },
);

this.logger.event(BUSINESS_EVENTS.QUOTE_APPROVED, { quoteId: quote.id, workOrderId, ... });
```

Nenhum tipo de retorno público muda, nenhuma regra de negócio é duplicada, e um rollback lança antes do emit — então uma operação revertida nunca produz log de sucesso.

**O caso inverso, dito explicitamente para ninguém "consertar":** `SubmitQuoteUseCase` chama `emailSender.send` *dentro* da transação, e o log técnico do mailer é portanto emitido pré-commit — e isso está **correto**: o e-mail foi realmente enviado, e um rollback não o desenvia. A regra pós-commit governa afirmações de sucesso *de negócio*, não registros de efeito colateral irreversível.

### A régua para dar um logger a um caso de uso

*Este log responde a uma pergunta que o access log não responde?* Método, rota, status, duração e autor já estão lá — `logger.info('entrando em FindAllCustomers')` é ruído puro. O logger é injetado somente nos casos de uso que emitem eventos de segurança ou negócio declarados: autenticação e senha, concessão/revogação de acesso, estoque, aprovação/rejeição/submissão de orçamento, usuário e transições de ordem de serviço. Os demais casos de uso não recebem logger deliberadamente.

A aprovação e a rejeição do orçamento são donas da transição de negócio e emitem o evento somente depois da confirmação transacional. No fluxo externo, `DecideMyQuoteUseCase` resolve autorização por vínculo e delega à mesma regra; o canal da decisão já é distinguido por `http.route`, e `request.id` correlaciona as linhas.

### Fronteira de cobertura — o que **não** é registrado, e por quê

O `pino-http` é instalado como middleware de módulo, e middleware de módulo não é a primeira coisa da cadeia. `NestApplication.init()` registra o body parser **antes** de `registerModules()`, e `setupSwagger(app)` registra handlers do Express à frente de ambos. A cadeia efetiva é `Helmet → CORS → Swagger → body parser → middleware do LoggerModule → router`.

| Requisição | Chega ao logger? |
|---|---|
| Rotas de negócio após leitura bem-sucedida do corpo — inclusive recusas de guard, falhas de validação, filtros e 404 do Nest | **Sim** |
| Corpo malformado ou acima do limite (rejeitado pelo parser) | Não — o `AllExceptionsFilter` ainda responde (`400` no corpo malformado, `413` acima do limite), sem access log |
| `OPTIONS` de preflight | Não — o middleware de CORS encerra com 204 |
| Rotas de saúde (`/api/health/live`, `/api/health/ready`) | **Sim** — são rotas do router do Nest. O sucesso é suprimido; a falha, não (ver abaixo) |
| Swagger UI, assets, `/api/docs-json`, `/api/docs-yaml` | Não — registrados diretamente no `main.ts`, antes do `init()` |
| HTTP malformado recusado pelo Node | Não — nunca entra no Express |

Isso é uma **decisão registrada, não um bug**, e vale para o que o Swagger serve. As **rotas de saúde não escapam por acidente de ordem**: elas vivem no router do Nest e atravessam o `pino-http` como qualquer rota de negócio, então o silêncio delas em regime saudável é construído de propósito, nunca um efeito de posicionamento.

#### Supressão seletiva das probes

A supressão é feita por `customLogLevel → 'silent'` em `resolveAccessLogLevel`, e **nunca** por `autoLogging.ignore`. A diferença é o que cada mecanismo enxerga:

| Mecanismo | Quando é avaliado | Enxerga o status? | Efeito numa probe que falha |
|---|---|---|---|
| `autoLogging.ignore` | no **início** da requisição | ✗ recebe só o `req` | Os listeners de `close`/`finish` nunca são registrados → **a falha também some** |
| `customLogLevel → 'silent'` | no encerramento da resposta | ✓ recebe o `res` | Nenhum: a falha cai no nível derivado e mantém o contexto completo |

Três garantias fecham o único ponto em que um defeito **esconde** falhas:

- **Correspondência exata** contra um conjunto fechado de caminhos exportado por `infrastructure/health/health.constants.ts` — a **mesma** fonte que o controller usa nos decorators, e que compõe o prefixo global a partir do módulo folha `infrastructure/http/http.constants.ts`. `startsWith('/api/health')` silenciaria um `/api/health-admin` futuro, e um literal no decorator mais um conjunto no logger seriam duas verdades que derivam uma da outra.
- **Só o sucesso é silenciado.** Uma probe com `503` sai em `error`; uma probe abortada pelo kubelet ao estourar o `timeoutSeconds` sai em `warn` — esse é o desfecho mais informativo dos três e a supressão por sucesso não o alcança de propósito. Barra final (`/api/health/live/`), que o router aceita por rodar com `strict: false`, **não** casa o conjunto fechado e é registrada: erra para o lado certo.
- **O `runSafely` continua caindo em `'error'`.** Um defeito no próprio predicado falha alto; a ausência de registro nunca é o resultado de uma falha.

#### O custo real, sem maquiagem

Em regime saudável as probes custam **zero** linhas. Cada probe que falha custa uma: readiness a cada 10 s × 5 réplicas ≈ **1800 linhas/hora** durante uma indisponibilidade do banco. É o número que dimensiona retenção, e é o preço direto de nunca suprimir falha — suprimi-la zeraria a conta e é justamente o que a decisão recusa.

É **taxa nominal, não teto**: o `periodSeconds` governa o regime estável, mas o kubelet também dispara readiness fora do ticker em transições de estado. O efeito sobre o número é desprezível; a ressalva existe para que ninguém o trate como limite superior estrito.

Os dois eventos de transição (`health.degraded` / `health.recovered`) **não substituem** essas linhas: eles as tornam navegáveis. O access log repetido diz *que* está falhando; a transição diz *quando* mudou, *por quanto tempo* durou e — decisivo — **a causa**, numa categoria fechada (`timeout | connection | pool | authentication | query | unknown`). Sem ela nada distinguiria timeout de pool esgotado, porque o corpo do `503` é idêntico para toda causa por decisão de segurança e a linha de acesso de uma falha deliberada **sem exceção** não carrega atributos de erro.

### Logging degrada, nunca quebra

Uma fronteira compartilhada e não-lançante (`logging-diagnostics.ts`) absorve falhas de sanitização e de serialização, escrevendo no máximo **uma** linha fixa de diagnóstico em **stderr** — a única exceção declarada ao contrato de "JSON em stdout". Ela é usada pelo adaptador, pelo access log e pelo bootstrap. Toda função de personalização entregue à biblioteca (`genReqId`, `customLogLevel`, `customSuccessObject`, `customErrorObject`) é não-lançante, porque essas rodam dentro dos callbacks da própria biblioteca e um throw ali não é pego por um try/catch no adaptador.

O destino é o stdout **síncrono**, e a promessa é declarada na força certa: *com o logging habilitado e o stdout gravável, o registro de encerramento é escrito de forma síncrona antes de o hook de ciclo de vida retornar.* Nada afirma durabilidade além do descritor de saída, e nada espera um flush. Na primeira falha de escrita, a política declarada é **continuar em modo degradado** com uma linha de diagnóstico em stderr — o pino transforma `EPIPE` em no-op silencioso a menos que a aplicação diga o contrário, e esse é exatamente o modo de falha "rodando cego e ninguém percebe".

**Os dois descritores precisam do mesmo cuidado.** Um evento `'error'` sem listener em stream do Node derruba o processo, então o destino de stdout registra o seu — sem isso, um coletor caindo faria o logging matar a aplicação que ele existe para observar. O `stderr` tem o mesmo problema por um caminho menos óbvio: ele **aceita** a escrita e emite o erro **depois**, de forma assíncrona, fora do `try/catch` do escritor. Medido em processo filho, um `EPIPE` no stderr encerrava a aplicação com exceção não capturada — o oposto exato da política acima. O listener é simétrico, e pelo mesmo motivo.

A linha de diagnóstico carrega o envelope, os atributos de recurso e o estágio que falhou — nunca o valor. Os atributos de recurso estão ali porque, num destino compartilhado, é a linha que sobra quando o stdout falhou: sem `service.*` ela seria impossível de atribuir.

## Telemetria: traces e métricas

A aplicação emite **traces** e **métricas** pelo SDK do OpenTelemetry, sem nenhuma dependência, credencial, cabeçalho ou nome de plataforma de observabilidade — a tradução para qualquer fornecedor acontece fora do processo. Ver [ADR 0005](./adr/0005-opentelemetry.md).

**Com `OTEL_EXPORTER_OTLP_ENDPOINT` vazio, nada é iniciado**: nenhuma instrumentação registrada, nenhum exportador, nenhuma conexão. É o interruptor, e é o que mantém desenvolvimento local e as suítes E2E sem exportador de fundo.

### O registro acontece por preload, e a ordem é contrato

```
node --require ./dist/src/otel.js dist/src/main
```

A instrumentação funciona **substituindo funções da biblioteca no momento em que ela é carregada**, e `import { AppModule }` no topo de `main.ts` já arrasta `express` e `pg` na avaliação dos módulos. Registrar depois produz um processo que sobe normalmente, **não emite nada e não reporta erro** — por isso `src/otel.ts` importa apenas folhas puras da aplicação (`logger.config`, `health.constants`, `url-attributes` e a cadeia de redação), nenhuma das quais carrega `express`, `pg` ou `pino` transitivamente.

O NestJS 12 é distribuído só como ESM e carrega o `express` por `import`, um caminho que os hooks de `require` das instrumentações não enxergam. Por isso o preload também registra o hook ESM `@opentelemetry/instrumentation/hook.mjs` (`module.register`) antes de iniciar o SDK; sem ele, os spans do `express` e o `http.route` parametrizado desaparecem sem que nenhum teste perceba. O hook só é registrado com a telemetria ligada e só na thread principal: o Node também executa os `--require` dentro da thread de hooks que o `register()` cria, e sem a guarda o preload rodaria de novo ali, registrando o hook duas vezes (com um aviso cru no stderr) e subindo um segundo SDK, com exportadores próprios e as métricas de runtime da thread de hooks reportadas como se fossem do serviço.

O hook tem custo: ele envolve todo módulo carregado por `import` e mantém uma thread própria durante o processo, o que consome mais memória e deixa o boot um pouco mais lento. Se o loader não conseguir envolver um módulo, ele o carrega sem envolver e o app segue, mas o Node escreve um aviso `(node:PID) Warning: …` cru no stderr, fora do envelope JSON; no Datadog ele aparece como `error`, porque a severidade vem do stream.

Seis instrumentações, nomeadas: `http`, `express` (que é quem resolve `http.route` **parametrizado**, a dimensão de toda métrica por rota), `pg` (o driver que de fato executa as consultas, já que o `PrismaService` entrega um `pg.Pool` explícito), `runtime-node`, `aws-sdk` (SNS e SQS) e `ioredis` (cache). **Nenhum metapacote**, e **nenhum span criado por código de negócio**: o único span manual é o de consumo de mensagens, na infraestrutura (ver [Consumo de mensagens](#consumo-de-mensagens)).

### Correlação log-trace

Um `mixin` do pino (`trace-correlation.ts`) lê o span ativo e injeta `trace_id`, `span_id` e `trace_flags` — a grafia que a convenção define para o mapeamento fora do OTLP, pela mesma razão que já sustenta `otel.scope.name`. Fora de um span os três ficam **ausentes**, nunca vazios nem sintéticos: um identificador fabricado leva o destino a correlacionar com um trace que não existe.

Os três são declarados em `CORRELATION_FIELDS` como qualquer outro atributo — sem isso o `normalizeLogRecord` os descartaria em silêncio, e a correlação seria prometida sem ser entregue.

**`request.id` permanece.** `trace_id` só existe onde há span; `request.id` existe em toda linha da requisição e também fora dela — inicialização, encerramento, eventos de negócio pós-resposta e requisições que morrem antes de alcançar a instrumentação. É também o valor ecoado no cabeçalho de resposta, ou seja, o que um usuário cita num chamado.

A instrumentação de pino **não** é usada, e não por preferência: sob Jest nenhuma instrumentação é aplicada, então a asserção "a linha de access log carrega `trace_id`" ficaria sem cobertura possível e o E2E que a afirmasse passaria **vazio**.

### Probes de saúde excluídas do tracing

`ignoreIncomingRequestHook` consulta `isHealthProbePath`, o **mesmo predicado** que o supressor de access log usa — exportado por `health.constants.ts`, nunca duplicado. Neste ambiente as probes são praticamente todo o volume de requisições (~108 mil spans/dia com 5 réplicas, contando os spans `pg` filhos da readiness).

A exclusão acontece **na entrada** porque é o único ponto em que ela é completa: `ignoreIncomingRequestHook` aplica `suppressTracing()` e por isso alcança os spans **descendentes**, incluindo o `SELECT 1` da verificação de prontidão. Isto **contraria** o ADR 0003, que preferia descartar depois de conhecer o resultado — mas esse descarte só derruba o span de servidor e deixaria os spans de consulta órfãos. A perda assumida (a duração do `SELECT 1` numa probe que falha) está declarada no ADR 0005, junto dos três registros que sobrevivem: a linha de access log em `error`, o evento `health.degraded` com a categoria da causa, e o estado da instância no Kubernetes.

### Nenhum span carrega dado que o log não carregue sanitizado

Toda a cadeia de redação existe apenas no caminho de log; um atributo de span sai por serialização própria. A garantia é mantida **por subtração e reuso**, no `startIncomingSpanHook`:

| Atributo | Política |
| --- | --- |
| `url.path` | passa pelo **mesmo** `sanitizeUrlPath` do access log — mesma canonicalização, mesmo scrubber |
| `url.query` | **não é emitida**. A proteção do log é por *nome de parâmetro* sobre a query decomposta, e um atributo de span é montado antes dessa decomposição; emitir "o que dá para sanitizar" seria fail-open |
| `client.address` | resolvido pelo mesmo `proxy-addr` que alimenta o `req.ip` do Express, com a mesma `TRUSTED_PROXY_CIDRS`, e ainda validado por `net.isIP()` (omitido quando não é endereço). Caminha da direita para a esquerda até o primeiro salto não confiável, então o span e a linha de acesso coincidem em qualquer configuração — nunca o valor mais à esquerda, que é o que o chamador escolhe |
| `user_agent.original` | truncado e varrido como qualquer texto livre |
| `server.address` / `server.port` | **não emitidos**. A instrumentação os deriva de `Forwarded`/`X-Forwarded-Host`/`Host` sem validar nem truncar, e a linha de acesso não carrega esse atributo em forma nenhuma |
| cabeçalhos genéricos | captura opt-in, desligada |
| corpo de requisição/resposta | nunca capturado |
| consulta ao banco | `enhancedDatabaseReporting` desligado: nenhum valor de parâmetro no atributo |

`instrumentation-nestjs-core` é **excluído** por esse mesmo critério: grava `url.full` sem oferecer ponto de configuração, e qualquer parâmetro de query com PII ou segredo — `GET /api/customers?document=<CPF>`, por exemplo — sairia inteiro num span que nenhuma correção nossa alcança.

### Consumo de mensagens

O span de consumo é a **única instrumentação manual** da aplicação, e só existe porque a instrumentação da AWS criaria apenas o span do *receive*, que roda suprimido: sem ele, o processamento da mensagem não teria span próprio nem se ligaria ao produtor. O `SqsConsumerService` (infraestrutura) abre um span `CONSUMER` por mensagem:

| Atributo | Valor |
| --- | --- |
| nome do span | `process work-order.fifo` |
| `messaging.system` | `aws_sqs` |
| `messaging.destination.name` | `work-order.fifo` |
| `messaging.operation.type` | `process` |
| `messaging.message.id` | o `messageId` do envelope (ou o do SQS, quando o envelope é inválido) |

O pai do span vem do contexto W3C nos atributos da mensagem, que a instrumentação do SNS injeta no `Publish` a partir do contexto que o relay restaura da coluna `trace_context` do outbox. Assim, o trace segue a requisição que gravou a mensagem até o handler de outro serviço. Falha marca o span com `ERROR` e registra a exceção. A regra continua valendo para o resto do código: nenhum `startSpan` em código de negócio e nenhuma porta `ITracer`.

O polling do consumidor roda com o tracing suprimido (`suppressTracing` em volta do `start()` do `sqs-consumer`): sem isso, cada long poll vazio viraria um trace raiz `ReceiveMessage` a cada 20 s por réplica. Receive e delete não geram span; o span `CONSUMER` não é afetado, porque o pai dele vem do contexto extraído da mensagem. Falha de receive aparece só no log.

### Mensageria, cache e banco nos spans

| Instrumentação | Configuração | Por quê |
| --- | --- | --- |
| `aws-sdk` | `suppressInternalInstrumentation: true` | O SDK chama a AWS por HTTPS: sem isso, cada chamada ao SNS ou ao SQS ganharia um span HTTP filho repetindo o span da operação. A injeção de contexto não é afetada |
| `ioredis` | `dbStatementSerializer` que devolve só o nome do comando | Os argumentos levam o detalhe da OS em cache, com documento, e-mail e telefone do cliente |
| `pg` | `requireParentSpan: true` | Sem span pai, toda consulta fora de requisição viraria um trace raiz: o relay do outbox consulta o banco a cada 500 ms por réplica. Rotas e handlers sempre têm span pai |

As chamadas ao Valkey e ao SNS, o `GetQueueUrl` do SQS na subida e as chamadas REST internas aparecem como spans `CLIENT`. As chamadas internas saem pelo `axios`, que roda sobre `node:http`: a instrumentação `http` injeta o `traceparent` e cria o span sem código nosso.

### Campos e eventos de mensageria e cache

Toda linha emitida durante a publicação ou o processamento de uma mensagem carrega os campos de `MESSAGING_FIELDS` (`field-registry.ts`), ligados por `PinoLogger.runInContext`, e `request.id` igual ao `messageId`:

| Campo | Exemplo |
| --- | --- |
| `messaging.system` | `aws_sqs` ou `aws_sns` |
| `messaging.destination.name` | `work-order.fifo` ou `oficina-events.fifo` |
| `messaging.message.id` | o `messageId` |
| `messaging.operation` | `process` ou `publish` |
| `oficina.messaging.message.type` | `inventory.stock.reserved` |
| `oficina.work_order.id` | a OS do envelope, quando houver |

Eventos técnicos novos, no catálogo de `technical-event.catalog.ts`:

| Evento | Nível | Quando |
| --- | --- | --- |
| `messaging.outbox.publish_failed` | `error` | O relay não conseguiu publicar uma linha; o lote para ali |
| `messaging.message.unhandled` | `warn` | Mensagem sem handler registrado; não é confirmada |
| `messaging.message.failed` | `error` | Envelope ou payload inválido, ou erro do handler; a mensagem volta à fila |
| `messaging.message.dead_lettered` | `error` | Falha na quinta entrega; o SQS move a mensagem para a DLQ |
| `cache.unavailable` | `warn` | Leitura ou gravação no cache falhou; a leitura vai ao banco |
| `cache.invalidation_failed` | `error` | A exclusão de chaves depois de uma escrita falhou; a chave expira pelo TTL |

Métrica técnica do consumidor:

| Métrica | Instrumento | Unidade | Atributos |
| --- | --- | --- | --- |
| `oficina.messaging.consumed` | Counter | `{message}` | `messaging.destination.name`; `outcome` = `success`, `retry` ou `dead_lettered` |

### Métricas de negócio

Uma porta `IMetrics` em `application/ports/output/`, no mesmo molde de `ILogger` e pelo mesmo critério — *a camada de aplicação precisa emitir esse sinal?* Para traces a resposta é não (o span vem do transporte, e por isso não existe `ITracer`); para estas métricas o requisito faz do caso de uso o emissor, e a porta tem **6 chamadores**.

```
application/ports/output/metrics.service.interface.ts   IMetrics — interface TS pura
application/metrics/business-metric.catalog.ts          nome lógico, instrumento, unidade, atributos
application/metrics/work-order-duration.ts              cálculo puro de permanência e totais
infrastructure/telemetry/metric-registry.ts             lógico para físico, agregação, cardinalidade
infrastructure/telemetry/otel-metrics.adapter.ts        Meter do OTel, instrumento criado uma vez
```

| Métrica (nome físico) | Instrumento | Unidade | Atributo |
| --- | --- | --- | --- |
| `oficina.work_order.created` | Counter | `{work_order}` | — |
| `oficina.work_order.status.duration` | Histogram | `s` | `oficina.work_order.status` |
| `oficina.work_order.diagnosis_to_completion.duration` | Histogram | `s` | — |
| `oficina.work_order.lead_time.duration` | Histogram | `s` | — |

Quatro regras que o código torna difíceis de violar:

1. **Instrumento síncrono, nunca observação periódica do banco.** Um `ObservableGauge` lendo o estado compartilhado reportaria o mesmo valor em cada réplica, e a soma no destino daria N vezes a verdade sob o HPA.
2. **Emissão sempre depois do commit**, pela mesma razão dos eventos de negócio: o Prisma só solicita o COMMIT quando o callback do `$transaction` retorna.
3. **Permanência em todo status com transição de saída** — `REJECTED` inclusive, porque a máquina de estados declara `REJECTED` para `AWAITING_APPROVAL`. Terminais são apenas `DELIVERED` e `CANCELLED`, e essa definição é derivada do próprio mapa (`WorkOrder.isTerminalStatus`), nunca de uma segunda lista. **A permanência ancora na entrada mais recente; os totais, na primeira.**
4. **Os dois extremos de cada intervalo vêm do carimbo do banco**, e a leitura acontece **depois do commit**, fora da transação. `created_at` é `@default(now())`, e usar `Date.now()` do processo subtrairia relógios distintos — sob desvio pod-RDS, produziria durações negativas, que o SDK descarta em silêncio. Dentro da transação, essa leitura — que existe só para observabilidade — podia derrubar a operação de negócio junto, e sem conserto local: no PostgreSQL a transação já estaria abortada e o `COMMIT` viraria ROLLBACK silencioso, com a API respondendo sucesso. A transição corrente é localizada por **id**, nunca por posição.

A agregação das durações é **exponencial**, declarada no registry: a padrão usa fronteiras que terminam em 10 000, dimensionadas para milissegundos de requisição, e permanências medidas em segundos cairiam **todas** no último balde — a média continuaria certa e os percentis não teriam significado, sem nada falhar.

A aplicação **não cria** métrica própria de latência, contagem por rota, CPU, memória, disponibilidade ou resultado de health check. As métricas semconv que as instrumentações emitem sozinhas — `http.server.request.duration` por `http.route`, `db.client.operation.duration` e `db.client.connection.*` — são **preservadas**: são a resposta portátil para "latência das APIs" e a única visão de ocupação de pool em série temporal.

### Degradação, encerramento e diagnóstico

- **A aplicação nunca depende do pipeline** — nem para subir. A fronteira não-lançante do preload cobre a **construção** do SDK, não só o `start()`: uma relação inválida entre variáveis do leitor de métricas lançava no construtor e, num `--require`, derrubava o processo com código 1 e sem uma linha em stdout. O `BatchSpanProcessor` bufferiza e **descarta** quando o export falha; falha ao emitir métrica é absorvida pelo adaptador.
- **Com o endpoint vazio, nenhum módulo do SDK é carregado.** Os imports acontecem depois do interruptor: com `import` de topo, o modo desligado ainda pagava ~348 módulos e ~13,5 MiB de RSS por pod.
- **O flush vive num hook do Nest** (`TelemetryLifecycleService.onApplicationShutdown`), depois do drain e do fechamento do servidor — nunca em `main.ts` (que não é a composition root sob teste) nem num tratador de sinal (que correria em paralelo com o encerramento). Os prazos de exportação são declarados em 5 s porque os padrões do SDK (até 30 s) são maiores que o que sobra de `terminationGracePeriodSeconds` depois da janela de drenagem.
- **O canal `diag` do SDK vai para stderr**, nunca para stdout: uma falha de exportação imprimiria texto livre e quebraria o contrato "um objeto JSON por linha, todas as chaves declaradas".

## Documentação relacionada

- [Arquitetura da aplicação](architecture.md)
- [Segurança e proteção de dados nos logs](security.md#proteção-de-dados-nos-logs)
- [ADR 0002 — Logging estruturado](adr/0002-logging-estruturado.md)
- [ADR 0005 — OpenTelemetry](adr/0005-opentelemetry.md)
- [Kubernetes — camada de coleta](infra/kubernetes.md#camada-de-coleta)
- [Infraestrutura · Visão Geral](infra/overview.md#camada-de-coleta-de-plataforma-namespace-platform-e-configuração-do-cd)
