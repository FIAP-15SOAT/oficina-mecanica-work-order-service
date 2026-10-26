# 🧩 Modelo C4 — Sistema da Oficina Mecânica

Este diretório documenta a arquitetura do **Sistema da Oficina Mecânica** com o [modelo C4](https://c4model.com). O C4 descreve a arquitetura em **níveis de zoom sucessivos** — como aproximar um mapa: o mesmo sistema visto de mais longe (Contexto) ou de mais perto (Container, Componente). O sistema em foco é sempre o mesmo em todos os níveis; só muda o nível de detalhe.

Este projeto documenta os **três primeiros níveis**. Cada seção abaixo traz a imagem do diagrama, a descrição dos elementos e as convenções seguidas.

## Índice

- [Como ler os quatro níveis](#como-ler-os-quatro-níveis)
- [Convenções](#convenções)
- [Nível 1 — Contexto do Sistema](#nível-1--contexto-do-sistema)
- [Nível 2 — Container](#nível-2--container)
- [Nível 3 — Componente da API REST](#nível-3--componente-da-api-rest)
- [Documentação relacionada](#documentação-relacionada)

## Como ler os quatro níveis

O C4 define quatro níveis de detalhe. Cada nível é um zoom a mais sobre o **mesmo** sistema:

| Nível | O que mostra | Neste projeto |
|---|---|---|
| **1 · Contexto** | O sistema, seus usuários e os sistemas externos | ✅ [ver](#nível-1--contexto-do-sistema) |
| **2 · Container** | Os blocos executáveis/implantáveis dentro do sistema | ✅ [ver](#nível-2--container) |
| **3 · Componente** | As peças internas de um container | ✅ [ver](#nível-3--componente-da-api-rest) |
| **4 · Código** | Classes/tabelas de um componente | ➖ fora de escopo |

## Convenções

Convenções seguidas em todos os diagramas, para leitura consistente entre os níveis:

- **Nome único do sistema.** O sistema em foco é sempre **"Sistema da Oficina Mecânica"**, idêntico em Contexto, Container e Componente — é o mesmo sistema, só muda o zoom.
- **Tipo explícito em todo elemento.** Cada elemento declara o tipo entre colchetes (`[Pessoa]`, `[Sistema de Software]`, `[Container: tecnologia]`, `[Componente: tecnologia]`).
- **Pessoas com silhueta.** Os atores usam a silhueta oficial de pessoa (círculo + corpo), como nos exemplos de [c4model.com/diagrams/system-context](https://c4model.com/diagrams/system-context) e [.../container](https://c4model.com/diagrams/container).
- **Ícone de componente.** No diagrama de Componente, cada componente leva o ícone UML clássico (dois retângulos), igual à legenda de [c4model.com/diagrams/component](https://c4model.com/diagrams/component), na mesma paleta azul dos demais elementos.
- **Tecnologia só ao cruzar fronteira.** O rótulo de tecnologia/protocolo (HTTP, JWT, SQL, SMTP…) aparece nas setas apenas a partir do nível de Container. No Contexto as setas trazem só a ação; no Componente, a tecnologia surge quando a relação cruza a fronteira da API, como no acesso do cliente, no Banco de Dados e no Servidor SMTP.

## Nível 1 — Contexto do Sistema

O nível mais macro, pensado para stakeholders **não técnicos**: mostra quem usa o sistema e com quais sistemas externos ele conversa, sem nenhum detalhe interno.

<p align="center"><img src="images/c4-system-context.png" alt="Diagrama de Contexto C4: Administrador, Mecânico, Atendente e Cliente interagem com o Sistema da Oficina Mecânica; o sistema envia notificações por um Servidor SMTP externo e telemetria ao Datadog" width="100%"></p>

As caixas de pessoa descrevem **quem** cada ator é (não o que faz — a ação fica no rótulo da seta). Nenhuma seta menciona protocolo ou tecnologia, que são detalhe de nível mais baixo. Os nomes também evitam sufixo técnico: **"Sistema da Oficina Mecânica"** (não "...API") e **"Servidor SMTP"** (não "MailHog", que é apenas a implementação de desenvolvimento, revelada só no nível de Container). O **PostgreSQL não aparece** aqui por ser detalhe interno.

| Elemento | Tipo | Papel |
|---|---|---|
| **Administrador** | Pessoa | Responsável pela configuração geral e por tarefas administrativas; gerencia usuários, serviços, peças, clientes, veículos, ordens de serviço, orçamentos e estoque |
| **Mecânico** | Pessoa | Executa e atualiza as ordens de serviço sob sua responsabilidade |
| **Atendente** | Pessoa | Cadastra clientes e veículos; cria e gerencia ordens de serviço e orçamentos |
| **Cliente da Oficina** | Pessoa externa | Dono do veículo levado para manutenção; autentica por CPF e senha e aprova ou rejeita orçamentos |
| **Servidor SMTP** | Sistema externo | Entrega aos clientes os e-mails de orçamento enviados pelo sistema |
| **Datadog** | Sistema externo | Recebe e apresenta logs, métricas e traces da solução |

## Nível 2 — Container

Um zoom para dentro da fronteira do sistema: os blocos executáveis/implantáveis e como se comunicam.

<p align="center"><img src="images/c4-container.png" alt="Diagrama de Container C4: o API Gateway encaminha a autenticação externa à Lambda Customer Auth e o tráfego da API ao EKS; a API REST persiste no Amazon RDS, lê e invalida o detalhe da OS no ElastiCache, publica e consome mensagens no SNS e SQS FIFO, envia e-mails ao Servidor SMTP e emite telemetria ao Datadog Agent, que a encaminha ao Datadog" width="100%"></p>

Dentro do **Sistema da Oficina Mecânica** estão os sete blocos implantáveis ou gerenciados que participam do fluxo atual: **API Gateway**, **API REST**, **Customer Auth**, **Banco de Dados**, **Cache**, **Mensageria** e **Coleta de Telemetria**. O **Servidor SMTP** e o **Datadog** são sistemas externos. É neste nível que aparecem **tecnologia e protocolo** nas setas, como recomendado. O relay do outbox e o consumidor da fila rodam dentro do processo da API, sem worker separado; o Job de migração do Kubernetes reutiliza a mesma imagem da API e por isso não é modelado como container à parte.

| Container | Tecnologia | Responsabilidade |
|---|---|---|
| **API Gateway** | AWS HTTP API | Entrada pública; encaminha `/customer-auth/login` à Lambda e `/api/{proxy+}` ao NLB interno pelo VPC Link |
| **API REST** | NestJS 12 · Node.js 24 · TypeScript no EKS | Expõe `/api`, concentra a lógica de negócio em Clean Architecture e envia notificações |
| **Customer Auth** | AWS Lambda · Node.js 24 | Valida CPF, senha e status e emite `customer-jwt` RS256 |
| **Banco de Dados** | PostgreSQL 18 (Amazon RDS) | Armazena todas as entidades de negócio (clientes, veículos, ordens de serviço, peças/insumos, orçamentos, estoque, usuários) e o outbox das mensagens; serviço **gerenciado, fora do cluster**, alcançado pela rede a partir das subnets privadas |
| **Cache** | Valkey 9.1 (Amazon ElastiCache) | Guarda o detalhe das ordens de serviço (cache-aside, TTL de 12 h); serviço gerenciado, fora do cluster, com TLS e senha |
| **Mensageria** | Amazon SNS + SQS FIFO | Tópico `oficina-events.fifo` e fila `work-order.fifo` com DLQ, para as mensagens entre os serviços da oficina |
| **Coleta de Telemetria** | Datadog Agent no EKS | Coleta `stdout`, kubelet e OTLP da API e envia a telemetria ao Datadog |
| **Servidor SMTP** | MailHog (externo) | Recebe e entrega os e-mails de orçamento (sink SMTP de desenvolvimento) |
| **Datadog** | Serviço externo | Apresenta dashboards, alertas, logs, métricas e traces |

Os protocolos nas setas: os atores entram por **HTTPS** no API Gateway; a autenticação de cliente usa integração **AWS_PROXY** com a Lambda; a API segue por **VPC Link → NLB interno → NodePort**; API e Lambda acessam o RDS por **SQL/TLS**; a API acessa o ElastiCache por **RESP sobre TLS** e o SNS e o SQS por **HTTPS** (AWS SDK); a API notifica por **SMTP** e emite telemetria por `stdout` e **OTLP**. A estratégia Passport externa (`customer-jwt`, RS256) permanece separada da usada pelos funcionários (`jwt`, RS256 com outra chave, emissor e audiência).

## Nível 3 — Componente da API REST

O zoom mais interno: as peças que compõem o container **API REST**.

<p align="center"><img src="images/c4-component.png" alt="Diagrama de Componente C4 da API REST: onze módulos de negócio (Auth, Usuários, Clientes, Veículos, Serviços, Peças/Insumos, Ordens de Serviço, Orçamentos, Estoque, Minha Conta e Rotas Internas) e cinco componentes transversais (Guards/Segurança, Repositories, Cache, Mensageria e Cliente Interno); Ordens de Serviço e Orçamentos se relacionam nos dois sentidos e invalidam o Cache, os Orçamentos criam reservas no Estoque e enviam e-mail pelo Servidor SMTP, o Cliente da Oficina passa por Guards/Segurança até Minha Conta, os Serviços da Oficina leem a OS pelas Rotas Internas, e Repositories, Cache e Mensageria usam o PostgreSQL, o ElastiCache e o SNS/SQS FIFO" width="100%"></p>

São **onze módulos de negócio** e **cinco componentes transversais**, com as dependências reais entre módulos levantadas no código. Destaques do fluxo: **Ordens de Serviço ↔ Orçamentos** se relacionam nos dois sentidos (a OS cria e lista orçamentos; o orçamento lê e atualiza o status da OS); os **Orçamentos** criam reservas no **Estoque** ao aprovar e disparam e-mail pelo **Servidor SMTP**; o **Cliente da Oficina** apresenta o `customer-jwt` ao componente **Guards/Segurança**, que o vincula ao módulo **Minha Conta**; os **Serviços da Oficina** leem a OS pelas **Rotas Internas**; e **Ordens de Serviço** e **Orçamentos** leem e invalidam o detalhe da OS no **Cache**.

As dependências de quase todos os módulos em relação a **Guards / Segurança** e **Repositories**, e as de **Clientes** e **Veículos** em relação ao **Cache**, estão descritas no texto desses componentes, e **não desenhadas como setas** — isso evita cerca de 18 setas repetidas que poluiriam o diagrama sem agregar informação. Como no exemplo oficial (Figura 3 do material da aula), as setas entre componentes do mesmo container não levam rótulo de tecnologia; a tecnologia aparece somente nas relações que cruzam a fronteira da API, como cliente, Banco de Dados, Cache Distribuído, Mensageria AWS, Servidor SMTP e Serviços da Oficina.

**Módulos de negócio**

| Componente | Tecnologia | Responsabilidade |
|---|---|---|
| **Auth** | NestJS Module | Login, refresh de token e dados do usuário autenticado (JWT) |
| **Usuários** | NestJS Module | CRUD de usuários e mecânicos (perfis ADMIN, MECHANIC, ATTENDANT) |
| **Clientes** | NestJS Module | CRUD de clientes (pessoa física/jurídica) |
| **Veículos** | NestJS Module | CRUD de veículos e listagem de veículos por cliente |
| **Serviços** | NestJS Module | CRUD de tipos de serviço e métricas |
| **Peças/Insumos** | NestJS Module | CRUD de peças/insumos e ajuste manual de estoque |
| **Ordens de Serviço** | NestJS Module | Criação e gestão de ordens de serviço, status e histórico |
| **Orçamentos** | NestJS Module | Itens de orçamento, submissão e notificação por e-mail (decisão via Minha Conta) |
| **Estoque** | NestJS Module | Consulta de movimentações e reservas de estoque (somente leitura) |
| **Minha Conta** | NestJS Module | Rotas autenticadas do usuário externo: identidade, senha, ordens e orçamentos vinculados, decisão de orçamento |
| **Rotas Internas** | NestJS Module | Rotas `/internal` para os outros serviços, sem token e fora do prefixo `/api`; delegam ao Clean Controller existente (`GET /internal/work-orders/:id`) |

**Componentes transversais**

| Componente | Tecnologia | Responsabilidade |
|---|---|---|
| **Guards / Segurança** | NestJS Guards | `AuthenticationGuard` global que nega por padrão (token de funcionário, salvo `@Public()` ou `@CustomerArea()`), `RolesGuard` (RBAC interno) e as estratégias separadas `jwt` (RS256, funcionário) e `customer-jwt` (RS256) |
| **Repositories** | Prisma | Acesso a dados centralizado e global; todos os módulos de negócio persistem através dele, com o outbox gravado no mesmo Unit of Work |
| **Cache** | NestJS Module · ioredis | Cache-aside do detalhe da OS no Valkey; invalidado depois do commit pelas escritas em OS, orçamentos, clientes e veículos |
| **Mensageria** | NestJS Module · AWS SDK | Relay do outbox para o SNS FIFO e consumidor da fila SQS FIFO, com o span `CONSUMER` |
| **Cliente Interno** | @nestjs/axios | Chamadas REST a outros serviços, com prazo, `x-request-id` e `traceparent` |

## Documentação relacionada

- 🏛️ [Arquitetura](../architecture.md) — Clean Architecture, DDD, ciclos de vida, Unit of Work, exceções.
- 🏗️ [Infra · Visão Geral](../infra/overview.md) — a infraestrutura como sistema (inclui as vistas de deployment).
- 📈 [Observabilidade](../observability.md) — logs, métricas, traces, dashboards e alertas.
- 📐 [ADRs](../adr) — decisões arquiteturais.
- 🌐 [c4model.com](https://c4model.com) — referência oficial do modelo C4.
