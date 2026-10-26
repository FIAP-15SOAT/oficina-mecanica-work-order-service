# ADR 0005: Instrumentação OpenTelemetry — traces, correlação e métricas de negócio

## Status

Aceito — 2026-09-05

Emendado pelo [ADR 0021](0021-span-de-consumo-de-mensagens.md): o span `CONSUMER` do consumidor de mensagens é a única exceção à regra de nenhum span criado por código, e a lista de instrumentações ganha `aws-sdk` e `ioredis`.

Supera parcialmente o [ADR 0002](0002-logging-estruturado.md): a restrição anterior de não emitir identificadores de trace é substituída por identificadores reais quando há span ativo. Também corrige a recomendação anterior de instrumentação das probes no [ADR 0003](0003-health-checks.md); a política vigente está descrita abaixo, em "Probes de saúde excluídas na entrada".

## Contexto

A aplicação produz logs JSON em stdout, com nomes e tipos alinhados às Semantic Conventions, esquema fechado por dicionário de campos, redação por sequência de tokens e correlação por `request.id` e contexto de span. O SDK exporta métricas e traces por OTLP; o Datadog Agent coleta esses sinais e os logs dos contêineres quando a coleta está habilitada pelo CD.

A instrumentação atende à latência por rota com percentis, ao diagnóstico do tempo gasto na aplicação e no RDS e às métricas customizadas de volume de ordens de serviço e tempo por status. Dashboards, alertas e o teste sintético do caminho público são declarados em `oficina-mecanica-custom-monitoring`. Os endpoints `/api/health/live` e `/api/health/ready` controlam reinício e prontidão; não substituem a verificação externa de disponibilidade.

Oito fatos do estado corrente moldam tudo o que segue:

1. A saída de log é um **esquema fechado por construção**: `normalizeLogRecord` descarta toda chave que não conste do `field-registry`, e um E2E afirma `Object.keys(linha) ⊆ dicionário` em cada linha capturada.
2. O ESLint proíbe dependências de NestJS, Prisma e OpenTelemetry em `domain/` e `application/`; métricas atravessam a porta `IMetrics`.
3. `PrismaService` constrói um `pg.Pool` explícito e o entrega ao `PrismaPg`: o driver que executa as consultas é `pg`.
4. `main.ts` **não é a composition root sob teste** — o `test-app.helper.ts` monta a aplicação por `configureApp` e nunca o executa.
5. O `$disconnect()` do Prisma ocorre em `onApplicationShutdown`, preservando a ordem de encerramento da aplicação e da telemetria.
6. A coleta usa um Datadog Agent por node, aplicado opcionalmente pelo CD, e o node group atual usa um único `t3.medium`.
7. **O Jest não executa o mecanismo de patch das instrumentações.** O `jest-runtime` tem registro de módulos próprio e não passa pelo carregador do Node, onde `require-in-the-middle` engancha. Nenhuma auto-instrumentação funciona dentro das suítes, e o modo de falha é **silêncio**.
8. **A query string pode carregar dados sensíveis**, e a proteção do log é por classificação do **nome** do parâmetro, não apenas pela forma do valor. O filtro `GET /api/customers?document=<CPF>` exige redação por chave; tokens opacos também não podem depender de reconhecimento pelo formato.

## Decisão

Adotar o **SDK do OpenTelemetry** para traces e métricas, mantendo os logs onde estão, e declarar o contrato com a camada de coleta sem que a aplicação ganhe qualquer dependência, credencial ou nome de fornecedor.

### O SDK é registrado por preload, não por código de bootstrap

`node --require ./dist/src/otel.js dist/src/main`. A instrumentação funciona substituindo funções da biblioteca **no momento em que ela é carregada**, e `import { AppModule }` no topo de `main.ts` já arrasta `express` e `pg` na avaliação dos módulos. Registrar depois produz um processo que sobe normalmente, não emite nada e não reporta erro — o pior modo de falha possível.

`src/otel.ts` importa apenas folhas puras da aplicação (`logger.config`, `health.constants`, `url-attributes` e a cadeia de redação); nenhuma delas carrega `express`, `pg` ou `pino` transitivamente.

### O preload registra o hook ESM do OTel

