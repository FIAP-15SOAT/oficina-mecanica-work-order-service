# ADR 0025: Sagas orquestradas no work-order

## Status

Aceito — 2026-11-13

Emenda o [ADR 0011](0011-unit-of-work-transacoes-multi-repositorio.md): a Unit of Work continua sendo a transação de cada passo, com o outbox na mesma transação; o que deixa de valer é o motivo pelo qual o ADR 0011 descartou o padrão Saga, o de o sistema ser um monólito com um banco só. Reúne as Sagas dos ADRs [0023](0023-catalogo-e-estoque-no-inventory-com-reserva-pela-saga.md) (aprovação) e [0024](0024-saga-de-abertura-com-orcamento-inicial-no-billing.md) (abertura) e acrescenta a de cobrança.

## Contexto

A solução foi dividida em serviços, cada um dono do próprio banco: o work-order guarda as ordens de serviço (OS), o Billing guarda orçamentos e pagamentos, e o Inventory guarda o catálogo de serviços e peças e o estoque. Nenhum serviço lê o banco de outro, e eles se falam por chamadas REST internas (`/internal/...`) e por mensagens num tópico SNS FIFO, entregues a cada serviço pela própria fila SQS FIFO, com as mensagens gravadas num outbox na mesma transação da mudança de estado ([ADR 0018](0018-mensageria-sns-sqs-fifo-com-outbox.md)).

Três fluxos do ciclo da OS gravam em dois serviços, e em cada um um passo pode falhar depois de o outro serviço já ter gravado:

| Fluxo | Quem grava | O que pode falhar depois |
|---|---|---|
| Abertura da OS com itens | Billing (orçamento inicial), depois o work-order (OS) | A gravação da OS |
| Aprovação do orçamento | Billing (orçamento aprovado), depois o Inventory (reserva) e o work-order (OS `APPROVED`) | A reserva, por falta de estoque, ou a OS, cancelada no intervalo |
| Cobrança | Billing (cobrança e ordem no Mercado Pago, o provedor de pagamento), depois o work-order (OS bloqueada em `AWAITING_PAYMENT`) | O bloqueio, porque a OS mudou de status no intervalo (o mecânico iniciou a execução); ou o pagamento, que expira, é recusado ou cancelado |

Nenhuma transação cobre dois bancos. Uma **Saga** resolve esse tipo de escrita: uma sequência de transações locais, cada uma num serviço, ligadas por chamadas ou mensagens, em que a falha de um passo dispara um passo de **compensação** que desfaz o que os anteriores gravaram. O critério para ter uma Saga é esse: um passo que pode falhar depois de outro serviço gravar, e esse outro serviço precisa desfazer o que gravou. Os demais fluxos não o cumprem: o envio e a rejeição do orçamento só propagam um fato que o Billing já decidiu, a baixa do estoque no início da execução é um passo de repetir (nova entrega, DLQ e redrive), e não de desfazer, e a entrega só lê o saldo no Billing.

A pergunta era quem coordena as Sagas, onde fica o estado delas e quantas são.

## Decisão

### 1. Três Sagas, orquestradas pelo work-order

O work-order orquestra as três Sagas: decide cada passo e cada compensação num lugar só, e os outros serviços só recebem comandos e respondem com eventos, sem conhecer a Saga.

