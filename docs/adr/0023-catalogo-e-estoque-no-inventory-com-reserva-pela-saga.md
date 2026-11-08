# ADR 0023: Catálogo e estoque no Inventory, com reserva pela Saga de aprovação

## Status

Aceito — 2026-11-08

Complementa o [ADR 0018](0018-mensageria-sns-sqs-fifo-com-outbox.md) (mensagens pelo outbox) e o [ADR 0020](0020-chamadas-internas-e-rotas-negadas-por-padrao.md) (chamadas internas): aqui estão o primeiro gateway de leitura e a primeira Saga do work-order.

## Contexto

O catálogo de serviços e peças e o estoque passaram a ter um dono só, o Inventory, o serviço da solução que guarda serviços, peças, saldos, reservas e movimentações no próprio banco. Nenhum serviço lê o banco de outro. O work-order continua dono das ordens de serviço (OS) e dos orçamentos, e os itens deles referenciam serviços e peças do Inventory. Duas perguntas precisavam de resposta:

1. **Como o work-order valida, precifica e mostra os itens** sem ter o catálogo no próprio banco.
2. **Como a aprovação de um orçamento reserva o estoque.** Antes, a aprovação reservava as peças, materializava os itens na OS e levava a OS a `APPROVED` numa transação só, e a falta de estoque respondia 409 e desfazia tudo. Com o estoque em outro serviço, a reserva é um passo remoto que pode falhar depois de o work-order já ter gravado a aprovação, e não há transação que cubra os dois bancos.

## Decisão

### 1. Catálogo lido no Inventory por um gateway

O work-order lê o catálogo por uma porta de saída, `IInventoryCatalogGateway` (`application/ports/output/gateways/inventory/`), implementada pelo `HttpInventoryCatalogGateway` (`infrastructure/gateways/inventory/`) sobre o cliente HTTP interno. O gateway busca cada item por `GET /internal/services/:id` e `GET /internal/parts-supplies/:id` do Inventory, em paralelo; trata o `404` como item ausente e qualquer outra falha como `503`. O endereço vem de `INVENTORY_SERVICE_URL`.

- **Validação e preço** — o `QuoteItemValidator` (abertura de OS com itens e criação de orçamento) e a inclusão de item no orçamento leem o item no Inventory **antes** de abrir a transação. Nenhuma chamada HTTP fica dentro de uma transação, que seguraria a conexão do banco pelo tempo da rede.
- **Itens gravados** — o item de OS e de orçamento guarda só o id do serviço ou da peça, a quantidade e o preço, sem chave estrangeira para o catálogo.
- **Dados de exibição** — nome, descrição, SKU, número de peça, categoria e unidade são lidos no Inventory a cada resposta que mostra itens, pelo Clean Controller, e entregues ao presenter. Não vão ao cache do detalhe da OS. Um item que o Inventory não acha mais aparece com id, quantidade e preço e os campos de exibição nulos. Nas rotas que gravam e mostram itens (mudança de status, execução de serviço e decisão do cliente), a leitura acontece antes da gravação, para que o Inventory fora do ar responda 503 sem nada gravado.
- **Métricas por serviço** — continuam no work-order, dono dos itens executados, calculadas sobre os itens de OS concluídos, com o nome do serviço lido no Inventory.
- O work-order perde as rotas, as entidades e os repositórios de catálogo e de estoque. As tabelas antigas ficam no schema sem uso até uma migration seguinte, para que o deploy anterior continue funcionando se este for desfeito.

### 2. Reserva pela Saga de aprovação

Uma **Saga** é uma sequência de transações locais, cada uma no banco do seu serviço, ligadas por mensagens; quando um passo falha, um passo de **compensação** desfaz o que os anteriores gravaram. O work-order **orquestra** a Saga de aprovação: é ele quem decide o próximo passo a cada resposta, e o estado fica na tabela `saga_instances` (tipo `QUOTE_APPROVAL`, id do orçamento, OS, status e motivo da falha).