O NestJS 12 é só ESM e carrega o `express` por `import`, que os hooks de `require` das instrumentações não veem: sem hook, os spans do `express` e o `http.route` parametrizado somem com todas as suítes verdes. O preload registra `@opentelemetry/instrumentation/hook.mjs` por `module.register` antes do `sdk.start()`, só com a telemetria ligada e só na thread principal, porque o Node também executa os `--require` na thread de hooks que o `register()` cria e ali subiria um segundo SDK. O hook tem custo: mais memória e um boot um pouco mais lento.

### Lista explícita de instrumentações

`http`, `express`, `pg` e `runtime-node`. **Sem metapacote**: `auto-instrumentations-node` liga ~40 instrumentações — aws-sdk, redis, mongo, kafka, `fs` — e paga superfície de runtime e volume por bibliotecas que o projeto não usa.

`express` não é opcional: é ele que resolve `http.route` no formato parametrizado, e `http.route` é a dimensão de toda métrica por rota. Configurado com `ignoreLayersType: [MIDDLEWARE]`, senão cada camada de middleware vira um span.

### A correlação log↔trace é um `mixin` nosso

`buildLoggerParams` ganha um `mixin` que lê `trace.getSpan(context.active())?.spanContext()` e devolve `{ trace_id, span_id, trace_flags }`, ou `{}` fora de span. Os três entram no dicionário de campos como qualquer outro atributo — sem isso, `normalizeLogRecord` os descartaria em silêncio.

A grafia é a que a própria convenção define para o mapeamento fora do OTLP (`trace_id`, e não `trace.id`), pela mesma razão que já sustenta `otel.scope.name`. `trace_flags` é **string** (`"01"`).

`request.id` **permanece**, com papel distinto: `trace_id` só existe onde há span; `request.id` existe em toda linha da requisição e também fora dela — inicialização, encerramento, eventos de negócio pós-resposta e requisições que morrem antes de alcançar a instrumentação. É também o valor ecoado no cabeçalho de resposta, ou seja, o que um usuário consegue citar num chamado.

### Probes de saúde excluídas na entrada da requisição

`ignoreIncomingRequestHook` consultando `isHealthProbePath` — um **predicado** compartilhado exportado por `health.constants`, que o supressor de access log também passa a consumir. Compartilhar apenas o conjunto de caminhos deixava o predicado livre para divergir, e divergir significa excluir do trace uma rota diferente da exposta.

Aritmética: 9 verificações/min/réplica ≈ 13 mil/dia; com 5 réplicas, ~65 mil spans de servidor/dia mais ~43 mil spans `pg` filhos da readiness — **~108 mil spans/dia sem leitor**. Neste ambiente as probes são praticamente todo o volume de requisições.

**Isto SUPERA o ADR 0003 e o requisito correspondente de `application-health-checks`; não os satisfaz.** O ADR 0003 diz, com todas as letras, que "as opções aceitáveis são amostrar apenas o sucesso ou preservar os erros; não ignorar `/api/health/*`". O que mudou não é a prioridade, é um fato de mecanismo que não estava disponível quando aquele ADR foi escrito: **`ignoreIncomingRequestHook` embrulha a requisição em `suppressTracing()`**, e por isso alcança também os spans **descendentes**. A alternativa que o ADR preferia — descartar depois de conhecer o resultado — só derruba o span de servidor e deixaria ~43 mil spans `pg` **órfãos** por dia: mais volume que não excluir nada, e sem o registro que os explicaria.

O que sustenta a superação é que não é o único registro. Uma probe que falha continua produzindo (a) a linha de access log em nível `error`, deliberadamente nunca suprimida; (b) o evento `health.degraded`, com `healthFailureCategory`; e (c) o estado da instância no Kubernetes. Se **qualquer um dos três** deixar de existir, esta exclusão deve ser reavaliada.

**A perda assumida, declarada em vez de omitida:** numa verificação que falha deixa de existir a duração do `SELECT 1` em forma de span. Ela já é delimitada pelo `query_timeout` de 2 s e sua causa já consta da categoria do evento — mas o registro honesto da perda é o que impede a decisão de ser reaberta como se nada tivesse sido ponderado. Preservar o trace da probe que falha só existe de verdade com `tail_sampling` num Collector, que esta change não introduz.

### Nenhum span carrega classe de dado que o log não carregue sanitizada

Toda a cadeia de redação — tokenizador, classificação por sequência de tokens, mascaramento preservando forma, scrubber linear, canonicalização de URL — **existe apenas no caminho de log**. Um atributo de span sai por serialização própria. Cinco medidas, todas de subtração ou reuso:

