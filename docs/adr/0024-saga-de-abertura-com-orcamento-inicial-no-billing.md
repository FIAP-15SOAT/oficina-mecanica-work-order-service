# ADR 0024: Saga de abertura com orçamento inicial no Billing

## Status

Aceito — 2026-11-11

Complementa o [ADR 0023](0023-catalogo-e-estoque-no-inventory-com-reserva-pela-saga.md): a Saga de aprovação descrita lá passa a começar no Billing, e a compensação dela deixa de ser local. Usa as chamadas internas do [ADR 0020](0020-chamadas-internas-e-rotas-negadas-por-padrao.md).

## Contexto

Os orçamentos passaram a ter um dono só, o Billing, o serviço da solução que guarda orçamentos e pagamentos no próprio banco. O work-order continua dono das ordens de serviço (OS) e não lê o banco de outro serviço. Antes, a abertura de uma OS com itens (`POST /api/work-orders` com `services` ou `partsSupplies`) validava e precificava os itens no Inventory e gravava a OS e o orçamento inicial numa transação só, no banco do work-order. Com o orçamento em outro serviço, a abertura grava em dois bancos, e nenhuma transação cobre os dois.

Uma **Saga** resolve esse tipo de escrita: uma sequência de transações locais, cada uma num serviço, em que a falha de um passo dispara um passo de **compensação** que desfaz o que os anteriores gravaram. A pergunta era em que ordem gravar, como compensar e se a Saga precisa de estado guardado.

