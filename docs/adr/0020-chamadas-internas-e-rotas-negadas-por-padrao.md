# ADR 0020: Chamadas internas pela rede do cluster e rotas públicas negadas por padrão

## Status

Aceito — 2026-10-25

Supera o [ADR 0007](0007-padrao-de-comunicacao-rest-monolito.md) na parte "sem chamadas entre módulos por rede": a comunicação síncrona entre serviços é descrita aqui; a assíncrona, no [ADR 0018](0018-mensageria-sns-sqs-fifo-com-outbox.md).

## Contexto

Com a divisão em serviços, um serviço precisa ler dados de que outro é dono (o Billing lê a OS, o Work Order lê itens de catálogo do Inventory) sem acessar o banco dele. A leitura precisa ser síncrona, com prazo, rastreável no trace e com o mesmo `x-request-id` da requisição de origem.

Ao mesmo tempo, as rotas que o serviço expõe passam a ser de três tipos: rotas da oficina (token de funcionário), rotas do Cliente da Oficina (token de cliente) e rotas para outros serviços. Até aqui, cada controller declarava o próprio guard de autenticação, então uma rota nova sem `@UseGuards` nascia pública sem que ninguém percebesse.

## Decisão

**Rotas `/internal` pela rede do cluster, sem autenticação, chamadas por um cliente HTTP do framework; e um guard global que nega por padrão.**

1. **Rotas internas.** Ficam em `infrastructure/http/controllers/internal/`, fora do prefixo `api` (que é o único que o API Gateway encaminha), marcadas com `@Public()` e fora do Swagger. Cada rota delega ao Clean Controller existente e devolve o mesmo corpo da rota pública equivalente: `GET /internal/work-orders/:id` responde como `GET /api/work-orders/:id`.
2. **Contrato por fixture.** O dono versiona a fixture da resposta em `app/test/contracts/` e o próprio e2e compara a forma da resposta com ela. Quem consome copia a fixture e testa o adaptador contra a cópia.
3. **Cliente interno.** Cada serviço dono tem um gateway (porta em `application/ports/output/gateways/<dono>/`, adaptador em `infrastructure/gateways/<dono>/`) sobre o `InternalHttpClient`, que usa o `HttpService` do `@nestjs/axios` e não tem interface, porque só a infraestrutura o usa. O `axios` roda sobre `node:http`, que a instrumentação HTTP do OpenTelemetry cobre: o `traceparent` é injetado e a chamada vira span `CLIENT` sem código manual. O cliente envia o `x-request-id` do contexto (num handler de mensagem, o `messageId`), usa prazo de 2 s (configurável por chamada), sem retentativa e sem redirecionamento.
4. **Erros do dono.** O 4xx do serviço chamado vira `ServiceRequestRejectedException(status, mensagem)`, respondida com o mesmo status e a mensagem do dono; timeout, falha de conexão e 5xx viram `ServiceIntegrationException` (503).
5. **Guard global.** O `AuthenticationGuard` é registrado como `APP_GUARD`: sem marcação, a rota exige o token de funcionário; `@Public()` dispensa; `@CustomerArea()` exige o token de cliente e `@CustomerArea('any')` aceita os dois. O `RolesGuard` continua por controller.

## Alternativas consideradas

| Alternativa | Trade-off | Rever se |
| --- | --- | --- |
| Chamar o outro serviço pelo API Gateway | Um caminho só para tudo, mas exporia as rotas internas na internet e somaria a latência do gateway | — |
| Chave compartilhada `x-internal-api-key`, chave por dono, JWT emitido por cada serviço ou repasse do token do usuário | Protegem a rota mesmo dentro da rede, mas custam distribuição e rotação de segredo; protegem contra a mesma ameaça que a rede e a revisão de PR já cobrem num projeto com VPC só do time; o repasse do token não cobre os handlers de mensagem nem a Lambda | A VPC ou o gateway deixarem de ser só do time: aí, token de ServiceAccount projetado com TokenReview |
| Aceitar chamada sem token na própria rota pública | Nenhuma rota nova, mas a rota pública deixaria de exigir token | — |
| Use cases novos para cada chamador | Recorte exato por chamador, reescrevendo o que já existe para outro serviço | — |
| Presenter interno enxuto `{ id, number, status, customerId, vehicleId }` na rota da OS | Menos dado pessoal circulando, mas o caso de uso já carrega o detalhe e resolve o usuário, então o recorte não economiza consulta, só acrescenta método, presenter e tipo; o custo da escolha é a fixture do detalhe completo, que muda junto com o detalhe público | A rota passar a ser alcançável de fora da VPC, ou o detalhe público ganhar campo que nenhum outro serviço deva ver |
| Endpoint em lote `?ids=` | Uma chamada por orçamento, com um caso de uso novo; um orçamento tem poucos itens, então chamadas por id em paralelo bastam | Um orçamento passar a ter centenas de itens |
| Cliente próprio sobre `node:http` | Nenhuma dependência nova, reescrevendo prazo, serialização e tratamento de erro que o framework já oferece | — |
| `@nestjs/http-client` (sobre `fetch`) | Cliente novo do próprio Nest, mas o `fetch` do Node usa o undici, que a instrumentação HTTP não cobre: exigiria a `instrumentation-undici`, e ele faz retentativas por padrão, que teriam de ser desligadas | O `@nestjs/axios` ser descontinuado |
| Guard de autenticação por controller (como antes) | Explícito em cada controller, mas uma rota nova sem `@UseGuards` nasce pública em silêncio | — |

## Consequências

### Positivas

- Nenhum serviço lê o banco de outro; a leitura entre serviços tem prazo, trace e `x-request-id`.
- As rotas internas reaproveitam os casos de uso e os presenters existentes.
- Uma rota nova esquecida sem marcação nasce exigindo token de funcionário.
- O contrato das rotas internas quebra no PR do dono, não no ambiente.

### Negativas e limites

- As rotas `/internal` não pedem credencial: a proteção é a rede do cluster e a revisão de PR. Qualquer workload do cluster pode chamá-las.
- O detalhe completo da OS, com dados pessoais do cliente, circula na rede interna.
- As cópias da fixture nos consumidores mudam à mão, no PR de cada um.
- Uma indisponibilidade do serviço chamado vira 503 na rota de quem chamou, sem retentativa.

## Referências

- [Arquitetura — Chamadas internas](../architecture.md#chamadas-internas)
- [Arquitetura — Perfis de usuário (RBAC)](../architecture.md#perfis-de-usuário-rbac)
- [Testes — Contrato das rotas `/internal`](../testing.md#contrato-das-rotas-internal)
- [ADR 0013 — Autenticação interna JWT](0013-autenticacao-interna-jwt-stateless.md)
- [NestJS — Guards](https://docs.nestjs.com/guards)
- [NestJS — HTTP module](https://docs.nestjs.com/techniques/http-module)