- **cabeçalhos genéricos**: `headersToSpanAttributes` é opt-in e fica desligado;
- **`client.address`, `user_agent.original`, `server.address` e `server.port`** vêm ligados por padrão e são **texto do chamador**. O `startIncomingSpanHook` trata os quatro:
  - `user_agent.original` é truncado e varrido como qualquer texto livre;
  - `client.address` é resolvido pelo **mesmo `proxy-addr`** que o Express usa por baixo do `req.ip`, alimentado pela **mesma** `TRUSTED_PROXY_CIDRS`, e o valor ainda passa por `net.isIP()` — sendo omitido, nunca substituído, quando não é um endereço. Não é duplicação por escolha: o hook roda no `emit('request')` do `http`, antes de qualquer middleware, e ali o objeto ainda é `IncomingMessage`, sem `req.ip` para reaproveitar. Gatear apenas em "existe alguma faixa configurada" e pegar o valor **mais à esquerda** do `X-Forwarded-For` não fechava nada: esse é justamente o salto que o chamador escolhe. Medido com `10.0.0.0/8` confiável e `XFF: 198.51.100.99, 203.0.113.7`, o span saía com `198.51.100.99` — texto do cliente — enquanto o log guardava `203.0.113.7`; e com um peer **fora** da faixa o span aceitava o cabeçalho que o Express ignorava por completo. Caminhando da direita para a esquerda até o primeiro salto não confiável, só se acredita no que um proxy confiável reportou, e os dois sinais coincidem em qualquer configuração — não apenas com a lista vazia;
  - `server.address` e `server.port` **não são emitidos**. A instrumentação os deriva de `Forwarded`/`X-Forwarded-Host`/`Host` sem validar, sem truncar e sem recorrer ao socket — medido, um `Host` de 322 caracteres com um e-mail dentro saía inteiro. A linha de acesso não carrega esse atributo em forma nenhuma, então não há sanitização equivalente a reaproveitar: saem por subtração, como a query;
- **`enhancedDatabaseReporting` desligado** no `pg`, para que valor de parâmetro nunca seja anexado ao atributo de consulta;
- **corpo nunca capturado**;
- **`url.path` pelo mesmo `sanitizeUrlPath` do log, e `url.query` não emitida**.

A query não é emitida porque **a proteção que o log dá a ela é por nome de parâmetro sobre a query já decomposta** — é o nome `token` que remove o segredo do fato 8 —, e um atributo de span é montado antes dessa decomposição, quando só existe o texto bruto. Emitir "o que dá para sanitizar" é a definição de fail-open. A query sanitizada permanece na linha de acesso, e o salto até ela é exatamente a feature que esta change constrói.

### Métricas de negócio por instrumentos síncronos, com porta própria

Três métricas, emitidas por **6 casos de uso**, sempre **após o commit**:

| Métrica | Instrumento | Unidade | Atributo |
| --- | --- | --- | --- |
| `oficina.work_order.created` | Counter | `{work_order}` | — |
| `oficina.work_order.status.duration` | Histogram | `s` | `oficina.work_order.status` |
| `oficina.work_order.diagnosis_to_completion.duration` | Histogram | `s` | — |
| `oficina.work_order.lead_time.duration` | Histogram | `s` | — |

Uma porta `IMetrics` em `application/ports/output/`, catálogo tipado e fechado em `application/metrics/`, registry e adaptador em `infrastructure/telemetry/` — o mesmo desenho de `ILogger`, pelo mesmo critério: *a camada de aplicação precisa emitir esse sinal?* Para traces a resposta é **não** (o span vem do transporte), e por isso não há `ITracer`; para estas métricas o requisito faz do caso de uso o emissor.

**Permanência em todo status com transição de saída**, `REJECTED` inclusive: a máquina de estados declara `[REJECTED]: [AWAITING_APPROVAL]`, então a ordem recusada volta ao fluxo, e tratá-la como terminal deixaria sem medida justamente a espera que mais dói. Terminais são apenas `DELIVERED` e `CANCELLED` — definição derivada do próprio mapa de transições (`WorkOrder.isTerminalStatus`), nunca uma segunda lista mantida à mão.

**Reentrada: a permanência ancora na entrada mais recente; os totais, na primeira.** São duas regras de busca diferentes na mesma função pura. Ancorar a permanência na primeira ocorrência inflaria a distribuição em silêncio e proporcionalmente ao retrabalho — que é exatamente o que a métrica deveria expor.