- **Abertura** (síncrona, dentro da requisição): o orçamento inicial é criado no Billing antes de a OS ser gravada, e é apagado se a gravação falhar ([ADR 0024](0024-saga-de-abertura-com-orcamento-inicial-no-billing.md)).
- **Aprovação**: começa com `billing.quote.approved`, pede a reserva ao Inventory e, se ela falhar ou a OS não aguardar mais aprovação, pede ao Billing que desfaça a aprovação ([ADR 0023](0023-catalogo-e-estoque-no-inventory-com-reserva-pela-saga.md) e [Arquitetura › Aprovação de orçamento com reserva de estoque](../architecture.md#aprovação-de-orçamento-com-reserva-de-estoque)).
- **Cobrança**: começa com `billing.payment.requested`, bloqueia a OS em `AWAITING_PAYMENT` guardando o status de origem (`APPROVED` ou `COMPLETED`) e a devolve à origem quando a cobrança é paga (`billing.payment.approved`) ou não (`billing.payment.failed`). Se a OS já não pode ser cobrada, pede ao Billing o cancelamento da cobrança (`billing.payment.cancel`) ([Arquitetura › Saga de cobrança](../architecture.md#saga-de-cobrança)).

O orquestrador é um conjunto de casos de uso da camada de aplicação do work-order (`application/use-cases/quote-approval/` e `application/use-cases/payment/`), um por mensagem, porque o estado da Saga muda na mesma transação da OS e do outbox.

### 2. Estado em `saga_instances`, na transação de cada passo

As Sagas de aprovação e de cobrança esperam a resposta de outro serviço por segundos, às vezes em outra réplica ou depois de um reinício, então o estado delas fica numa linha de `saga_instances`: o tipo (`QUOTE_APPROVAL` ou `PAYMENT`), a OS, o `correlation_id` (o id do orçamento ou da cobrança no Billing, único junto com o tipo), o status, o motivo da compensação e, na cobrança, o status de origem da OS (`origin_status`). Cada passo é uma transação da Unit of Work do ADR 0011 que grava a Saga e, conforme o passo, a OS com a `version`, o histórico e o comando no outbox. A Saga de abertura não tem linha: começa e termina dentro de uma requisição.

A chave única `(type, correlation_id)` faz das mensagens repetidas, que o SQS entrega pelo menos uma vez, um passo sem efeito: o caso de uso encontra a Saga num status que não espera aquela mensagem, registra `saga.step_skipped` e confirma.

### 3. Sem prazo por passo

Nenhuma Saga tem prazo próprio, reenvio de comando nem evento `*_failed` por tempo esgotado. Uma falha técnica (participante fora do ar, banco indisponível) deixa a mensagem na fila, que a entrega de novo e, na quinta vez, a move para a DLQ (fila de mensagens que falharam), de onde volta por redrive; a Saga retoma do estado guardado. O único prazo de negócio, a validade do link de pagamento, é do Billing, que publica `billing.payment.failed` com `EXPIRED`.

### 4. Sinais de um ponto só

As duas Sagas com estado emitem os mesmos eventos de log (`saga.started`, `saga.compensation.started`, `saga.completed`, `saga.compensated` e `saga.step_skipped`) e as mesmas métricas (`oficina.saga.started`, `oficina.saga.finished` e `oficina.saga.duration`) por uma função só, depois do commit, com o tipo da Saga como atributo ([Observabilidade › Sinais das Sagas](../observability.md#sinais-das-sagas)).

## Alternativas consideradas

### Coreografia, sem orquestrador

Cada serviço reagiria aos eventos dos outros e decidiria sozinho quando compensar. Descartada porque a lógica de cada Saga ficaria espalhada pelos handlers de três serviços, cada serviço passaria a depender dos eventos dos outros (com risco de ciclo entre Billing e Inventory), a ordem das compensações ficaria difícil de garantir, e o estado de uma Saga só poderia ser reconstruído juntando eventos. Com o orquestrador, cada Saga é uma tabela de transições num lugar só, e o estado é uma consulta a `saga_instances`.

### Orquestrador num serviço próprio

Um serviço só para coordenar as Sagas. Descartada porque o estado da Saga precisa mudar na mesma transação da OS e do outbox: num serviço separado, o work-order viraria mais um participante, e cada passo que hoje é uma transação local passaria a ser uma troca de mensagens com compensação própria.

### AWS Step Functions

O serviço de orquestração de fluxos da AWS guardaria o estado e conduziria os passos. Descartada porque exige uma role de execução do IAM que a conta AWS usada pela solução não permite criar, e porque a transição da Saga deixaria de estar na mesma transação da OS.

### Temporal

Um motor de workflows duráveis, com histórico de cada execução. Descartada porque pede vários componentes próprios (servidor, workers, banco de persistência) para um cluster de dois nós, e porque a Saga sairia da transação da OS do mesmo jeito.

### Uma Saga só para o ciclo inteiro da OS

Uma Saga da abertura à entrega. Descartada porque faria do status da OS uma máquina de estados de orquestração, com mensagem e espera em todos os passos, inclusive nos que hoje são cliques síncronos (diagnóstico, início e conclusão dos serviços, entrega), sem nada a desfazer em outro serviço na maioria deles.

### Prazos por passo, com reenvio de comando

Cada passo teria um prazo, e o orquestrador reenviaria o comando ou compensaria quando ele vencesse. Descartada porque não há regra de negócio sobre prazo nesses passos, e a fila, a DLQ e o redrive já tratam a falha técnica; prazos exigiriam um agendador, eventos de prazo vencido e o tratamento da resposta que chega depois do prazo.

### Origem da cobrança num `jsonb` genérico de dados da Saga

Uma coluna de dados livres na Saga, no lugar de `origin_status`. Descartada porque seria tipagem fraca para um único campo, que o banco não conferiria contra o enum de status da OS.

### Status novos para a volta da cobrança

`AWAITING_DELIVERY` depois da cobrança final paga e `AWAITING_EXECUTION` depois do sinal pago, no lugar da volta a `COMPLETED` e a `APPROVED`. Descartada porque a volta à origem continuaria existindo nas cobranças não pagas e no pagamento parcial, o status passaria a copiar o saldo, que é do Billing, e a fila do mecânico teria dois status para a mesma situação; o histórico já identifica cada cobrança e o desfecho nas notas.

## Consequências

### Positivas

- Cada Saga é uma tabela de transições num lugar só, testada por casos de uso com repositórios simulados, por e2e com o LocalStack e por cenários BDD em pt-BR.
- O estado de qualquer Saga é uma consulta a `saga_instances`, e cada passo aparece nos logs com `oficina.saga.id`.
- A transição da Saga, a mudança na OS e o comando ao outro serviço são gravados juntos, então nenhum comando sai sem o estado que o explica.
- Mensagens repetidas não têm efeito, pela chave única da Saga.

### Negativas / Trade-offs

- O work-order conhece os comandos e eventos dos outros serviços (`billing.quote.*`, `billing.payment.*`, `inventory.stock.*`): um passo novo num participante muda também o work-order.
- Sem prazo por passo, uma Saga cujo participante nunca responde fica parada até a DLQ e o redrive; na cobrança, uma OS sem o aviso do Mercado Pago fica em `AWAITING_PAYMENT` até o funcionário cancelar a cobrança no Billing.
- A duração de uma Saga reaberta (a reaprovação depois da falta de estoque) conta desde a criação da linha, não desde a reabertura.

### Riscos mitigados

- Cobrança pendente com a OS já em execução: o work-order pede o cancelamento, e o cliente não recebe o link.
- Orçamento aprovado numa OS que não pode ser executada: a aprovação é desfeita no Billing.
- Ordem das mensagens de uma OS: cada passo grava a OS com a `version` antes de gravar o comando no outbox, então a ordem das mensagens segue a dos commits.

### Revisar se

- Surgir outro fluxo que grave em dois serviços com um passo a desfazer (aí, uma Saga nova no mesmo molde, ou a revisão deste critério).
- Aparecer um prazo de negócio num passo (aí, prazos por passo, com agendador).
- Uma Saga reaberta distorcer a métrica de duração (aí, guardar o instante da reabertura).
- O volume de Sagas exigir orquestração fora do work-order (aí, rever o orquestrador num serviço próprio).

## Referências

- [ADR 0011 — Unit of Work para transações multi-repositório](0011-unit-of-work-transacoes-multi-repositorio.md)
- [ADR 0018 — Mensageria SNS/SQS FIFO com outbox transacional](0018-mensageria-sns-sqs-fifo-com-outbox.md)
- [ADR 0023 — Catálogo e estoque no Inventory, com reserva pela Saga de aprovação](0023-catalogo-e-estoque-no-inventory-com-reserva-pela-saga.md)
- [ADR 0024 — Saga de abertura com orçamento inicial no Billing](0024-saga-de-abertura-com-orcamento-inicial-no-billing.md)
- [`docs/architecture.md` › Saga de cobrança](../architecture.md#saga-de-cobrança)
- [`docs/database.md` › Sagas](../database.md#sagas)
- [`docs/testing.md` › Cenários de falha F1 a F14](../testing.md#cenários-de-falha-f1-a-f14)