1. **Aprovação** (`ApproveQuoteUseCase`) — numa transação: orçamento `APPROVED` com o autor em `decided_by`; os demais orçamentos `PENDING` e `SENT` da OS em `REJECTED`, com `replaced_by_quote_id` apontando o aprovado; Saga em `RESERVING_STOCK`; comando `inventory.stock.reserve` no outbox, com as peças e quantidades. A requisição responde 200 e a OS continua `AWAITING_APPROVAL`. Sem peças, a OS vai a `APPROVED` na mesma transação e a Saga nasce `COMPLETED`.
2. **Reserva confirmada** (`inventory.stock.reserved`) — a OS vai a `APPROVED` com os itens e o histórico com o autor lido de `decided_by`; Saga `COMPLETED`.
3. **Falta de estoque** (`inventory.stock.reservation_failed`) — compensação: o orçamento volta a `SENT`; os rejeitados por ele voltam ao status anterior, lido de `sent_at` (`SENT` se foram enviados, `PENDING` se não); o histórico da OS ganha a entrada `Aprovação do orçamento <id> desfeita por falta de estoque`; Saga `COMPENSATED`. Depois do commit, o cliente recebe um e-mail.

Durante a reserva, criar ou enviar orçamento e cancelar a OS respondem 409. Um orçamento compensado pode ser aprovado de novo, quando o estoque for reposto: a mesma linha da Saga volta a `RESERVING_STOCK`. A baixa do estoque reservado é pedida pelo comando `inventory.stock.consume` quando o primeiro serviço da OS começa.

A orquestração mora em `application/use-cases/quote-approval/`, como os demais casos de uso, com as portas em `application/ports/input/quote-approval/`; os handlers das duas respostas são registrados pelo `QuoteApprovalMessageHandlers`.

## Alternativas consideradas

### Aprovação local seguida de reserva síncrona no Inventory

Aprovar no work-order e chamar o Inventory por HTTP para reservar. Descartada porque o passo remoto pode falhar depois de o work-order gravar, e sem compensação a OS ficaria aprovada sem estoque; com a chamada dentro da transação, a conexão do banco ficaria presa pelo tempo da rede, e um timeout não diria se a reserva aconteceu.

### Tabela `saga_steps` e prazo por passo

Registrar cada passo da Saga numa tabela própria e expirar passos parados. Descartada porque a Saga tem um passo remoto só, e o status da linha em `saga_instances` já diz onde ela está; a mensagem que não é processada vai, depois de cinco entregas, para a fila de mensagens mortas (DLQ), de onde volta por redrive.

### Coluna `previous_status` em `quotes`

Guardar o status anterior do orçamento rejeitado pela aprovação. Descartada porque repete o que `sent_at` já diz: só o envio grava `sent_at`, e nenhum orçamento volta a `PENDING` depois de enviado.

### Pasta própria `application/sagas/quote-approval/`

Separar a orquestração dos casos de uso. Descartada porque os três passos são casos de uso como os demais (porta de entrada, composição pelo módulo), e uma segunda pasta fugiria do padrão `use-cases/<domínio>/` que o serviço e as skills de geração seguem.

### Coluna `version` em `saga_instances`

Concorrência otimista na própria Saga. Descartada porque toda escrita na Saga vai numa transação que já grava com versão a OS (aprovação e conclusão) ou os orçamentos (compensação), e a fila FIFO entrega as respostas em ordem por OS: a coluna seria código de versão sem efeito.

### `userId` no comando de reserva, devolvido pelo Inventory

Levar o autor da aprovação no comando e recebê-lo de volta na resposta, em vez de gravar `decided_by`. Descartada porque muda o contrato `inventory.stock.*`, já implementado no Inventory, para carregar um dado que não é dele.

### Histórico da conclusão sem autor

Gravar a transição para `APPROVED` sem o usuário. Descartada porque `GET /api/work-orders/:id/status-history` deixaria de mostrar quem aprovou, como mostrava antes.

### Repositórios de catálogo com adaptadores HTTP

Manter `IServiceRepository` e `IPartSupplyRepository` no domínio, implementados por HTTP. Descartada porque dependência de outro serviço é um gateway da aplicação, não um repositório do domínio, e o Billing já tinha esse gateway, testado contra as fixtures do Inventory.

