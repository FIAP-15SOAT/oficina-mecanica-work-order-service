# ADR 0003: Health Checks — Liveness e Readiness como Endpoints Dedicados

## Status

Aceito — 2026-08-28

Supera parcialmente o [ADR 0002](0002-logging-estruturado.md) na parte de supressão de ruído das probes.

Emendado pelo [ADR 0026](0026-usuarios-lidos-no-identity-sem-replica.md): o envio de e-mail citado abaixo como operação sem prazo no caminho de requisição saiu deste serviço; o e-mail passou a ser uma mensagem gravada no outbox e enviada pela função de notificação.

## Contexto

As probes do Kubernetes apontavam para `/api/docs` — a UI do Swagger — porque essa era, na época, a rota pública que retornava `200` sem autenticação. Isso tinha três consequências, e todas pioram com o tempo.

**1. A readiness não sabia nada sobre o banco — nem no boot.** Com Prisma 7 + `@prisma/adapter-pg` o `$connect()` é **preguiçoso**: `PrismaPg.connect()` apenas instancia um `pg.Pool`, e o pool só abre socket na primeira consulta. Medido contra `postgresql://nobody:nobody@127.0.0.1:1/nodb`:

```
$connect()  RESOLVED after 394ms   ← não lança
SELECT 1    rejected after 84ms    ← a primeira consulta é que falha
```

Ou seja: "porta aberta" nunca foi nem um proxy acidental para "banco acessível". O pod ficava `Ready` com o banco morto desde o primeiro instante, respondendo `5xx` em toda rota de negócio enquanto a probe devolvia `200`.

**2. A liveness era refém da documentação.** Desligar o Swagger em produção — um endurecimento normal — derrubaria simultaneamente as probes de **todas** as réplicas, transformando um ajuste de documentação numa indisponibilidade total.

**3. Não existia drain no encerramento.** O `ProcessLifecycleService` apenas *registrava* o shutdown; nada marcava o pod como indisponível antes de o servidor parar de aceitar conexões, então um rollout descartava requisições em voo.

Uma restrição do framework condiciona todo o desenho. O `close()` do Nest executa, nesta ordem (`nest-application-context.js`):

```js
await this.callDestroyHook();               // onModuleDestroy
await this.callBeforeShutdownHook(signal);  // beforeApplicationShutdown
await this.dispose();                       // o servidor HTTP fecha AQUI
await this.callShutdownHook(signal);        // onApplicationShutdown
```

E o pool do `pg` era construído sem limite algum: `new PrismaPg(process.env.DATABASE_URL!)` passa só a string, então valiam `connectionTimeoutMillis: 0` (esperar por conexão para sempre) e `keepAlive: false` (peer morto detectado só pelo retransmission timeout do SO, na ordem de minutos).

## Decisão

### Dois endpoints com semânticas opostas, e três probes

`GET /api/health/live` não executa I/O algum e responde à única pergunta cujo remédio é reiniciar o processo. `GET /api/health/ready` verifica o PostgreSQL (`SELECT 1`, com prazo próprio) e o estado de encerramento, respondendo à pergunta de roteamento.

**O PostgreSQL não participa da liveness.** O argumento é a natureza **compartilhada** da dependência, não o seu meio de armazenamento: o banco é uma instância única para todas as réplicas, e uma liveness que o verificasse reiniciaria a frota inteira durante a indisponibilidade, somando espera crescente de reinício a um sistema já degradado. O `startupProbe` aponta para `/live` pelo mesmo motivo — falha de startup **mata o container**.

Não existe um terceiro endpoint para startup: startup é uma *probe*, não uma semântica de saúde.

**Reconhecimento honesto, registrado para não ser reaprendido:** como a dependência é compartilhada, readiness com banco **não** protege o usuário de um PostgreSQL morto — não há réplica saudável para onde desviar, e o efeito é trocar "500 com corpo" por "Service sem endpoints". O valor real está em (1) falha por-réplica, como um pool travado numa instância, e (2) o drain no encerramento. A decisão se sustenta por esses dois motivos, não pelo primeiro.