**Os tempos vêm do histórico já persistido, lido DEPOIS do commit.** `created_at` é `@default(now())` escrito pelo PostgreSQL: os dois extremos de cada intervalo vêm do mesmo relógio. Usar `Date.now()` do processo subtrairia relógios distintos e, sob desvio pod↔RDS, produziria durações **negativas**, que o SDK descarta com um aviso e sem falhar.

A leitura é **fora da transação**, e isso é decisão, não detalhe. Dentro dela, uma consulta que existe só para observabilidade podia derrubar a operação de negócio junto — e sem conserto local: no PostgreSQL a transação já estaria abortada e o `COMMIT` que o Prisma emite ao fim do callback viraria **ROLLBACK silencioso**, com a API respondendo sucesso. Fora, a falha é absorvida e o que se perde é uma observação de métrica, cuja natureza de melhor esforço é declarada. Some-se que a leitura deixa de prolongar os locks de toda transição.

⚠️ **A leitura acontece mesmo com a telemetria desligada, e isso é custo assumido.** `recordWorkOrderTransition` consulta o histórico antes de emitir, e nada nesse caminho pergunta se há destino configurado — com o endpoint vazio os instrumentos são no-op, mas a consulta ao banco roda igual, nas cinco transições que a chamam. Gatear exigiria expor na porta `IMetrics` se ela está ativa, o que é estado de infraestrutura numa porta que existe justamente para escondê-lo. Medido contra o custo real — uma leitura indexada por `work_order_id`, em transições de status que acontecem poucas vezes por ordem —, a troca não se paga.

**A transição corrente é localizada por identidade, não por posição.** O insert devolve a linha do banco, e é o `id` dela que ancora o cálculo. Tomar "a última linha do histórico" era possível enquanto a leitura vivia dentro da transação; depois do commit, uma transição concorrente já confirmada pode aparecer depois da nossa, e a medida seria de outra operação. A ordenação cronológica de `findByWorkOrderId` continua sendo contrato — as buscas por "primeira" e "mais recente" dependem dela —, e está **declarada na interface** (`IStatusHistoryRepository`) e **afirmada por spec** do repositório Prisma, que verifica o `orderBy` enviado ao banco. As duas coisas foram acrescentadas depois: por duas rodadas este parágrafo afirmou a declaração sem que ela existisse, e o modo de falha é exatamente o que a declaração existe para impedir — trocar a ordem não quebra teste nenhum e corrompe as durações em silêncio.

### Agregação e temporalidade declaradas, nunca herdadas

A agregação padrão de histograma usa fronteiras que terminam em 10 000, dimensionadas para **milissegundos** de requisição; as permanências são medidas em **segundos** e vão de minutos a dias, então **toda** observação cairia no último balde: a média continuaria certa e os percentis — a razão de existir do painel exigido — não teriam significado, sem nada falhar. As durações declaram `ExponentialHistogramAggregation` por View, no registry, ao lado do nome físico.

`OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta`: o OTel JS exporta cumulative por padrão. Três motivos, todos do destino e nenhum de preferência:

- o Datadog é **otimizado para delta** em somas monotônicas, histogramas e histogramas exponenciais — que são exatamente os três instrumentos usados aqui;
- cumulative exige que **todos os pontos de uma série cheguem ao mesmo agente**, o que um DaemonSet com HPA de 1 a 5 réplicas não garante;
- cumulative faz o destino **descartar o primeiro ponto** de cada série, abrindo lacuna a cada reinício e a cada rollout, e pode perder mínimo e máximo dos histogramas.

**A perda assumida, medida:** com delta, uma exportação que falha perde definitivamente a janela que carregava — verificado com um exportador controlado, 5 observações na exportação que falha e 2 na seguinte resultam em **2** no destino, não 7. Cumulative se recuperaria (reportaria 7), mas ao custo dos três itens acima. É a mesma natureza do descarte declarado do `BatchSpanProcessor`, e pelo mesmo motivo: a aplicação nunca segura a requisição por causa de telemetria. Se a subcontagem incomodar, a resposta é encurtar `OTEL_METRIC_EXPORT_INTERVAL` — nunca bloquear.

### Pipelines declarados, e o de logs desabilitado

