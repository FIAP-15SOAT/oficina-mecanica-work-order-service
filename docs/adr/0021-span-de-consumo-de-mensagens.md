# ADR 0021: Span de consumo de mensagens

## Status

Aceito — 2026-10-25

Emenda o [ADR 0005](0005-opentelemetry.md) em dois pontos: a regra "nenhum span criado por código" ganha uma exceção, o span `CONSUMER` do consumidor de mensagens; e a lista explícita de instrumentações passa a incluir `aws-sdk` e `ioredis`.

## Contexto

O ADR 0005 proíbe instrumentação manual de trace: todo span vem do transporte (HTTP, Express, `pg`), e não existe porta `ITracer`, porque ela teria zero chamadores.

Com a mensageria do [ADR 0018](0018-mensageria-sns-sqs-fifo-com-outbox.md), o serviço passa a processar trabalho que não chega por HTTP. A instrumentação da AWS cria só o span do *receive* do SQS, que cobre o long polling e não o processamento de cada mensagem. Sem outro span, as consultas ao banco e as chamadas internas de um handler ficariam sem pai (e, com `requireParentSpan`, sem span algum), e o trace da requisição que gravou a mensagem pararia na publicação.

## Decisão

1. **O `SqsConsumerService` abre um span `CONSUMER` por mensagem**, chamado `process <fila>`, com `messaging.system`, `messaging.destination.name`, `messaging.operation.type` = `process` e `messaging.message.id`. O pai é o contexto W3C extraído dos atributos da mensagem, que a instrumentação do SNS injeta no `Publish` a partir do contexto que o relay restaura do outbox. Falha marca o span com `ERROR` e registra a exceção.
2. **É o único span manual permitido**, e ele mora na infraestrutura (`infrastructure/messaging/`), nunca em caso de uso. A regra do ADR 0005 continua valendo para todo o resto: zero `startSpan` em código de negócio e nenhuma porta `ITracer`. Um novo adaptador de entrada sem transporte instrumentado (outra fila, um agendador) precisa de nova ADR.
3. **Duas instrumentações entram na lista explícita**: `@opentelemetry/instrumentation-aws-sdk`, com `suppressInternalInstrumentation` (sem o span HTTP repetido em cada chamada AWS), e `@opentelemetry/instrumentation-ioredis`, com um `dbStatementSerializer` que grava só o nome do comando, porque os argumentos levam o detalhe da OS com dados pessoais do cliente.
4. **`pg` passa a `requireParentSpan: true`**: sem isso, o relay do outbox geraria um trace raiz de `pg` a cada 500 ms por réplica.
5. **O polling do consumidor roda com o tracing suprimido** (`suppressTracing` do `@opentelemetry/core` em volta do `start()` do `sqs-consumer`). Cada long poll vazio virava um trace raiz `ReceiveMessage` a cada 20 s por réplica, medido no Datadog depois do primeiro deploy. Receive e delete deixam de gerar span. O span `CONSUMER` continua, porque o pai dele vem do contexto extraído da mensagem, não do contexto do polling. O `Publish` do relay também continua, porque roda em outro contexto.

## Alternativas consideradas

| Alternativa | Trade-off | Rever se |
| --- | --- | --- |
| Nenhum span de consumo | Mantém a regra sem exceção, mas o processamento da mensagem não aparece no trace e não se liga ao produtor | — |
| Porta `ITracer` na aplicação, com o span aberto pelo handler | Cada handler controlaria o próprio span, mas a aplicação passaria a conhecer telemetria, e cada handler repetiria o mesmo código | Um handler precisar de spans internos próprios |
| Span só com *link* para o produtor, como raiz de um trace novo | Recomendação da convenção para lotes, mas aqui o consumo é uma mensagem por vez, e um pai direto deixa o fluxo inteiro num trace só | O consumo passar a ser em lote |
| Instrumentação de processamento do próprio `sqs-consumer` ou da AWS | Sem código nosso, mas nenhuma das duas cria o span de processamento por mensagem na versão usada | Uma delas passar a criar o span de processamento |
| Filtrar o `ReceiveMessage` vazio num sampler do preload | Preserva o span do receive que traz mensagem, mas o sampler decide no início do span, antes de saber se veio mensagem, e mexer no preload afeta todo o processo | O receive com mensagem passar a ser útil no trace |
| Instrumentação `ioredis` com o comando completo | Mais detalhe no span, levando ao trace os dados pessoais que o log não leva | — |

## Consequências

### Positivas

- Um trace segue da requisição que mudou o estado até o handler do outro serviço, passando pelo outbox, pelo tópico e pela fila.
- As consultas e chamadas internas de um handler ficam sob o span da mensagem.
- Nenhum span de cache leva dado pessoal.

### Negativas e limites

- O span manual é código nosso, sem cobertura da auto-instrumentação: os atributos e o pai são testados no unitário, e o trace real só no smoke manual, porque a auto-instrumentação não roda sob Jest.
- Consultas ao banco fora de requisição e de mensagem (como as do relay) deixam de gerar span.
- As chamadas do consumidor ao SQS (receive e delete) não têm span: latência e erro delas não aparecem no APM. A falha de receive continua no log, pelo evento de erro do consumidor.

## Referências

- [Observabilidade — Consumo de mensagens](../observability.md#consumo-de-mensagens)
- [ADR 0005 — OpenTelemetry](0005-opentelemetry.md)
- [OpenTelemetry — Semantic conventions for messaging spans](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/)
- [`@opentelemetry/instrumentation-aws-sdk`](https://www.npmjs.com/package/@opentelemetry/instrumentation-aws-sdk)
- [`@opentelemetry/instrumentation-ioredis`](https://www.npmjs.com/package/@opentelemetry/instrumentation-ioredis)