### A conexão preguiçosa muda o comportamento esperado — para melhor

Como `$connect()` não abre conexão, `onModuleInit()` não lança, `listen()` acontece e a porta abre. Um pod criado com o banco indisponível **sobe normalmente**, passa no `startupProbe`, responde `/live` = `200` e `/ready` = `503`, e se recupera sozinho quando o banco volta — sem `CrashLoopBackOff` e sem espera de reinício acumulada. É exatamente o comportamento cloud-native desejado, e ele já existia; o que faltava era um endpoint que o reportasse.

Efeito colateral tratado junto: a mensagem de `TECHNICAL_EVENTS.DATABASE_CONNECTED` descreve **inicialização do pool**, não abertura de conexão — depois de um `$connect()` preguiçoso, afirmar conexão seria afirmar o que não houve.

### Implementação própria; `@nestjs/terminus` avaliado e rejeitado

Um componente de infraestrutura próprio, pequeno e explícito, sem dependência de runtime nova. A intenção original era usar `@nestjs/terminus@11.1.1`; a avaliação — feita no tarball publicado, não na documentação — a inverteu:

| Esperado | Realidade verificada |
|---|---|
| Um controller que monta a resposta e nunca lança | `HealthCheckService.check()` **lança** `ServiceUnavailableException` no resultado `error` **e** em `shutting_down`. Não lançar exige `try/catch` explícito |
| Nenhuma linha de log por probe falha | `check()` chama `this.logger.error(msg)` antes de lançar, e o `TERMINUS_LOGGER` default vira o logger do `nestjs-pino` da aplicação: **uma linha JSON por verificação falha**. Só `forRoot({ logger: false })` evita |
| Timeout por indicator | `promiseTimeout` é um `Promise.race` puro: responde por prazo, mas **não cancela** a consulta — não resolve o acúmulo durante a degradação, que é o problema real |
| `PrismaHealthIndicator` pronto para uso | Funciona por um caminho frágil: chama `$runCommandRaw` incondicionalmente e só cai no `SELECT 1` se a mensagem do erro contiver a substring inglesa `'Use the mongodb provider'`. Uma reformulação dessa mensagem pelo Prisma quebra a readiness **em silêncio**, e nenhum check de tipo detecta |
| Drain gracioso pronto | `GracefulShutdownService.beforeApplicationShutdown` é um `sleep(ms)` condicionado a `SIGTERM` — e, por rodar em `beforeApplicationShutdown`, acontece **depois** do `onModuleDestroy`: **não funciona** sem mover o `$disconnect()` do Prisma de qualquer forma |

O que sobraria da biblioteca depois das correções obrigatórias é um booleano `isShuttingDown` e um `sleep()` condicional. O custo seria `boxen` + `check-disk-space` e ~10 pacotes transitivos em `dependencies` na imagem de produção, mais dez health indicators instanciados como providers, dos quais este projeto usaria zero.

*Contra-argumento reconhecido:* usar a biblioteca canônica do NestJS é, em si, um sinal defensável num entregável acadêmico. Uma reanálise futura que decida readotá-la deve fazê-lo **por esse motivo** — não pela justificativa do drain, que é falsa, nem pela do timeout por indicator, que não cancela nada.

### Uma verificação em voo, com prazo por chamador

Requisições concorrentes aguardam a **mesma** verificação em andamento, e nenhum resultado é reaproveitado depois de concluído. O ponto que decide o comportamento em falha é o ciclo de vida do slot:

| | Quem detém o slot | Quando é liberado |
|---|---|---|
| **Decidido** | A **promessa bruta** da consulta de verificação | Somente quando ela **assenta** |
| Rejeitado | A promessa já embrulhada no `Promise.race` do prazo | No prazo — e aí as verificações seguintes disparam consultas novas sobre as antigas ainda pendentes |

