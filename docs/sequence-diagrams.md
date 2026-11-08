# Diagramas de Sequência

Quatro fluxos centrais da aplicação, em notação UML: login interno, abertura de Ordem de Serviço, autenticação externa do Cliente da Oficina por CPF e aprovação de orçamento com reserva de estoque. Gerados via draw.io a partir de Mermaid, com XML editável embutido nos PNGs.

Nos três primeiros, existe uma camada de **Controller** duas vezes: o `Controller` do NestJS (em `infrastructure/http/controllers/`, borda HTTP — decorators de rota, DTOs, Swagger) delega para o `Controller` da Clean Architecture (em `interface-adapters/`, sem nenhuma dependência de framework), que por sua vez chama o caso de uso. Ver [ADR 0009](adr/0009-clean-architecture-ddd-em-camadas.md). No da aprovação de orçamento, as duas camadas aparecem num participante só, para dar espaço às mensagens trocadas com o Inventory.

## Login interno

<p align="center"><img src="diagrams/login-sequence.png" alt="Diagrama de sequência UML do login interno (POST /api/auth/login): AuthController (NestJS), AuthController (Clean Architecture), AuthenticateUserUseCase, IUserRepository, IHashService e ITokenService, com os quatro caminhos de falha (usuário inexistente, inativo, senha incorreta, sem role interna) convergindo para a mesma mensagem genérica 401, e o caminho feliz emitindo o par de tokens" width="100%"></p>

`POST /api/auth/login {email, password}` — os quatro caminhos de falha (usuário inexistente, inativo, senha incorreta, sem role interna) lançam a mesma exceção genérica (401 "Credenciais inválidas"); só o evento de log distingue a causa, para não virar oráculo de enumeração de contas. O `accessToken` emitido no fim é o mesmo usado como `Authorization: Bearer` no diagrama seguinte.

## Abertura de Ordem de Serviço

<p align="center"><img src="diagrams/work-order-creation-sequence.png" alt="Diagrama de sequência UML da abertura de uma Ordem de Serviço (POST /api/work-orders): WorkOrderController (NestJS), JwtAuthGuard, JwtStrategy, RolesGuard, WorkOrderController (Clean Architecture) a validação dos itens no Inventory pelo QuoteItemValidator e pelo IInventoryCatalogGateway, antes da transação (id desconhecido responde 404, Inventory fora do ar responde 503), e a transação do CreateWorkOrderUseCase — validação de cliente, veículo e mecânico atribuído, geração do número sequencial, criação da OS, histórico de status e orçamento inicial opcional" width="100%"></p>

`POST /api/work-orders`, a partir do `accessToken` obtido no login — passa por `JwtAuthGuard`/`JwtStrategy` (incluindo a checagem de `passwordChangedAt`) e `RolesGuard`, depois pela validação dos itens no Inventory, o serviço dono do catálogo de serviços e peças (feita antes da transação: id desconhecido → 404, Inventory fora do ar → 503), e pela transação do `CreateWorkOrderUseCase` com todos os ramos de erro (404/409/422) até o commit.

## Autenticação externa do Cliente da Oficina (CPF)

<p align="center"><img src="diagrams/customer-cpf-login-sequence.png" alt="Diagrama de sequência UML da autenticação externa por CPF: a função serverless (fora deste repositório) consulta o banco diretamente, assina um customer-jwt RS256 e o devolve ao Cliente da Oficina; a primeira chamada autenticada (GET /api/me) passa pelo AnyAuthGuard, que tenta a estratégia jwt interna (falha) e depois a CustomerJwtStrategy externa, validando assinatura RS256, isActive, iat contra passwordChangedAt e a existência de vínculo ativo com algum cliente" width="100%"></p>

A função serverless (`POST /customer-auth/login`, documentada na [ADR 0004](adr/0004-autenticacao-de-clientes.md), fora deste repositório) autentica por CPF + senha consultando o banco diretamente — nunca um proxy do login interno — e assina o `customer-jwt` com sua chave privada. A primeira chamada autenticada mostra o `AnyAuthGuard` tentando as duas estratégias Passport em sequência, e todos os ramos de rejeição da `CustomerJwtStrategy` (token sem `exp`, usuário inativo, `iat` anterior à última troca de senha, nenhum vínculo ativo) — todos convergindo para 401.

