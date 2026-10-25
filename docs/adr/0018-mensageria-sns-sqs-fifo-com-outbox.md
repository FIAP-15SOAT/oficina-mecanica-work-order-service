# ADR 0018: Mensageria SNS/SQS FIFO com outbox transacional

## Status

Aceito — 2026-10-25

Supera o [ADR 0007](0007-padrao-de-comunicacao-rest-monolito.md) na parte "sem barramento de eventos": a comunicação entre serviços passa a ter um caminho assíncrono, descrito aqui, e um síncrono, no [ADR 0020](0020-chamadas-internas-e-rotas-negadas-por-padrao.md).

## Contexto

A oficina passa a ser dividida em serviços (Work Order, Identity, Billing e Inventory), cada um dono do próprio PostgreSQL. Fluxos que hoje são uma transação só, como aprovar um orçamento e reservar o estoque, passam a cruzar a fronteira de serviço. O serviço precisa avisar os outros de uma mudança de estado sem perder o aviso e sem avisar de uma mudança que não aconteceu.

O broker escolhido é o da própria AWS, já usada pela solução: Amazon SNS e SQS. O SNS não participa da transação do PostgreSQL. Gravar o estado e publicar em seguida é uma **dupla escrita**: se o processo cair entre as duas, ou a mensagem se perde (estado gravado, nada publicado) ou o aviso sai de algo que foi desfeito (publicado, transação desfeita).

As mensagens de uma mesma ordem de serviço precisam chegar em ordem: um `inventory.stock.reserved` processado antes do pedido de reserva que o originou leva a OS a um estado inválido.

## Decisão

**Outbox transacional no PostgreSQL do serviço, relay no próprio processo, um tópico SNS FIFO e uma fila SQS FIFO por consumidor.**

1. **A mensagem é uma linha da tabela `outbox`**, gravada pelo `IOutboxRepository` dentro da mesma transação do Unit of Work que muda o estado. Ou as duas escritas são confirmadas, ou nenhuma. O tipo e o payload vêm de um catálogo tipado e fechado em `domain/messaging/`: tipo desconhecido não compila.
2. **O relay roda no processo** (`OutboxRelayService`), a cada 500 ms. Cada lote abre uma transação, toma `pg_try_advisory_xact_lock` (só uma réplica publica; as outras pulam a rodada), lê até 10 linhas por `id` sequencial, publica uma a uma por `PublishCommand` e apaga as publicadas na mesma transação. Na primeira falha, o lote para, para não furar a ordem. Cada `Publish` tem prazo de 2 s, sem retentativa do SDK, e nenhuma publicação começa depois de 2 s de lote, para que as exclusões confirmem dentro dos 5 s da transação.
3. **Um tópico FIFO para toda a solução** (`oficina-events.fifo`) e **uma fila FIFO por serviço consumidor**, com filter policy por atributo `type`. O `MessageGroupId` é o `workOrderId` (ordem por OS) e o `MessageDeduplicationId` é o `messageId`.
4. **O envelope tem cinco campos**: `messageId`, `type`, `occurredAt`, `workOrderId` e `payload`. Correlação e causalidade vêm do contexto W3C nos atributos da mensagem, gravado na linha do outbox.
5. **O consumidor confirma só no sucesso.** O `SqsConsumerService` usa `sqs-consumer`, uma mensagem por vez. Erro, envelope inválido ou tipo sem handler deixam a mensagem na fila; na quinta entrega, o SQS a move para a DLQ. Os handlers são idempotentes pelo `messageId` ou pelo estado.

## Alternativas consideradas