O prazo do chamador (3 500 ms) apenas **abandona a espera**: cada requisição faz `Promise.race([slot, prazo])` e responde indisponibilidade se o seu prazo vencer primeiro; o slot continua lá. Resultado: no máximo **uma** consulta de verificação em voo por réplica, por construção e em qualquer cenário — inclusive durante a degradação.

**O ramo simétrico — a promessa que nunca assenta — é o que decide se a réplica consegue voltar.** Se ela não terminar, nenhuma verificação nova começa, e a instância continua respondendo `503` **mesmo depois de o banco voltar**; como `/live` continua `200`, o Kubernetes não reinicia e não há recuperação automática. Segurar o slot até assentar elimina o acúmulo, mas cria esse rabo — e ele precisa ser fechado por um limite que **encerre a operação**, não por um que a abandone.

`connectionTimeoutMillis` e `keepAlive` sozinhos **não fecham esse ramo**: o primeiro limita apenas a aquisição/estabelecimento de conexão, e o segundo depende do transporte — contra um backend vivo no nível TCP que aceita a consulta e não responde, nenhum dos dois dispara, e o pior caso é **ilimitado**.

Quem fecha é um **prazo por consulta**, aplicado só à verificação:

```ts
// PrismaService: o pool é construído aqui e entregue ao adapter
const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
  connectionTimeoutMillis: 3_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

new PrismaPg(pool, { disposeExternalPool: true });

// PostgresHealthCheck: o prazo vale para esta consulta, e só para ela
await this.prisma.pool.query({ text: 'SELECT 1', query_timeout: 2_000 });
```

No estouro, o `pg` rejeita a promessa, o `Pool` **remove** o client (`client.release(err)` → `_remove`) e o `Client.end()` **destrói o socket**, porque há consulta ativa. É isso — e não o `Promise.race` — que libera o slot. O `disposeExternalPool` mantém o `$disconnect()` como único ponto de encerramento, então entregar o pool pronto ao adapter não acrescenta ciclo de vida algum.

**Por que o prazo é por consulta e não global.** Um `query_timeout` no `PoolConfig` valeria para toda consulta da aplicação, impondo um teto de duração a rotas de negócio que hoje não têm nenhum — e que podem legitimamente crescer. Um pool separado só para a probe resolveria isso, mas mediria **outro** pool, perdendo a detecção de saturação por-réplica que é um dos dois motivos pelos quais a readiness verifica o banco. O pool é um só, compartilhado, e o prazo é declarado na consulta.

***Correção de decisões anteriores desta mesma ADR.*** Duas afirmações da versão anterior estavam tecnicamente erradas e são registradas aqui em vez de apagadas: (1) `query_timeout` **não** é "o mesmo abandono de espera que o `Promise.race`" — o `race` não assenta a promessa subjacente, o `query_timeout` assenta, e é exatamente essa diferença que resolve o problema; (2) `statement_timeout` **não** exige transação na forma global — o `pg` o aceita direto no `PoolConfig` e o envia no startup packet. A objeção original vale apenas para um `statement_timeout` escopado à probe via `$queryRaw`, que aí sim precisaria de `SET LOCAL` numa transação. `statement_timeout` continua não sendo adotado, mas agora pelo motivo certo: ele mede no **servidor**, e não alcança resposta perdida na rede nem backend incapaz de executar o próprio timer.

***Resíduo declarado:*** o `query_timeout` não envia `CancelRequest` ao PostgreSQL, então o servidor pode continuar trabalhando na consulta abandonada. O que o desenho garante é o encerramento do lado do cliente e a liberação do slot; o pior caso continua sendo uma operação órfã por réplica, nunca uma fila delas.

Um cache com TTL foi rejeitado: resultado obsoleto é exatamente o que a readiness não pode devolver, e o caso pior é o encerramento — um `ok` guardado antes do `SIGTERM` responderia `200` depois dele.

### O `$disconnect()` migra para `onApplicationShutdown`

Pela ordem de hooks acima, `onModuleDestroy` roda **antes** da janela de drain e antes de o servidor parar de aceitar. Sem a mudança, a sequência real seria:

```
SIGTERM → $disconnect()  → [janela de drain]        → servidor fecha
          pool fechado     pod ainda aceita tráfego
                           sem poder falar com o banco
```

O drain converteria "descartar requisição em voo" em "responder erro", que é **pior** do que não ter drain. Com a mudança:

```
SIGTERM → [draining=true + janela] → servidor fecha → $disconnect()
```

A janela é de **10 s**, dimensionada pela propagação da remoção no plano de dados (EndpointSlice → kube-proxy) somada a um orçamento para requisições já roteadas — **não** pelo `periodSeconds` da readiness: quando o pod é deletado, o endpoint é marcado não pronto pela própria deleção, independentemente da probe seguinte.

**A janela é condicional ao sinal e ao ambiente**, e isso não é detalhe. Um `app.close()` sem sinal marca `draining` e retorna imediatamente: sustentá-la incondicionalmente reteria cada suíte E2E pela janela inteira e, pior, no caminho de falha de bootstrap do `main.ts` manteria o laço de eventos vivo pelo próprio timer — fazendo o watchdog de 5 s truncar o encerramento que a janela deveria ordenar. E ela só é sustentada onde existe um plano de dados para o qual propagar a remoção (`NODE_ENV=production`, declarado tanto no ConfigMap quanto no Compose): fora dele é só latência, e `nest start --watch` — que mata o processo com `SIGTERM` e só respawna no `exit` — passaria a pagar 10 s por hot reload em Linux/macOS.

O drain é declarado como **orçamento fixo e de melhor esforço**: enquanto houver operação sem prazo próprio no caminho de requisição (hoje o envio de e-mail dentro da transação, sem timeouts SMTP), nada garante que toda requisição em voo termine dentro dele.

### Corpo mínimo, `no-store`, e a causa no log

`200 {"status":"ok"}` / `503 {"status":"unavailable"}`, idêntico para toda causa de falha, com `Cache-Control: no-store` — uma resposta de saúde servida de cache informa sobre um estado passado, o único que a decisão não pode usar. O corpo não carrega host, porta, cadeia de conexão, mensagem de driver, stack, versão nem identificação da instância. É a primeira rota da API que deliberadamente **não** usa o envelope `{ data }`, e isso está declarado em `docs/api.md`.

**Só a indisponibilidade esperada vira `503`.** A fronteira é a **origem** da falha, não o seu tipo: o que a consulta de verificação rejeitar — incluindo o prazo próprio — é indisponibilidade; o que o nosso próprio código quebrar fora dela propaga e sai `500` pelo tratamento global. Um `catch` amplo converteria defeito de programação em "banco indisponível" e esconderia a causa real justamente no endpoint criado para diagnosticar. O `AllExceptionsFilter` e o `recordHttpFailure` permanecem **genéricos**, sem isenção por rota; o handler obtém a isenção deixando de lançar.

O diagnóstico vai para o log, em dois eventos de transição — `health.degraded` (aviso) e `health.recovered` (informação, com a duração da degradação) —, emitidos apenas quando o estado **muda**. A linha de degradação carrega a **causa**, em categoria fechada e de cardinalidade fixa:

`timeout | connection | pool | authentication | query | unknown`

Sem ela o desenho não cumpriria o que promete: a resposta é idêntica para toda causa por decisão de segurança, e o access log de um `503` deliberado **sem exceção** não carrega atributos de erro — de modo que nada distinguiria um banco inalcançável de um pool esgotado. A categoria é derivada da **forma** da falha — um SQLSTATE do PostgreSQL ou um código do `libuv` —, e **nenhum texto do driver entra no registro**. Como a verificação fala com o `pg` diretamente, o que chega é o erro do driver sem embrulho.

