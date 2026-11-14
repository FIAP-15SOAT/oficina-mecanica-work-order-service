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
- **Tecnologia só ao cruzar fronteira.** O rótulo de tecnologia/protocolo (HTTP, JWT, SQL, SMTP…) aparece nas setas apenas a partir do nível de Container. No Contexto as setas trazem só a ação; no Componente, a tecnologia surge quando a relação cruza a fronteira da API, como no acesso do cliente, no Banco de Dados e na Mensageria AWS.
- **Imagem com o fonte.** As imagens são geradas pelo PlantUML com a biblioteca [C4-PlantUML](https://github.com/plantuml-stdlib/C4-PlantUML) v2.14.0, e o fonte de cada diagrama fica embutido no próprio PNG.

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
| **Servidor SMTP** | Sistema externo | Entrega aos destinatários os e-mails enviados pelo sistema: orçamento enviado, link de pagamento, falta de estoque e os de acesso (senha inicial e código de redefinição de senha) |
| **Datadog** | Sistema externo | Recebe e apresenta logs, métricas e traces da solução |

## Nível 2 — Container

Um zoom para dentro da fronteira do sistema: os blocos executáveis/implantáveis e como se comunicam.

<p align="center"><img src="images/c4-container.png" alt="Diagrama de Container C4: o API Gateway encaminha a autenticação externa à Lambda Customer Auth, as rotas de orçamento e de cobrança ao Billing, as de catálogo e estoque ao Inventory, as de login e de usuários ao Identity e o restante da API à API REST, no EKS; a API REST persiste no Amazon RDS, lê e invalida o detalhe da OS no ElastiCache, cria e lê orçamentos, repassa decisões e lê saldo e cobranças no Billing, lê o catálogo no Inventory, lê e cria usuários no Identity, publica e consome mensagens no SNS e SQS FIFO, inclusive os e-mails ao cliente, e emite telemetria ao Datadog Agent, que a encaminha ao Datadog; a Lambda Notificação recebe os e-mails da fila notification.fifo e os envia ao Servidor SMTP; o Billing e o Inventory publicam e consomem as mensagens deles no SNS e SQS FIFO" width="100%"></p>

Dentro do **Sistema da Oficina Mecânica** estão os oito blocos implantáveis ou gerenciados que participam do fluxo atual: **API Gateway**, **API REST**, **Customer Auth**, **Notificação**, **Banco de Dados**, **Cache**, **Mensageria** e **Coleta de Telemetria**. O **Billing**, o **Inventory**, o **Identity**, o **Servidor SMTP** e o **Datadog** são sistemas externos. O Billing, o Inventory e o Identity são outros serviços da solução, cada um com banco e cache próprios. O Billing é dono dos orçamentos e dos pagamentos: a API REST cria nele o orçamento inicial ao abrir uma OS, lê os orçamentos, repassa a decisão do Cliente da Oficina e reage às mensagens que ele publica quando um orçamento muda de status. O Inventory é dono do catálogo de serviços e peças e do estoque: a API REST lê nele os dados de exibição dos itens e reserva o estoque na aprovação de orçamento. O Identity é dono dos usuários e das credenciais: emite o token de funcionário que a API REST valida com a chave pública, e a API REST lê nele o mecânico atribuído, os autores do histórico e os usuários vinculados a um cliente, confere o mecânico antes de gravar e cria o usuário de acesso de um cliente. A API REST não envia e-mail: grava os e-mails ao cliente como mensagens no outbox, e a Lambda **Notificação** os recebe da fila `notification.fifo` e os entrega ao Servidor SMTP. É neste nível que aparecem **tecnologia e protocolo** nas setas, como recomendado. O relay do outbox e o consumidor da fila rodam dentro do processo da API, sem worker separado; o Job de migração do Kubernetes reutiliza a mesma imagem da API e por isso não é modelado como container à parte.

| Container | Tecnologia | Responsabilidade |
|---|---|---|
| **API Gateway** | AWS HTTP API | Entrada pública; encaminha `/customer-auth/login` à Lambda, `/api/services` (exceto as métricas, `/api/services/{id}/metrics`, que ficam na API REST), `/api/parts-supplies`, `/api/stock-movements` e `/api/stock-reservations` ao Inventory, `/api/quotes`, `/api/work-orders/{id}/quotes`, `/api/payments` e `/webhooks/mercadopago` ao Billing, `/api/auth`, `/api/users` (exceto `/api/users/{userId}/customers`, que fica na API REST), `/api/me` e `/api/me/password` ao Identity e o restante de `/api/{proxy+}` à API REST, pelo VPC Link e pelo NLB interno |
| **API REST** | NestJS 12 · Node.js 24 · TypeScript no EKS | Expõe `/api`, concentra a lógica de negócio em Clean Architecture e publica os e-mails ao cliente como mensagens |
| **Customer Auth** | AWS Lambda · Node.js 24 | Valida CPF, senha e status e emite `customer-jwt` RS256 |
| **Notificação** | AWS Lambda · Node.js 24 | Recebe os e-mails da fila `notification.fifo` e os envia por SMTP; repositório [`oficina-mecanica-lambda-notification`](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-notification) |
| **Banco de Dados** | PostgreSQL 18 (Amazon RDS) | Armazena as entidades de negócio da API (clientes, veículos, ordens de serviço e os vínculos de acesso, com o id do usuário do Identity), o estado das Sagas e o outbox das mensagens; serviço **gerenciado, fora do cluster**, alcançado pela rede a partir das subnets privadas |
| **Cache** | Valkey 9.1 (Amazon ElastiCache) | Guarda o detalhe das ordens de serviço (cache-aside, TTL de 12 h); serviço gerenciado, fora do cluster, com TLS e senha |
| **Mensageria** | Amazon SNS + SQS FIFO | Tópico `oficina-events.fifo` e filas `work-order.fifo`, `inventory.fifo`, `billing.fifo` e `notification.fifo`, cada uma com a sua DLQ (fila de mensagens que falharam), para as mensagens entre os serviços da oficina e os e-mails |
| **Coleta de Telemetria** | Datadog Agent no EKS | Coleta `stdout`, kubelet e OTLP da API e envia a telemetria ao Datadog |
| **Billing** | Serviço externo · NestJS 12 no EKS | Dono dos orçamentos e dos pagamentos; atende a API REST pelas rotas `/internal/quotes` e `/internal/work-orders/:id/balance` e `/payments`, recebe pela fila `billing.fifo` o pedido de desfazer uma aprovação e o de cancelar uma cobrança, e publica os eventos de orçamento e de cobrança que a API REST consome |
| **Inventory** | Serviço externo · NestJS 12 no EKS | Dono do catálogo de serviços e peças e do estoque, com a reserva por OS; atende a API REST pelas rotas `/internal` e os comandos de estoque pela fila `inventory.fifo` |
| **Identity** | Serviço externo · NestJS 12 no EKS | Dono dos usuários e das credenciais; faz o login e emite o token de funcionário, atende a API REST por `GET /internal/users/:id` e `POST /internal/customer-users` e lê nela `GET /internal/users/:userId/customers` |
| **Servidor SMTP** | MailHog (externo) | Recebe da Notificação os e-mails ao cliente (servidor SMTP de teste, que guarda os e-mails sem entregá-los) |
| **Datadog** | Serviço externo | Apresenta dashboards, alertas, logs, métricas e traces |

Os protocolos nas setas: os atores entram por **HTTPS** no API Gateway; a autenticação de cliente usa integração **AWS_PROXY** com a Lambda; a API segue por **VPC Link → NLB interno → NodePort**; API e Lambda acessam o RDS por **SQL/TLS**; a API acessa o ElastiCache por **RESP sobre TLS**, o Billing, o Inventory e o Identity por **HTTP/JSON** nas rotas `/internal` e o SNS e o SQS por **HTTPS** (AWS SDK), como o Billing e o Inventory; a Notificação recebe os e-mails da fila por **event source mapping** (a própria AWS lê a fila e invoca a função com as mensagens) e os envia por **SMTP**; a API emite telemetria por `stdout` e **OTLP**. A estratégia Passport externa (`customer-jwt`, RS256) permanece separada da usada pelos funcionários (`jwt`, RS256 com outra chave, emissor e audiência, emitido pelo Identity).

## Nível 3 — Componente da API REST

O zoom mais interno: as peças que compõem o container **API REST**.

<p align="center"><img src="images/c4-component.png" alt="Diagrama de Componente C4 da API REST: oito módulos de negócio (Minha Conta, Clientes, Veículos, Serviços, Ordens de Serviço, Orçamentos, Cobranças e Rotas Internas) e cinco componentes transversais (Guards/Segurança, Repositories, Cache, Mensageria e Gateways); Ordens de Serviço cria e apaga o orçamento inicial, lê o saldo na entrega e confere o mecânico pelos Gateways; Clientes cria o usuário de acesso e lê os usuários vinculados pelos Gateways; a Mensageria entrega aos Orçamentos as mensagens do Billing e as respostas da reserva de estoque, e os Orçamentos movem a OS, leem o orçamento aprovado e os destinatários dos e-mails pelos Gateways, invalidam o Cache e gravam o e-mail ao cliente no outbox; a Mensageria entrega às Cobranças as mensagens de cobrança do Billing, e as Cobranças bloqueiam e devolvem a OS, leem os destinatários pelos Gateways, invalidam o Cache e gravam no outbox o e-mail com o link de pagamento; Minha Conta lê e decide orçamentos e lê cobranças pelos Gateways; os Gateways chamam as rotas /internal do Billing, do Inventory e do Identity; Serviços lê o catálogo pelos Gateways; o Cliente da Oficina passa por Guards/Segurança até Minha Conta; o Billing e o Identity chamam as Rotas Internas; Repositories, Cache e Mensageria usam o PostgreSQL, o ElastiCache e o SNS/SQS FIFO, por onde os e-mails seguem à Notificação" width="100%"></p>

São **oito módulos de negócio** (Minha Conta, Clientes, Veículos, Serviços, Ordens de Serviço, Orçamentos, Cobranças e Rotas Internas) e **cinco componentes transversais** (Guards / Segurança, Repositories, Cache, Mensageria e Gateways), com as dependências reais entre módulos levantadas no código. Destaques do fluxo: **Ordens de Serviço** abre a OS com o orçamento inicial criado no **Billing**, o serviço dono dos orçamentos, pelos **Gateways**, e o apaga se a gravação da OS falha (a Saga de abertura, ver [Arquitetura](../architecture.md#saga-de-abertura)); pelos mesmos **Gateways**, confere no **Identity**, o serviço dono dos usuários, o mecânico atribuído antes de gravar e lê nele o mecânico e os autores do histórico para as respostas; **Clientes** pede ao Identity o usuário de acesso de um cliente e lê os usuários vinculados; **Orçamentos** não tem rota HTTP: a **Mensageria** entrega a ele as mensagens do Billing (orçamento enviado, rejeitado, aprovado e aprovação desfeita) e as respostas da reserva de estoque do **Inventory**, e ele move a OS, conduz a Saga de aprovação (ver [Arquitetura](../architecture.md#aprovação-de-orçamento-com-reserva-de-estoque)), lê o orçamento aprovado pelos **Gateways** e grava no outbox, pelos **Repositories**, o e-mail aos usuários vinculados, lidos no Identity pelos **Gateways** (a **Mensageria** o publica, e a Notificação, a função Lambda de e-mail da solução, o envia); **Cobranças** também não tem rota HTTP: recebe da **Mensageria** as mensagens de cobrança do Billing (cobrança criada, paga ou não paga), conduz a Saga de cobrança (ver [Arquitetura](../architecture.md#saga-de-cobrança)), bloqueia a OS enquanto o cliente paga e a devolve ao status de antes, e grava no outbox o e-mail com o link de pagamento; o **Cliente da Oficina** apresenta o `customer-jwt` ao componente **Guards / Segurança**, que o vincula ao módulo **Minha Conta**, que lê e decide os orçamentos e lê as cobranças no Billing pelos **Gateways**; o **Billing** lê a OS e o **Identity** lê os clientes vinculados a um usuário pelas **Rotas Internas**; e **Ordens de Serviço**, **Orçamentos** e **Cobranças** leem ou invalidam o detalhe da OS no **Cache**.

As dependências de quase todos os módulos em relação a **Guards / Segurança** e **Repositories**, e as de **Clientes** e **Veículos** em relação ao **Cache**, estão descritas no texto desses componentes, e **não desenhadas como setas** — isso evita cerca de 18 setas repetidas que poluiriam o diagrama sem agregar informação. A gravação dos e-mails ao cliente no outbox por **Orçamentos** e **Cobranças** também passa por **Repositories** e está no texto desses dois componentes. Como no exemplo oficial (Figura 3 do material da aula), as setas entre componentes do mesmo container não levam rótulo de tecnologia; a tecnologia aparece somente nas relações que cruzam a fronteira da API, como cliente, Banco de Dados, Cache Distribuído, Mensageria AWS, Billing, Inventory e Identity.

**Módulos de negócio**

| Componente | Tecnologia | Responsabilidade |
|---|---|---|
| **Clientes** | NestJS Module | CRUD de clientes (pessoa física/jurídica) e acesso externo: concessão e revogação de vínculos com usuários do Identity, listagens de vínculos e ativação do cliente |
| **Veículos** | NestJS Module | CRUD de veículos e listagem de veículos por cliente |
| **Serviços** | NestJS Module | Métricas por serviço sobre os itens executados (`GET /services/:id/metrics`); o catálogo de serviços é do Inventory |
| **Ordens de Serviço** | NestJS Module | Abertura com o orçamento inicial no Billing (Saga de abertura), gestão de ordens de serviço, status, histórico e execução dos itens; ao iniciar a execução de uma OS com peças, pede ao Inventory a baixa da reserva; antes da entrega, confere no Billing que o saldo é zero; confere no Identity o mecânico atribuído |
| **Orçamentos** | NestJS Module | Handlers das mensagens de orçamento, sem rota HTTP: o envio leva a OS a aguardar aprovação e grava no outbox o e-mail ao cliente, a rejeição devolve a OS, e a aprovação roda a Saga de aprovação com reserva de estoque no Inventory, desfeita no Billing quando falta estoque, com o e-mail ao cliente gravado no outbox |
| **Cobranças** | NestJS Module | Handlers das mensagens de cobrança, sem rota HTTP: a Saga de cobrança leva a OS a `AWAITING_PAYMENT` e grava no outbox o e-mail com o link quando o Billing cria uma cobrança, devolve a OS ao status de antes quando a cobrança é paga, expira, é recusada ou cancelada, e pede ao Billing o cancelamento quando a OS já não podia ser cobrada |
| **Minha Conta** | NestJS Module | Rotas autenticadas do usuário externo: ordens vinculadas e os orçamentos e as cobranças delas, lidos no Billing (os orçamentos também decididos lá); o perfil e a troca de senha ficam no Identity |
| **Rotas Internas** | NestJS Module | Rotas `/internal` para os outros serviços, sem token e fora do prefixo `/api`; delegam ao Clean Controller existente (`GET /internal/work-orders/:id`, lido pelo Billing, e `GET /internal/users/:userId/customers`, lido pelo Identity) |

**Componentes transversais**

| Componente | Tecnologia | Responsabilidade |
|---|---|---|
| **Guards / Segurança** | NestJS Guards | `AuthenticationGuard` global que nega por padrão (token de funcionário, salvo `@Public()` ou `@CustomerArea()`), `RolesGuard` (RBAC interno) e as estratégias separadas `jwt` (RS256, funcionário, validado só pela assinatura e pelas claims, sem ler o usuário) e `customer-jwt` (RS256, com a conferência do vínculo com cliente ativo) |
| **Repositories** | Prisma | Acesso a dados centralizado e global; todos os módulos de negócio persistem através dele, com o outbox gravado no mesmo Unit of Work |
| **Cache** | NestJS Module · ioredis | Cache-aside do detalhe da OS no Valkey; invalidado depois do commit pelas escritas em OS, orçamentos, cobranças, clientes e veículos |
| **Mensageria** | NestJS Module · AWS SDK | Relay do outbox para o SNS FIFO, inclusive os e-mails ao cliente (`notification.email.send`), e consumidor da fila SQS `work-order.fifo`, com o span `CONSUMER` e os handlers das mensagens do Billing (`billing.quote.sent`, `billing.quote.rejected`, `billing.quote.approved` e `billing.quote.approval_reverted`), das cobranças (`billing.payment.requested`, `billing.payment.approved` e `billing.payment.failed`) e das respostas da reserva de estoque (`inventory.stock.reserved` e `inventory.stock.reservation_failed`) |
| **Gateways** | @nestjs/axios | `HttpBillingQuotesGateway`, `HttpBillingPaymentsGateway`, `HttpInventoryCatalogGateway` e `HttpIdentityUsersGateway` sobre o `InternalHttpClient`: criam, leem, apagam e decidem orçamentos e leem o saldo e as cobranças da OS nas rotas `/internal` do Billing, leem serviços e peças nas do Inventory e leem usuários (`GET /internal/users/:id`) e criam o usuário de acesso de um cliente (`POST /internal/customer-users`) nas do Identity, com prazo de 2 s (5 s nas chamadas que o Billing só responde depois de ler o Inventory), `x-request-id` e `traceparent` |

## Documentação relacionada

- 🏛️ [Arquitetura](../architecture.md) — Clean Architecture, DDD, ciclos de vida, Unit of Work, exceções.
- 🏗️ [Infra · Visão Geral](../infra/overview.md) — a infraestrutura como sistema (inclui as vistas de deployment).
- 📈 [Observabilidade](../observability.md) — logs, métricas, traces, dashboards e alertas.
- 📐 [ADRs](../adr) — decisões arquiteturais.
- 🌐 [c4model.com](https://c4model.com) — referência oficial do modelo C4.