A **ausência** de `OTEL_LOGS_EXPORTER` faz o `NodeSDK` instanciar um `LoggerProvider` com exportador OTLP de rede. Nada o alimentaria — os logs têm um caminho único, stdout —, mas manter um exportador vivo contradiz a decisão e deixa a porta aberta para que uma configuração futura passe a alimentá-lo. `OTEL_LOGS_EXPORTER=none`, explícito no ConfigMap **e** como padrão no código, para que remover a chave não reabra o pipeline em silêncio.

### Atributos de recurso com origem única

`otel.ts` monta o `Resource` a partir de `resolveLoggerConfig()`, de modo que `service.name`, `service.namespace`, `service.version`, `service.instance.id` e `deployment.environment.name` sejam idênticos entre log, trace e métrica **por construção**.

⚠️ **`OTEL_RESOURCE_ATTRIBUTES` não pode carregar nenhum dos cinco.** Verificado: o `envDetector` **vence** o resource montado em código, e o caminho de log ignora essa variável — declarar `service.version` ali faria trace e log reportarem versões diferentes, em silêncio, desligando a navegação cruzada entre sinais no destino.

### Encerramento num hook do Nest, com orçamento fechado

`TelemetryLifecycleService.onApplicationShutdown` chama `sdk.shutdown()` sobre a instância que o preload registrou. Não em `main.ts` (fato 4), não num tratador de sinal (correria em paralelo com o encerramento do Nest), e não em `onModuleDestroy` (fato 5: rodaria antes do drain, exportando spans de requisições ainda em voo).

Os padrões do SDK não cabem na janela: `terminationGracePeriodSeconds` é 40 s, dos quais 10 são drenagem, e o prazo padrão do leitor de métricas sozinho é 30 s. Um prazo apenas **externo** — uma corrida contra um relógio — abandona a espera sem **cancelar** a exportação, e o `SIGKILL` cortaria o flush e os hooks seguintes junto. Os prazos são declarados nos exportadores (5 s), com as variáveis padronizadas como sobreposição do operador, e o hook mantém um teto próprio de 8 s como rede de segurança.

### O canal `diag` vai para stderr

Por padrão ele escreve no console: uma falha de exportação imprimiria texto livre em **stdout**, violando o contrato "um objeto JSON por linha, todas as chaves declaradas". Redirecionado para o mesmo canal de erro que o logging já usa, com o mesmo envelope, e com limite próprio de 256 caracteres — medido: o `globalErrorHandler` do OTel entrega ao `diag` o erro serializado com o stack inteiro.

O logger próprio é instalado **antes** do construtor do `NodeSDK`, e `OTEL_LOG_LEVEL` é tirada do caminho dele. O construtor instala um `DiagConsoleLogger` por conta própria quando a variável está definida, e a chamada de instalação já **emite** — medido, `@opentelemetry/api: Registered a global for diag` em stdout, antes de qualquer chance de sobrescrever o canal. A intenção do operador não se perde: a variável passa a controlar o nível deste canal, com teto em `WARN` porque ele nunca emite abaixo disso.

O canal também **agrega repetição por causa**: medido no smoke, 60 s contra um destino inalcançável produziram 78 linhas idênticas. A primeira ocorrência de cada causa sempre sai; as repetições dentro da janela viram uma contagem na linha seguinte. E a severidade de quem reporta é preservada — descarte de span por fila cheia é `warn`, porque é o comportamento declarado como aceito, e achatá-lo em `error` tornaria inútil qualquer alerta sobre este canal.

### Nenhuma configuração de telemetria impede o boot

A fronteira não-lançante cobre a **construção** do SDK, não só o `start()`. Medido: as variáveis do leitor periódico são relacionadas — o construtor recusa um intervalo menor que o prazo de exportação — e resolvê-las isoladamente deixava qualquer `OTEL_METRIC_EXPORT_INTERVAL` abaixo dos 5 s padrão, **`1000` inclusive**, derrubando o processo com código 1, sem uma linha em stdout, e a réplica em CrashLoop. Num preload, uma exceção é fatal. A resolução é feita como conjunto (o intervalo pedido é respeitado e o prazo encolhe até ele), com diagnóstico, e o que ainda escapar é absorvido e desliga só a telemetria.

Prazo de exportação acima do teto do hook de encerramento também é reduzido: um prazo maior derrota o teto, porque o `Promise.race` abandona a espera mas o handle continua vivo, o processo não encerra e o `SIGKILL` corta os hooks seguintes junto.

### Sem endpoint configurado, o SDK não inicia