**Mas nem toda falha do `pg` traz código, e a exceção precisa ser declarada em vez de escondida.** Um conjunto de falhas de conexão chega sem `code`, sem `severity` e sem `syscall` — `Connection terminated unexpectedly` entre elas —, e o próprio estouro do `query_timeout` chega como `Query read timeout`. Para essas, e **só** para essas, a classificação usa uma allowlist fechada de **mensagens constantes**, comparadas por igualdade exata e enumeradas do fonte instalado. Isso não contradiz a regra de segurança: o texto é **chave de consulta**, nunca sai no registro, e o resultado continua sendo uma das seis categorias. Nunca substring — uma reformulação de mensagem degrada para `unknown`, que a spec prevê, em vez de classificar errado em silêncio. O `net.connect` do Node também agrega tentativas por família de endereço num `AggregateError`, então a classificação percorre `cause` e `errors` além do erro raiz.

### Supressão de access log construída, não herdada

Com as probes dentro do router do Nest, o ruído passa a existir e precisa ser tratado — seriam até ~65 000 linhas/dia com o HPA em 5 réplicas. A supressão é feita por `customLogLevel → 'silent'` em `resolveAccessLogLevel`, e **nunca** por `autoLogging.ignore`, que é avaliado antes de a resposta existir e apagaria também as falhas. A correspondência é **exata** contra um conjunto fechado de caminhos exportado pelo mesmo módulo folha que o controller usa nos decorators — literal no decorator mais conjunto no logger seriam duas verdades, e o drift silenciaria uma rota diferente da exposta.

**Aritmética honesta:** o regime saudável custa zero linhas, e cada probe que falha custa uma — ≈**1800 linhas/hora** com 5 réplicas durante uma indisponibilidade do banco. Suprimir também a falha zeraria esse número e é exatamente o que a decisão recusa; o custo é aceito, não apresentado como ganho.

### Nenhuma abstração em `domain/` ou `application/`

Saúde é preocupação puramente operacional: sem port, sem use-case, sem Clean Controller, sem Presenter. Nada em `application/` jamais chamará um health check, e introduzir abstração onde não há regra de negócio produz cerimônia sem desacoplamento. *Uma exceção declarada, não um furo:* os **nomes lógicos** dos campos dos eventos de transição entram em `application/logging/log-field.ts`, porque é assim que o mecanismo de logging deste projeto funciona para todo atributo — `port`, `signal` e `mail*` já estão lá, e o `Record<LogicalFieldName, …>` existe justamente para que uma entrada faltante seja erro de compilação.

### Sem métrica nem span **dedicado** de saúde

A aplicação não publica indicador próprio do resultado das verificações: o estado da instância já é derivável do próprio Kubernetes, sem acoplar a aplicação — que é o objetivo declarado de neutralidade de fornecedor.

**Isso é distinto de "as rotas de saúde nunca aparecerão num trace".** Quando OpenTelemetry for adotado, a instrumentação HTTP é genérica e **vai** gerar spans de servidor nessas rotas, porque não conhece rotas. O que a change futura MUST decidir é a política de **volume e custo** — dezenas de milhares de spans por dia, sem valor de diagnóstico e cobrados pela plataforma de destino.

**E a advertência que importa:** uma ignore list **por rota** é avaliada no início do span, antes de o resultado existir, e apagaria também os traces das probes que **falham** — exatamente o erro que esta decisão rejeita no access log.

> **Correção (2026-09-05, ADR 0005).** A recomendação que este parágrafo dava a seguir — "as opções aceitáveis são amostrar apenas o sucesso ou preservar os erros" — **não é implementável** com o SDK JS, e a frase foi removida em vez de mantida como orientação errada. `shouldSample` decide no **início** do span, quando ainda não existe status nem `http.route`; e um `SpanProcessor` filtrando no `onEnd` lê o status final, mas só do span de **servidor** — os spans `pg` descendentes já foram exportados pelo `BatchSpanProcessor` e ficariam órfãos, mais volume do que não excluir nada. Preservar o trace da probe que falha só existe de verdade com `tail_sampling` num Collector.
>
> A advertência acima **permanece verdadeira**: a exclusão na entrada apaga também o trace da probe que falha, e essa perda é real. O [ADR 0005](0005-opentelemetry.md) a assume explicitamente, junto dos três registros que sobrevivem (linha de access log em `error`, evento `health.degraded` com a categoria da causa, e o estado da instância no Kubernetes).