Ver [Identidade externa, autenticação e autorização por vínculo](architecture.md#identidade-externa-autenticação-e-autorização-por-vínculo) para o raciocínio completo sobre por que a autorização é resolvida a cada requisição, nunca embutida no JWT.

## Aprovação de orçamento com reserva de estoque

<p align="center"><img src="diagrams/quote-approval-saga-sequence.png" alt="Diagrama de sequência UML da aprovação de orçamento com reserva de estoque: o usuário aprova o orçamento; o ApproveQuoteUseCase grava numa transação a OS, o orçamento aprovado, os outros orçamentos rejeitados e a Saga, e, quando o orçamento tem peças, o comando inventory.stock.reserve no outbox; o OutboxRelayService publica o comando no SNS, que o entrega ao Inventory pela fila inventory.fifo; a resposta inventory.stock.reserved chega pela fila work-order.fifo ao CompleteQuoteApprovalUseCase, que leva a OS a APPROVED e conclui a Saga; a resposta inventory.stock.reservation_failed chega ao CompensateQuoteApprovalUseCase, que desfaz a aprovação, compensa a Saga e envia um e-mail ao cliente" width="100%"></p>

`PATCH /api/quotes/:id` (funcionário) ou `POST /api/me/quotes/:id/decisions` (Cliente da Oficina), aprovando um orçamento. A aprovação é uma **Saga**: uma sequência de transações locais, cada uma num serviço, ligada por mensagens, em que a falha de um passo dispara uma **compensação** que desfaz o que os passos anteriores gravaram. O work-order conduz a Saga e guarda o estado dela na tabela `saga_instances`.

- **Início.** O `ApproveQuoteUseCase` grava, numa transação, a OS (com a versão, para que duas aprovações simultâneas da mesma OS não passem as duas), o orçamento `APPROVED` e os outros orçamentos abertos como `REJECTED`. Orçamento sem peças leva a OS direto a `APPROVED`. Com peças, a OS segue em `AWAITING_APPROVAL` e a mesma transação grava no **outbox** (a tabela de mensagens a publicar) o comando `inventory.stock.reserve`. A resposta é `200` com o orçamento `APPROVED`.
- **Reserva.** O `OutboxRelayService`, o processo que publica o outbox a cada 500 ms, envia o comando ao tópico SNS `oficina-events.fifo`, que o entrega ao Inventory, o serviço dono do estoque, pela fila SQS FIFO `inventory.fifo`.
- **Conclusão.** A resposta `inventory.stock.reserved` chega pela fila `work-order.fifo` ao `SqsConsumerService`, que chama o `CompleteQuoteApprovalUseCase`: a OS vai a `APPROVED` com os itens e o histórico, e a Saga a `COMPLETED`.
- **Compensação.** A resposta `inventory.stock.reservation_failed` chama o `CompensateQuoteApprovalUseCase`: o orçamento volta a `SENT`, os rejeitados por ele voltam ao status anterior, o histórico da OS ganha a nota da falta de estoque, a Saga vai a `COMPENSATED` e o cliente recebe um e-mail.

Uma resposta que encontra a Saga ausente ou fora de `RESERVING_STOCK` (mensagem repetida ou fora de hora) só é registrada no log. Ver [Aprovação de orçamento com reserva de estoque](architecture.md#aprovação-de-orçamento-com-reserva-de-estoque) para as regras completas, inclusive os bloqueios enquanto a reserva está em andamento.

## Referências

- [ADR 0004 — Autenticação externa de clientes por CPF](adr/0004-autenticacao-de-clientes.md)
- [ADR 0009 — Clean Architecture e DDD em camadas](adr/0009-clean-architecture-ddd-em-camadas.md)
- [ADR 0013 — Autenticação interna via JWT stateless](adr/0013-autenticacao-interna-jwt-stateless.md) *(substituído pelo 0022)*
- [ADR 0022 — Token de funcionário em RS256](adr/0022-token-de-funcionario-em-rs256.md)
- [ADR 0023 — Catálogo e estoque no Inventory, com reserva pela Saga de aprovação](adr/0023-catalogo-e-estoque-no-inventory-com-reserva-pela-saga.md)