`OTEL_EXPORTER_OTLP_ENDPOINT` vazio ⇒ nenhuma instrumentação registrada, nenhum exportador, nenhuma conexão — e **nenhum módulo do SDK carregado**, porque a verificação acontece antes dos imports, que são feitos sob demanda. Com `import` no topo, o modo "desligado" ainda pagava ~348 módulos e ~13,5 MiB de RSS por pod, medidos no grafo real da aplicação, e o rollback anunciado ("editar o ConfigMap") não os devolvia. É o interruptor — e o que mantém as suítes E2E e o desenvolvimento local sem exportador de fundo. Um `OTEL_ENABLED` seria anti-feature pelo mesmo argumento que o `HEALTH_ENABLED` recebeu no ADR 0003: criaria uma segunda verdade sobre o mesmo estado.

### Amostragem integral na aplicação

`parentbased_always_on`, que é o padrão. A decisão de volume pertence a quem conhece o custo e a capacidade do destino; excluir as probes é o único controle que a aplicação exerce.

⚠️ Nota que muda como um alerta é escrito: pela semconv, span de **servidor** com `4xx` tem status **UNSET**. Um `409` de estoque insuficiente **não** é span de erro, e alerta sobre falhas de processamento precisa de condição explícita de status.

## Alternativas consideradas e descartadas

Registradas com o **motivo**, para que não sejam reconsideradas do zero.

| Alternativa | Por que não |
| --- | --- |
| **Hook ESM por `--experimental-loader` no `CMD`** | Mudaria o `CMD` do Dockerfile e o `start:prod`, e a documentação do OTel já aponta o `module.register` no bootstrap como caminho. |
| **Loader síncrono do `import-in-the-middle` (`register-hooks.mjs`, sobre `module.registerHooks`)** | Roda na própria thread, sem a thread de hooks nem a guarda `isMainThread`, mas o OTel ainda não o suporta oficialmente: o único hook suportado é `@opentelemetry/instrumentation/hook.mjs`. O `module.register` é a depreciação documental DEP0205 no Node 24. Revisitar se o OTel adotar o `module.registerHooks`, se o Node remover o `module.register` ou na migração para o Node 26. |
| **`dd-trace`** (tracer nativo do fornecedor) | Uma linha de setup e a melhor integração possível — ao custo de acoplar o fornecedor **na árvore de dependências da aplicação**, exatamente o que o ADR 0002 rejeitou em `winston-datadog`. Trocar de plataforma viraria mudança de código. Descartado em definitivo. |
| **`@opentelemetry/auto-instrumentations-node`** | ~40 instrumentações por um pacote, incluindo `fs` (span por operação de arquivo). Superfície de runtime e volume por bibliotecas que o projeto não usa. O precedente do projeto é declarar por nome o que se configura por nome. |
| **`@prisma/instrumentation`** | Exige `previewFeatures = ["tracing"]` no schema, acrescenta spans de fase do engine que ninguém lê, e mede uma camada acima do driver — pior granularidade por mais peso. O `pg.Pool` explícito do `PrismaService` torna `instrumentation-pg` estritamente melhor. |
| **Logs pelo pipeline OTLP** | Perde o destino síncrono (que existe porque o buffer assíncrono perde as últimas linhas num OOM kill), perde a validação de esquema na saída, cria backpressure de rede no caminho da requisição e duplica volume — o coletor lê o stdout do contêiner de qualquer forma. |
| **`@opentelemetry/instrumentation-nestjs-core`** | Grava `url.full = req.originalUrl \|\| req.url` num span próprio, **sem nenhum ponto de configuração** — o pacote não expõe sequer um tipo de config. Com o fato 8 do contexto, isso significa exportar a query inteira, CPF de filtro incluído, e nenhuma correção aplicada ao span de servidor alcança esse atributo. O que ele acrescentaria (o nome do handler) já existe no log como `code.function.name`, agora unido ao trace por `trace_id`. |
| **`@opentelemetry/instrumentation-pino`** | Três motivos, o decisivo primeiro: pelo fato 7, nenhuma instrumentação é aplicada sob Jest, então "a linha de access log carrega `trace_id`" ficaria **sem cobertura possível** e o E2E que a afirmasse passaria vazio. Além disso declara `pino >=5.14.0 <11` com o projeto em 10.x — um `npm update` de rotina pararia o patch em silêncio. E acrescenta `require-in-the-middle` no caminho do componente que o ADR 0002 mais protege. |
| **`redactedQueryParamsServer`** | Denylist por **nome de parâmetro**: protege só os nomes que alguém lembrou de listar. É precisamente o modo fail-open que o `field-classifier` foi construído para eliminar. |
| **Manter `url.query` no span** (refatorando `url-attributes` para expor um sanitizador de query) | É a única forma **correta** de manter a query no trace: parsear no hook para ter os nomes e rodar `sanitizePayload`. Mexe no módulo mais sensível do repositório para recuperar um atributo que o log já tem e que o `trace_id` agora alcança. Fica registrado como o caminho a seguir **se** a query no span vier a ser necessária. |
| **`applyCustomAttributesOnSpan`** em vez de `startIncomingSpanHook` | Roda no `finish`, com o `req` já do Express, então `buildQueryString` funcionaria sem refatoração. Mas **não é chamado** em `_onServerResponseError`: numa requisição abortada ou num erro de transporte o valor cru seria exportado. Fail-open num caminho de exceção é pior que a limitação que ele resolve. |
| **`ObservableGauge` lendo o banco** | Reporta o **mesmo** valor em cada réplica: com `service.instance.id` distinto por pod, a agregação por soma dá **N× a verdade**. Com o HPA indo de 1 a 5, é uma armadilha permanente em todo dashboard e alerta. Continua sendo a única forma de medir "OS parada há N dias" — fica como melhoria opcional, com a ressalva de agregação. |
| **Receiver `sqlquery` do Collector / `custom_queries`** | Zero código e lê a fonte da verdade, mas o requisito do trabalho pede métrica **instrumentada**, e exigiria conceder credencial de banco ao coletor. |
| **Coluna `statusChangedAt` em `work_orders`** | Melhor modelagem de domínio e tornaria a permanência uma subtração sem leitura — mas é migration + entity + mapper + todos os caminhos de escrita, **e ainda não daria os totais**. Escopo grande para uma necessidade de telemetria; reavaliar se o produto pedir o dado. |
| **`WorkOrder.updatedAt` como origem dos tempos** | Muda em **qualquer** escrita na OS, não só em transição. Mediria outra coisa, e ninguém perceberia. |
| **OTLP direto para a intake do fornecedor** | Zero componentes no cluster — e coloca a **chave de API dentro da aplicação**, o oposto do objetivo. Além disso não resolve CPU/memória, uptime nem coleta de log. |
| **Sampler descartando só o sucesso das probes** | `shouldSample` é avaliado no **início** do span, quando o status ainda não existe e `http.route` ainda não foi resolvido. Não dá para decidir por resultado ali. |
| **`SpanProcessor` filtrando no `onEnd`** | Lê o status final, mas só do span de **servidor**: os spans `pg` já foram exportados e ficariam órfãos. Piora o que pretendia melhorar. |