## Alternativas consideradas

- **Um endpoint `/health` único servindo às duas decisões.** Inviável nos dois sentidos: com verificação de banco produz restart loop na frota; sem ela é inútil como readiness.
- **`startupProbe` apontando para `/ready`.** Rejeitado e perigoso: falha de startup mata o container, recriando a armadilha que a separação existe para evitar.
- **`@nestjs/terminus`.** Ver a tabela acima.
- **Corpo detalhado por indicator** (o padrão do Terminus). Numa rota pública, a mensagem de erro do driver nomeia host e porta.
- **Cache com TTL na verificação.** Rejeitado: resultado obsoleto é o que a readiness não pode devolver, e a fórmula que o justificava (`timeoutSeconds > TTL + p99`) não descrevia nada real — o TTL define validade, não tempo de espera.
- **`statement_timeout` / `query_timeout`.** Ver acima.
- **Endpoint `/api/health` detalhado e protegido por ADMIN.** `kubectl logs` e os eventos de transição já respondem à mesma pergunta, e ele adicionaria superfície autenticada para o ZAP escanear.
- **Uma variável `HEALTH_ENABLED`.** Anti-feature: endpoint de saúde desligável é endpoint em que o orquestrador não pode confiar.

## Consequências

**Positivas**

- As três probes passam a decidir a partir de sinais cuja falha o respectivo remédio consegue resolver.
- Um pod com o banco fora sobe, se reporta corretamente e se recupera sozinho — sem reinício.
- Desligar o Swagger em produção deixa de ser um evento de indisponibilidade.
- O rollout drena em vez de descartar requisições em voo, e a ordem de liberação de recursos está protegida por teste.
- O pool do `pg` deixa de ser ilimitado — endurecimento que vale para **todas** as consultas da aplicação.
- O custo de access log em regime saudável é zero, apesar de as probes atravessarem o logger.

**Negativas e aceitas**

- Durante uma indisponibilidade do banco, **todas** as réplicas saem do balanceamento e o Service fica sem endpoints. É a consequência direta de uma dependência compartilhada, e está documentada em `docs/api.md` e `docs/security.md` para não ser diagnosticada como defeito.
- O log **cresce** durante um incidente: ≈1800 linhas/hora com 5 réplicas, contra zero em regime saudável. Taxa nominal, não teto — o kubelet dispara readiness fora do ticker em transições de estado.
- `connectionTimeoutMillis` e `keepAlive` afetam **todas** as consultas, não só as de saúde. Ampliação deliberada de escopo, verificada pela suíte E2E completa, que exercita todos os repositórios contra PostgreSQL real.
- O prazo próprio da verificação é **constante em código**, não variável de ambiente (a decisão proíbe env nova para saúde): ajustá-lo exige rebuild da imagem e novo deploy, não edição de YAML.

**Interação com o [ADR 0002](0002-logging-estruturado.md)**

O destino de log é `pino.destination({ sync: true })`. Se o coletor parar de drenar, o `sonic-boom` entra em espera bloqueante e segura o laço de eventos — condição **compartilhada por toda a frota**, como o banco. Por isso o `timeoutSeconds` da liveness é generoso (5 s) e a sua tolerância total é mantida em 60 s: apertar ali converteria um soluço do coletor em restart loop geral, o mesmo modo de falha que esta decisão rejeita para o PostgreSQL.

## Referências

- [Kubernetes — Configure Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Kubernetes — Pod Lifecycle: Termination of Pods](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination)
- [NestJS — Lifecycle Events](https://docs.nestjs.com/fundamentals/lifecycle-events)
- [Prisma — Driver adapters](https://www.prisma.io/docs/orm/overview/databases/database-drivers)
- [`node-postgres` — Pooling](https://node-postgres.com/apis/pool)
- [ADR 0002 — Logging Estruturado em JSON com Nomenclatura OpenTelemetry](0002-logging-estruturado.md)
- [Kubernetes › Health probes](../infra/kubernetes.md#health-probes)
