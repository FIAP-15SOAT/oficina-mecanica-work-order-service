# ADR 0009: Clean Architecture e DDD em camadas, com fronteira livre de framework

## Status

Aceito — 2026-09-07

## Contexto

O enunciado da Fase 1 exige um "back-end monolítico em arquitetura em camadas" aplicando Domain-Driven Design; o da Fase 2 exige refatoração "sob Clean Code e Clean Architecture, com testes automatizados cobrindo os fluxos críticos". O domínio (ordens de serviço, orçamentos, estoque, clientes, autenticação interna e externa) tem regras de negócio não triviais — máquinas de estado de OS e orçamento, validação de documentos (CPF/CNPJ), autorização por vínculo — que precisam ser testáveis isoladamente do framework web e do ORM, e capazes de evoluir sem que uma troca de ferramenta (NestJS, Prisma) obrigue a reescrever regra de negócio.

## Decisão

Adotar **Clean Architecture** com quatro camadas concêntricas e regra de dependência única (o código aponta só para dentro):

- **`domain/`** — entidades ricas, value objects, agregados (`WorkOrder` e `Quote` são Aggregate Roots), invariantes e regras de negócio. Livre de framework e ORM.
- **`application/`** — orquestração de casos de uso, portas de entrada (`I<Nome>UseCase`) e saída (`ILogger`, `IMetrics`, `ICache` e os gateways de outros serviços), políticas de autorização reutilizáveis. Livre de framework e ORM.
- **`interface-adapters/`** — Clean Controllers e Presenters, POJOs puros que traduzem entre casos de uso e formatos de request/response, sem decorators do NestJS.
- **`infrastructure/`** — implementações concretas: a borda HTTP do NestJS (`@Controller`, guards, DTOs com `@ApiProperty`, filtros de exceção), os repositórios Prisma, os serviços externos (mensageria, cache e os clientes HTTP de outros serviços) e logging.

A regra é **imposta por ferramenta, não só por convenção**: uma cerca de ESLint proíbe imports de `@nestjs/*` e `@generated/client` (o Prisma Client) dentro de `domain/` e `application/`, quebrando a build se violada. Cada caso de uso depende de **interfaces** de repositório (`domain/interfaces/repositories/`), nunca da implementação Prisma concreta — a inversão de dependência é a peça que permite testar regra de negócio com mocks, sem banco.

## Alternativas consideradas

### Arquitetura em camadas tradicional (N-tier, sem inversão de dependência)

Seria a leitura mais literal do requisito "arquitetura em camadas" da Fase 1 — controllers chamando services que chamam repositórios Prisma diretamente, sem interfaces intermediárias. Descartada porque:

- Acoplaria regra de negócio ao Prisma desde o início — testar um caso de uso exigiria banco (real ou mock de ORM), não um mock de interface simples.
- Não sustentaria o requisito de Clean Architecture explícito na Fase 2, que pede inversão de dependência real, não apenas nomes de pasta separados.

### Transaction Script (lógica de negócio nos controllers/services, sem entidades ricas)

Colocaria as regras de transição de status de OS e orçamento como `if`s procedurais nos casos de uso, em vez de encapsuladas nas próprias entidades (`WorkOrder.transitionTo(...)`, por exemplo). Descartada porque:

- O domínio tem invariantes reais que precisam ser garantidas onde quer que a entidade seja manipulada (ex.: `WorkOrder.create` valida mecânico atribuído em qualquer ponto de entrada, não só no caso de uso de criação) — Transaction Script não impede duplicar (ou esquecer) essa validação em um segundo ponto de entrada futuro.
- Contraria DDD, exigido desde a Fase 1.

### Hexagonal/Ports & Adapters sem separação explícita `application`/`interface-adapters`

Uma variante mais enxuta de Clean Architecture, com só duas camadas (domínio + adaptadores), em vez de quatro. Descartada porque a separação entre `application` (orquestração de caso de uso, ainda livre de framework) e `interface-adapters` (tradução para o formato HTTP, também livre de framework, mas já ciente do formato de request/response) permite testar o Clean Controller isoladamente do NestJS, e testar o caso de uso isoladamente do formato HTTP — uma granularidade que a versão de duas camadas perderia.

## Consequências

### Positivas

- **Regra de negócio testável sem framework nem banco**: 191 suítes de testes unitários exercitam entidades, casos de uso e Clean Controllers com mocks de interface, sem subir Nest nem Postgres.
- **Troca de framework/ORM é auditável e localizada**: `@nestjs/*` e `@generated/client` só podem aparecer em `infrastructure/`; a cerca de ESLint torna qualquer vazamento um erro de build, não um problema descoberto tarde em produção.
- **Onboarding previsível**: a estrutura de pastas por domínio dentro de cada camada (`use-cases/work-order/`, `interface-adapters/work-order/`, etc.) torna óbvio onde uma nova regra de negócio ou endpoint deve entrar.

### Negativas / Trade-offs

- **Mais indireção por funcionalidade**: uma única regra de negócio nova geralmente toca 4-5 arquivos (entidade, porta de entrada, caso de uso, Clean Controller, `@Controller` NestJS) em vez de um só — custo aceito em troca de testabilidade e isolamento de framework.
- **Curva de entrada para quem não conhece Clean Architecture**: exige entender a regra de dependência e onde cada tipo de lógica pertence antes de contribuir com confiança.
- **Duplicação aparente de DTOs**: existe um tipo "puro" no `interface-adapters` e um `*RequestDto`/`*ResponseDto` decorado com `@ApiProperty` no `infrastructure/http`, que implementa o tipo puro — necessário para manter Swagger fora do domínio, mas exige manter os dois em sincronia.

### Riscos mitigados

- **Regra de negócio vazando para a borda HTTP**: mitigado pela cerca de ESLint e pela revisão de código apoiada nela — um `import` de `@nestjs/common` dentro de `domain/` quebra a build antes de chegar a um PR.
- **Acoplamento ao Prisma dificultando testes e troca de ORM**: mitigado pelas interfaces de repositório em `domain/interfaces/repositories/`, injetadas por Nest apenas na composição (`infrastructure/persistence/prisma/`).

## Referências

- [`docs/architecture.md` › Estrutura de camadas](../architecture.md#estrutura-de-camadas)
- README.md — requisitos de Clean Architecture e DDD nas Fases 1 e 2.