## Consequências

**Positivas**

- Latência por rota com percentis passa a ter fonte **portátil** (`http.server.request.duration`, emitida pela instrumentação com `http.route` parametrizado), em vez de depender de trace metrics calculadas pelo fornecedor.
- `db.client.operation.duration` e `db.client.connection.{count,max,pending_requests}` tornam observável em série temporal exatamente o que o desenho da verificação de prontidão existe para detectar.
- Salto log↔trace pelo `trace_id` na linha que mais importa, o access log.
- As métricas de negócio ficam corretas sob escala horizontal e sob rollback, por construção.
- Trocar a plataforma de destino não toca no código da aplicação.

**Negativas e riscos aceitos**

- Numa probe que falha, deixa de existir a duração do `SELECT 1` em forma de span (acima).
- A query da URL não existe no trace; quem precisar dela salta para a linha de access log pelo `trace_id`.
- `client.address` no span não reproduz a cadeia de `trust proxy` do Express — reimplementá-la seria uma segunda política de segurança a divergir. Em nenhum caso sai texto que não seja um IP.
- **Overhead medido** sobre a stack do compose (Docker Desktop, 400 amostras em `GET /api/customers` após 40 de aquecimento; valores absolutos não representam produção, a ordem de grandeza sim): com telemetria ligada p50 11,3 ms / p95 23,5 ms / 145,8 MiB; desligada p50 7,9 ms / p95 13,3 ms / 126,1 MiB. O HPA mira 80% de `requests` de 256Mi, ou 204,8 MiB: a margem estreita de ~78 MiB para ~59 MiB, e o gatilho não é cruzado pelo SDK sozinho. Com o carregamento sob demanda, o modo **desligado** voltou à baseline anterior à change — medido, +1 módulo e nenhum módulo do SDK.
- Numa exportação de métrica que falha, a janela é perdida definitivamente (temporalidade delta, acima).
- Nenhuma auto-instrumentação é exercitada por Jest: spans reais, `http.route` parametrizado, exclusão das probes e ausência de `url.query` só são verificáveis no smoke fora do Jest, sobre a stack do compose.

