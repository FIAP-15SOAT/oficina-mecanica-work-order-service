# ADR 0011: Unit of Work para transações multi-repositório

## Status

Aceito — 2026-09-07

Emendado pelo [ADR 0025](0025-sagas-orquestradas-no-work-order.md): com os orçamentos, os pagamentos e o estoque em outros serviços, cada um com o próprio banco, a alternativa "Padrão Saga" deixou de ser descartada. As escritas que cruzam serviços são Sagas orquestradas pelo work-order, e a Unit of Work deste ADR continua sendo a transação de cada passo, com o outbox.

## Contexto

Vários casos de uso do domínio precisam alterar mais de um agregado atomicamente: aprovar um orçamento reserva estoque, materializa itens na ordem de serviço, transiciona a OS para `APPROVED`, rejeita os demais orçamentos pendentes da mesma OS e registra histórico — cinco escritas que precisam **todas** acontecer, ou **nenhuma**. Como a camada de domínio e aplicação são livres de framework e ORM (ver [ADR 0009](0009-clean-architecture-ddd-em-camadas.md)), os casos de uso não podem depender diretamente da API de transação do Prisma — precisam de uma abstração de domínio para "isto é uma unidade atômica de trabalho".

## Decisão

Introduzir o contrato `IUnitOfWork` no domínio, com um único método `executeTransaction(callback)`, onde `callback` recebe um conjunto de repositórios já conectados à mesma transação ativa. A implementação concreta, `PrismaUnitOfWork` (em `infrastructure/persistence/prisma/`), abre uma transação Prisma (`$transaction`), instancia cada repositório apontando para o cliente transacional, e invoca o `callback` — qualquer exceção lançada dentro dele reverte a transação inteira.

Casos de uso transacionais incluem: criação de OS (OS + `StatusHistory`), atualização de status de OS, atualização de status de serviço de OS (item + possível transição de status da OS + consumo de reserva + `StockMovement` + histórico), aprovação de orçamento (orçamento + reserva de estoque + itens na OS + status da OS + rejeição dos orçamentos concorrentes + histórico), rejeição de orçamento, envio de orçamento, movimentação manual de estoque, e manipulação de itens de orçamento.

## Alternativas consideradas

### Cada repositório abre sua própria transação internamente

Cada método de repositório (`create`, `update`) gerenciaria sua própria transação Prisma quando precisasse. Descartado porque não compõe: se um caso de uso precisa que a escrita de dois repositórios diferentes seja atômica, não há como unir duas transações independentes já abertas em uma só — a atomicidade multi-repositório é exatamente o problema que motivou esta decisão.

### Passar o cliente Prisma (`PrismaClient`/`TransactionClient`) diretamente para os casos de uso

Os casos de uso receberiam e repassariam o objeto de transação do Prisma entre chamadas de repositório. Descartado porque vazaria um tipo do ORM para dentro de `application/`, violando a fronteira livre de framework que a Clean Architecture (ADR 0009) e a cerca de ESLint impõem — o caso de uso saberia que existe um Prisma por baixo, o que é exatamente o acoplamento que a arquitetura em camadas existe para evitar.

### Script/procedure de banco (stored procedure) para operações multi-tabela

Moveria a atomicidade para dentro do banco via uma procedure PL/pgSQL, chamada uma vez pela aplicação. Descartado porque moveria regra de negócio (quais tabelas atualizar, em que ordem, sob que condição) para fora do domínio e da aplicação, para dentro do SGBD — inviável de testar com os mesmos mocks unitários usados hoje, e contrário à decisão de manter toda regra de negócio nas camadas `domain`/`application` (ver ADR 0009).

### Padrão Saga (para consistência eventual entre múltiplos passos)

Coordenaria os múltiplos passos como uma sequência de transações locais compensáveis, em vez de uma única transação ACID. Descartado porque o sistema é um monólito com um único banco (ver [ADR 0007](0007-padrao-de-comunicacao-rest-monolito.md)) — não há fronteira de serviço nem de banco de dados entre os passos que justificasse abrir mão de uma transação ACID nativa em favor de compensação eventual.

## Consequências

### Positivas

- **Atomicidade garantida no caminho comum**: qualquer falha em qualquer passo de um caso de uso multi-repositório reverte todos os anteriores, sem exigir lógica de compensação manual.
- **Casos de uso testáveis com mock único**: os testes unitários mockam `IUnitOfWork.executeTransaction` para simplesmente invocar o `callback` com repositórios mockados, sem precisar simular transação real.
- **Fronteira de framework preservada**: `application/` conhece apenas o contrato `IUnitOfWork`, nunca o `PrismaClient` ou `$transaction` diretamente.

### Negativas / Trade-offs

- **Transações podem ficar longas quando envolvem I/O externo**: um caso de uso que precise, dentro da mesma transação, chamar um serviço externo lento manteria a conexão de banco presa por mais tempo — mitigado hoje por nenhum caso de uso transacional depender de I/O externo síncrono dentro do `callback` (envio de e-mail acontece fora da transação, após o commit).
- **Repositórios precisam aceitar um cliente transacional injetável**: cada implementação Prisma de repositório precisa ser capaz de operar tanto com o cliente "solto" quanto com um cliente vinculado a uma transação — uma responsabilidade extra na implementação de infraestrutura.

### Riscos mitigados

- **Atualização parcial de agregados relacionados (orçamento aprovado mas estoque não reservado, por exemplo)**: eliminado pela atomicidade da transação — ou a operação completa acontece, ou nenhuma parte dela persiste.

## Referências

- [`docs/architecture.md` › Unit of Work](../architecture.md#unit-of-work)
- [ADR 0009 — Clean Architecture e DDD em camadas](0009-clean-architecture-ddd-em-camadas.md)
- [ADR 0010 — Concorrência otimista via coluna `version`](0010-concorrencia-otimista-via-version.md)
