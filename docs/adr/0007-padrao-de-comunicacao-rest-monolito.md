# ADR 0007: Padrão de comunicação — REST síncrono num monólito modular

## Status

Aceito — 2026-09-07

Superado em parte pelos ADRs [0018](0018-mensageria-sns-sqs-fifo-com-outbox.md) (mensageria assíncrona entre serviços) e [0020](0020-chamadas-internas-e-rotas-negadas-por-padrao.md) (chamadas REST internas entre serviços). A API pública continua REST síncrona, documentada em OpenAPI.

## Contexto

O enunciado da Fase 1 do desafio exige explicitamente um "back-end monolítico em arquitetura em camadas" com "APIs RESTful documentadas via Swagger". O sistema tem um único consumidor direto conhecido (o front-end/cliente HTTP da oficina) e uma única integração externa de fato assíncrona (o e-mail de notificação de orçamento, via SMTP) — não há, hoje, um segundo serviço backend que precise conversar com esta API em tempo real, nem um requisito de processamento em lote ou de alta taxa de eventos que justificasse um barramento de mensagens.

A entrada recente da autenticação externa por CPF (ADR 0004) introduziu o primeiro **serviço externo de fato** do sistema — a função serverless de autenticação — mas mesmo essa integração permanece síncrona e por HTTP (a função consulta o banco diretamente e emite um JWT; a API principal apenas verifica esse token, nunca chama a função de volta).

## Decisão

Manter a aplicação como um **monólito modular**, exposto por uma **API HTTP REST síncrona** (JSON sobre HTTP, documentada em OpenAPI/Swagger), sem barramento de eventos nem chamadas RPC internas entre módulos — a modularidade vem inteiramente da separação em camadas (`domain`/`application`/`interface-adapters`/`infrastructure`, ver [ADR 0009](0009-clean-architecture-ddd-em-camadas.md)) e por domínio de negócio dentro de cada camada, não de processos ou serviços separados.

Comunicação entre módulos de domínio dentro do mesmo processo acontece por **chamada direta de método** (um caso de uso injetando outro, ou uma política compartilhada como `CustomerAccessPolicy`), nunca por fila ou barramento interno. A única comunicação assíncrona do sistema é o envio de e-mail (`IEmailSenderService`), que é *fire-and-forget* do ponto de vista do fluxo HTTP — a falha de envio é registrada em log e não interrompe a resposta ao cliente.

## Alternativas consideradas

### Microsserviços com comunicação por eventos (mensageria)

Descartada porque:

- O requisito do desafio é explícito por um monólito em camadas — dividir em serviços contrariaria o enunciado da Fase 1.
- O domínio (oficina mecânica) tem um volume e uma complexidade de integração que não justificam o custo operacional de mensageria, service discovery e consistência eventual entre serviços.
- Nenhum caso de uso do domínio hoje precisa de processamento assíncrono desacoplado do ciclo de vida da requisição HTTP que o originou — orçamento aprovado, estoque reservado e OS atualizada acontecem atomicamente numa única transação (ver [ADR 0011 — Unit of Work](0011-unit-of-work-transacoes-multi-repositorio.md)), não como uma cadeia de eventos.

### GraphQL em vez de REST

Descartado porque:

- O enunciado do desafio pede explicitamente APIs RESTful.
- O padrão de acesso do sistema é dominado por operações CRUD e transições de estado bem definidas por recurso (ordem de serviço, orçamento, cliente) — o problema que GraphQL resolve bem (agregação flexível de múltiplos recursos numa única consulta, moldada pelo cliente) não é uma dor deste domínio.
- REST com Swagger/OpenAPI já entrega o contrato de API navegável e versionável que o time precisa, sem introduzir um resolver adicional por tipo.

### gRPC / RPC binário

Descartado porque:

- Não há, hoje, um segundo serviço interno consumindo esta API por chamadas de procedimento remoto de alta performance — o único cliente é HTTP/JSON (front-end e Postman/Swagger).
- gRPC exigiria expor `.proto` e um segundo transporte, sem ganho real neste estágio: a latência e o volume de requisições não pressionam o overhead de JSON sobre HTTP.

## Consequências

### Positivas

- **Simplicidade operacional**: um único processo, um único deploy (`Deployment` no Kubernetes), sem coordenação de versão entre serviços nem contratos de mensageria para manter compatíveis.
- **Transações ACID naturais**: operações que tocam múltiplos agregados (aprovar orçamento, reservar estoque, avançar status de OS) acontecem numa única transação de banco, sem a complexidade de sagas ou consistência eventual que uma arquitetura orientada a eventos exigiria.
- **Contrato único e navegável**: o Swagger/OpenAPI gerado a partir dos DTOs é a fonte da verdade da API, consumível por qualquer cliente HTTP sem SDK gerado.
- **Modularidade sem o custo de rede**: a separação em camadas e por domínio (ver ADR 0009) já impõe fronteiras de responsabilidade dentro do monólito, sem pagar o custo de latência de rede entre módulos que microsserviços exigiriam.

### Negativas / Trade-offs

- **Escala é vertical/replicada, não por módulo**: o HPA (ver [ADR 0008](0008-autoscaling-via-hpa.md)) escala o processo inteiro — não é possível escalar só o módulo de Orçamentos independentemente do de Ordens de Serviço, por exemplo, caso um deles se torne o gargalo isolado no futuro.
- **Acoplamento de deploy**: qualquer mudança em qualquer módulo exige rebuild e redeploy de toda a aplicação; não há como implantar um módulo isoladamente.
- **Um único ponto de falha por processo**: um erro não tratado que derrube o processo Node.js afeta toda a API, não apenas o módulo onde ocorreu — mitigado por múltiplas réplicas via HPA e pelos filtros de exceção que capturam a maior parte dos erros esperados antes que cheguem a esse ponto.

### Riscos mitigados

- **Falha de e-mail bloqueando o fluxo principal**: mitigado por o envio ser assíncrono do ponto de vista do chamador — uma falha no SMTP é registrada (`USER_INITIAL_PASSWORD_SEND_FAILED`, por exemplo) e não impede a resposta HTTP da operação que disparou o e-mail.

## Referências

- README.md — requisitos da Fase 1 e Fase 2 do desafio.
- [ADR 0009 — Clean Architecture e DDD em camadas](0009-clean-architecture-ddd-em-camadas.md)
- [ADR 0011 — Unit of Work para transações multi-repositório](0011-unit-of-work-transacoes-multi-repositorio.md)