**Isolamento das camadas**

O flat config do ESLint aplica as restrições por camada depois das regras gerais. `domain/`, `application/` e `interface-adapters/` não importam NestJS, Prisma ou OpenTelemetry; as portas de logging e métricas mantêm os detalhes de infraestrutura fora desses anéis.

Essa ordem evita perder as restrições: um bloco posterior que se aplica ao mesmo arquivo pode substituir as opções da mesma regra. As opções específicas de imports por camada precisam prevalecer sobre as gerais.

## Camada de coleta

```
  cliente ──▶ pod work-order-service
                ├─ spans/métricas OTLP :4318 ──┐
                └─ stdout JSON ────────────────┤ (log do contêiner)
                                               ▼
              Agente/Collector (DaemonSet) — única peça que conhece o fornecedor
                receiver OTLP    → APM + trace metrics
                container logs   → Logs
                kubelet/cAdvisor → CPU, memória e restarts
                                               ▼
                                          Plataforma
```

O Agent (DaemonSet) e o Service `datadog-agent` rodam no namespace `platform`, aplicados pelo CD do `oficina-mecanica-infra-k8s` (`k8s/platform/`), que também materializa o `DD_API_KEY`; este repositório não tem manifesto do Agent nem a chave. Quando esta ADR foi aceita, os manifestos ficavam em `k8s/06` a `k8s/08` deste repositório, atrás de uma variável de gate.

**Por que o Agent e não um OTel Collector**, sendo esta a change que mais investiu em neutralidade: o requisito escrito é neutralidade **da aplicação**, e ela está satisfeita pelas duas opções — o processo exporta OTLP puro e não conhece fornecedor. O que o Collector acrescentaria é portabilidade da *camada de coleta*, escopo não pedido, ao custo de um ConfigMap com `filelog` + parser de contêiner + `trace_parser`, `kubeletstats` e `k8sattributes` — cada um um lugar onde se recebe silenciosamente nada, que é o modo de falha contra o qual esta change inteira foi construída. E no Datadog, dado de infra vindo do Collector é cidadão de segunda classe: pagar-se-ia a portabilidade e se teria experiência pior na plataforma que de fato existe. A chave de API não é diferencial — o exporter do Collector também precisaria dela. Reavaliar se a plataforma de destino mudar, ou se `tail_sampling` passar a ser necessário.

O endpoint aponta para o **DNS do Service** do agente, não para `status.hostIP` via Downward API: num cluster de um único node a diferença de roteamento é zero, e evita reintroduzir o wiring que o ADR 0002 deliberadamente evitou.

`OTEL_EXPORTER_OTLP_ENDPOINT` é controlado pela variável homônima do GitHub Actions. O CD renderiza seu valor no ConfigMap, e os Pods do rollout seguinte o leem: vazio mantém o SDK desligado; `http://datadog-agent.platform.svc.cluster.local:4318` envia traces e métricas ao Service do Agent. Nenhuma alteração exige rebuild da imagem.

**Uptime não é estado de pod.** Readiness decide roteamento e liveness decide reinício; nenhuma das duas enxerga DNS, load balancer, TLS ou ingress — é possível ter 100% dos pods `Ready` com a API inacessível de fora. O requisito de disponibilidade só se fecha com **monitor sintético externo**, entrega da camada de coleta.

**Capacidade:** pela fórmula padrão do VPC CNI, o `t3.medium` configurado permite **17 pods** por node. Workloads de sistema, MailHog, Agent e as réplicas da API compartilham esse teto. O valor exposto pelo cluster pode ser consultado com `kubectl get node -o jsonpath='{.items[*].status.allocatable.pods}'`.

## Referências

- [ADR 0002 — Logging estruturado](0002-logging-estruturado.md)
- [ADR 0003 — Health checks](0003-health-checks.md)
- [`docs/architecture.md`](../architecture.md)
- OpenTelemetry Semantic Conventions — [mapeamento de trace context fora do OTLP](https://opentelemetry.io/docs/specs/otel/compatibility/logging_trace_context/)