A mesma mudança de dono alterou a Saga de aprovação do ADR 0023: a aprovação agora é gravada no Billing, que publica `billing.quote.approved`; o work-order começa a Saga ao receber essa mensagem, e, quando falta estoque ou a OS já não aguarda aprovação, pede ao Billing que desfaça a aprovação (`billing.quote.revert_approval`) e espera a confirmação (`billing.quote.approval_reverted`) no estado novo `COMPENSATING`. O fluxo completo está em [Arquitetura › Aprovação de orçamento com reserva de estoque](../architecture.md#aprovação-de-orçamento-com-reserva-de-estoque); este ADR registra a decisão da abertura.

## Decisão

### 1. Orçamento no Billing primeiro, OS depois, com exclusão de compensação

O `CreateWorkOrderUseCase`:

1. valida cliente, veículo e mecânico no próprio banco e gera o id da OS (UUID), fora de transação;
2. sempre que a requisição traz algum item, cria o orçamento inicial no Billing (`POST /internal/quotes`, com o id da OS e os itens), com prazo de 5 s, porque o Billing lê o catálogo no Inventory antes de responder;
3. só então abre a transação que aloca o número da OS (da sequence `work_order_number_seq`) e grava a OS e o histórico;
4. se a transação falhar, apaga o orçamento (`DELETE /internal/quotes/:id`; um `404` conta como já apagado) e relança o erro da gravação. Se a exclusão também falhar, registra o orçamento sem OS no evento de log `work_order.opening.compensation_failed` e segue com o erro original.

A falha mais comum, um item inválido, é recusada pelo Billing no passo 2: nada é gravado e nenhum número de OS é consumido, como acontecia antes. Billing ou Inventory fora do ar respondem 503 sem OS gravada. Se o Billing chegar a gravar o orçamento e responder depois do prazo de 5 s, o work-order também responde 503, mas o orçamento fica no Billing sem OS (seção 2).

### 2. Sem estado persistido

A Saga de abertura começa e termina numa requisição e não grava linha em `saga_instances`. Sobra um orçamento `PENDING` sem OS, chamado de órfão, em três casos:

- o processo cai entre o passo 2 e o 3;
- o Billing grava o orçamento e responde depois do prazo de 5 s: o work-order não recebe o id do orçamento e não tem o que apagar;
- a exclusão de compensação falha (evento `work_order.opening.compensation_failed`).

O órfão não aparece para o cliente nem nas leituras de orçamento por OS. Na listagem de orçamentos dos funcionários no Billing (`GET /api/quotes`), que busca no work-order a OS de cada orçamento da página, ele aparece com `workOrder: null`, porque o work-order responde 404 para aquela OS, e o Billing registra o evento de log `quote.work_order_missing` (`warn`). Esse evento é o único sinal do órfão deixado pelo prazo esgotado.

### 3. Os itens são validados só pelo Billing

O work-order deixa de validar e precificar os itens: duplicados, peças sem serviço e itens que o Inventory não conhece são recusados pelo Billing, e o `4xx` dele volta ao chamador com o mesmo status e a mesma mensagem. Peças sem serviço também vão ao Billing, que responde 409, para que a regra fique num lugar só.

## Alternativas consideradas

### Gravar a OS primeiro e apagá-la se o Billing recusar

Gravar a OS e depois criar o orçamento, apagando a OS na falha. Descartada porque o erro mais comum, um item inválido, criaria e apagaria uma OS a cada tentativa, consumindo um número da sequence (que não volta atrás) e deixando um buraco na numeração, e porque a OS existiria por um instante sem o orçamento, visível para quem a listasse.

### Orçamento inicial por evento

Gravar a OS com um evento no outbox e deixar o Billing criar o orçamento ao recebê-lo. Descartada porque o atendente receberia `201` antes de saber se os itens são válidos: um item inválido viraria uma OS sem orçamento e uma recusa que ninguém vê, e a compensação teria de apagar uma OS já devolvida ao chamador.

### Linha em `saga_instances` para a abertura

Guardar o estado da abertura para retomá-la depois de uma queda do processo. Descartada porque a Saga dura uma requisição e o estado guardado não cobriria o órfão mais provável, o do orçamento que o Billing grava e confirma depois do prazo, cujo id o work-order nunca recebe; além disso, uma tabela de estado traria um job de limpeza e um caso a mais em cada leitura.

### Repetir a criação do orçamento quando o Billing não responde

Tentar de novo o `POST /internal/quotes` em vez de responder 503. Descartada porque o cliente interno não faz retentativa por regra (uma retentativa automática numa cadeia de dois saltos multiplica a espera), e a nova tentativa do atendente gera outra OS, com outro id, então não há duplicação a evitar.

### Apagar o orçamento pelo id da OS quando o Billing não responde a tempo

O work-order gera o id da OS antes de chamar o Billing, então uma exclusão no Billing por esse id cobriria também o órfão do prazo esgotado, cujo id de orçamento o work-order não recebe. Descartada porque muda o contrato interno do Billing e acrescenta à abertura um passo de compensação que também pode falhar, para um caso raro cujo efeito é uma linha com `workOrder: null` na listagem dos funcionários.

### Continuar validando os itens no work-order antes de chamar o Billing

Manter a validação e a precificação no Inventory pelo work-order e mandar ao Billing itens já conferidos. Descartada porque o Billing valida de novo de qualquer forma, já que também cria orçamentos pela rota própria, e duas validações da mesma regra em dois serviços divergiriam com o tempo.

## Consequências

### Positivas

- O orçamento tem um dono só, e a regra dos itens fica num lugar só.
- Item inválido continua sem criar nada e sem consumir número de OS.
- A abertura não guarda estado novo nem precisa de job de limpeza.

### Negativas / Trade-offs

- A abertura com itens depende do Billing e do Inventory no ar: com qualquer um fora, responde 503, onde antes dependia só do Inventory.
- A abertura ficou mais lenta: uma chamada de dois saltos (work-order → Billing → Inventory) antes da transação.
- A compensação é de melhor esforço: se a exclusão falhar, o orçamento órfão fica no Billing, registrado só no log; se o Billing responder depois do prazo, o órfão fica sem nenhum registro no work-order.
- O órfão aparece na listagem de orçamentos dos funcionários no Billing com `workOrder: null`, e os funcionários não têm rota para apagá-lo.

### Riscos mitigados

- A transação da OS nunca espera a rede: a chamada ao Billing termina antes de ela abrir.
- O órfão não chega ao cliente nem às leituras de orçamento por OS.

### Revisar se

- O evento `quote.work_order_missing` aparecer com frequência (aí a abertura ganharia uma exclusão do orçamento pelo id da OS no Billing, que cobriria também a resposta fora do prazo).
- O Billing deixar de ler o Inventory na criação do orçamento (aí o prazo de 5 s pode voltar aos 2 s padrão).
- A abertura passar a gravar em um terceiro serviço.

## Referências

- [ADR 0020 — Chamadas internas pela rede do cluster e rotas públicas negadas por padrão](0020-chamadas-internas-e-rotas-negadas-por-padrao.md)
- [ADR 0023 — Catálogo e estoque no Inventory, com reserva pela Saga de aprovação](0023-catalogo-e-estoque-no-inventory-com-reserva-pela-saga.md)
- [`docs/architecture.md` › Saga de abertura](../architecture.md#saga-de-abertura)
- [`docs/architecture.md` › Fluxo do orçamento, do envio à aprovação](../architecture.md#fluxo-do-orçamento-do-envio-à-aprovação)
- [`docs/api.md` › Abertura da OS com orçamento inicial](../api.md#abertura-da-os-com-orçamento-inicial)
- [`oficina-mecanica-billing-service`](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service)