| Alternativa | Trade-off | Rever se |
| --- | --- | --- |
| Publicar no SNS dentro da transação, ou logo depois do commit com retry em memória | Menos código, mas é a dupla escrita: queda do processo entre o commit e a publicação perde a mensagem, e publicar antes do commit avisa de estado desfeito | — |
| Outbox no DynamoDB | Tira a tabela do PostgreSQL, mas não tem transação em comum com o dado de negócio, que é exatamente o que o outbox existe para dar | O dado de negócio ir para o DynamoDB (aí, DynamoDB Streams) |
| Marcar `published_at` e limpar depois | Guarda histórico, mas exige coluna, job de limpeza e cuidado especial com payload sensível que fica no banco | — |
| Vários relays com `FOR UPDATE SKIP LOCKED` | Publica em paralelo, mas réplicas diferentes publicariam mensagens do mesmo grupo fora de ordem e furariam a FIFO | O volume exigir publicação em paralelo |
| Relay como processo ou Job separado | Isola a carga, mas soma um deployment, credenciais e um ponto de falha para um volume que cabe no processo | A carga do relay competir com as requisições |
| `PublishBatch` | Menos chamadas, mas a instrumentação do OpenTelemetry só injeta o contexto de trace no `Publish` | A instrumentação passar a cobrir o lote |
| Lote maior que 10 linhas | Esvazia um acúmulo mais rápido, mas um lote longo estoura os 5 s da transação interativa do Prisma, desfaz as exclusões e republica o mesmo início para sempre | O timeout da transação mudar |
| Tabela `inbox` com os ids processados | Deduplicação genérica, mas handlers idempotentes por chave de negócio ou estado já cobrem, e a FIFO deduplica por 5 min | Um handler não conseguir ser idempotente |
| Um tópico por serviço e filas de comando separadas | Isola os produtores, mas dobra o número de filas e de caminhos de publicação | — |
| Filas standard com versão do agregado | Mais vazão, mas a ordem por OS passaria a exigir checagem de versão em todo handler | A vazão da FIFO limitar |
| Envelope com `kind`, `source`, `correlationId`, `causationId`, `sagaId` e sufixo de versão | Mais metadado explícito, redundante com o tipo, o `workOrderId` e o trace | — |
| `handleMessageBatch` em sequência | Lotes de recebimento maiores, mais código no adaptador; o `handleMessage` com lote maior processaria em paralelo e furaria a FIFO | A vazão do consumo limitar |
| Confirmar mensagem sem handler | Fila sem retentativas inúteis, mas um tipo novo publicado antes do consumidor estar pronto se perderia em silêncio; a DLQ o guarda para redrive | — |

## Consequências

### Positivas

- Nenhuma mudança de estado fica sem aviso, e nenhum aviso sai de estado desfeito.
- Ordem por OS sem código de versão nos handlers.
- O trace segue da requisição que gravou a mensagem até o handler do outro serviço.
- A tabela `outbox` tem o mesmo schema em todos os serviços; o kit (repositório, relay, consumidor e catálogo) é copiado do Work Order.

### Negativas e limites

- Latência de até ~500 ms entre o commit e a publicação, mais o long polling do consumidor.
- Uma falha persistente na publicação segura todas as mensagens do serviço, porque o relay para no primeiro erro. Cada falha registra `messaging.outbox.publish_failed`, que precisa de monitor.
- O SQS entrega pelo menos uma vez: todo handler precisa ser idempotente.
- O relay consulta o banco a cada 500 ms por réplica, mesmo sem mensagens.
- Uma mensagem com falha segura as seguintes do mesmo grupo até ir para a DLQ (cinco entregas com visibility timeout de 30 s).

## Referências

- [Arquitetura — Mensageria, cache e chamadas internas](../architecture.md#mensageria-cache-e-chamadas-internas)
- [Testes — Mensageria e cache no E2E](../testing.md#mensageria-e-cache-no-e2e)
- [ADR 0011 — Unit of Work](0011-unit-of-work-transacoes-multi-repositorio.md)
- [AWS — Amazon SNS FIFO topics](https://docs.aws.amazon.com/sns/latest/dg/sns-fifo-topics.html)
- [AWS — Amazon SQS FIFO queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues.html)
- [PostgreSQL — Advisory locks](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS)
- [Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html)