### Ler o catálogo depois de gravar

Gravar a mudança e só então montar a resposta com os dados de exibição. Descartada porque o Inventory fora do ar responderia 503 com a mudança já gravada, e o cliente repetiria uma operação que deu certo.

### Réplica do catálogo, ou nome copiado nos itens

Manter uma cópia do catálogo no work-order, alimentada por eventos, ou gravar o nome no item. Descartadas porque o catálogo teria dois donos e a cópia ficaria velha sem sinal; o custo evitado (uma leitura por item mostrado) é pequeno.

### Endpoint em lote `?ids=` no Inventory

Buscar todos os itens numa chamada. Descartada por enquanto: uma OS tem poucos itens, as chamadas saem em paralelo, e o Inventory precisaria de uma rota nova.

## Consequências

### Positivas

- **Um dono para catálogo e estoque.** Mudança de preço, nome ou saldo acontece num lugar só, e a próxima leitura já a mostra.
- **Reserva consistente sem transação distribuída.** Cada passo é uma transação local com a mensagem no outbox; a falha de estoque desfaz a aprovação de forma explícita, registrada no histórico e avisada ao cliente.
- **Nenhuma chamada HTTP dentro de transação.** As leituras no Inventory acontecem antes de abrir a transação.

### Negativas / Trade-offs

- **A OS fica alguns segundos em `AWAITING_APPROVAL` depois da aprovação.** A resposta continua 200 com o orçamento `APPROVED`, mas quem lê a OS logo depois ainda não a vê `APPROVED`.
- **A falta de estoque não é mais um 409 na aprovação.** Ela chega depois, como compensação e e-mail ao cliente.
- **O Inventory fora do ar derruba as rotas que mostram itens.** Detalhe da OS e do orçamento, abertura com itens e métricas respondem 503; a Saga espera na fila até ele voltar.
- **Uma leitura por item mostrado.** O detalhe de uma OS faz uma chamada ao Inventory por serviço ou peça, em paralelo.

### Riscos mitigados

- **Duas aprovações simultâneas da mesma OS**: a aprovação grava a OS com a versão, então só uma passa e a outra responde 409; sai uma Saga e um comando de reserva só.
- **Resposta repetida ou fora de hora**: o handler só age com a Saga em `RESERVING_STOCK`; nos outros casos registra e confirma a mensagem, sem efeito.
- **Orçamento novo durante a reserva levando a OS a `REJECTED`**: criação, envio e cancelamento respondem 409 enquanto a Saga está em `RESERVING_STOCK`.

### Revisar se

- O Inventory ganhar uma rota em lote: trocar as leituras por item por uma chamada só.
- A orquestração ganhar peças que não são casos de uso (agendador, prazo por passo): dar a ela uma pasta própria.
- A Saga passar a ser gravada numa transação que não grava a OS nem os orçamentos: acrescentar `version` em `saga_instances`.
- Algum orçamento passar a voltar a `PENDING` depois de enviado: `sent_at` deixa de bastar para restaurar o status.

## Referências

- [ADR 0011 — Unit of Work para transações multi-repositório](0011-unit-of-work-transacoes-multi-repositorio.md)
- [ADR 0018 — Mensageria SNS/SQS FIFO com outbox transacional](0018-mensageria-sns-sqs-fifo-com-outbox.md)
- [ADR 0019 — Cache do dono no ElastiCache](0019-cache-do-dono-no-elasticache.md)
- [ADR 0020 — Chamadas internas pela rede do cluster e rotas públicas negadas por padrão](0020-chamadas-internas-e-rotas-negadas-por-padrao.md)
- [`docs/architecture.md` › Aprovação de orçamento com reserva de estoque](../architecture.md#aprovação-de-orçamento-com-reserva-de-estoque)
- [`docs/api.md` › Dados de exibição dos itens](../api.md#dados-de-exibição-dos-itens)
- [`oficina-mecanica-inventory-service`](https://github.com/FIAP-15SOAT/oficina-mecanica-inventory-service)
