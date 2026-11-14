<div align="center">

# 🔧 Work Order Service

**Sistema Integrado de Atendimento e Execução de Serviços para oficinas mecânicas** — ordens de serviço, clientes e veículos, com os orçamentos no serviço Billing, o catálogo de serviços e peças e o estoque no serviço Inventory e os usuários lidos no serviço Identity.

![Node](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Cobertura unitária](https://img.shields.io/badge/cobertura-100%25-brightgreen)

</div>

## 📋 Sobre

Projeto acadêmico da pós-graduação em Arquitetura de Software da FIAP (turma 15SOAT), **evoluído ao longo de 5 fases**. Cada fase parte de um novo cenário de negócio e adiciona uma camada de maturidade, do MVP de domínio à infraestrutura escalável.
Atualmente composto pela API, pelos serviços de entrada e autenticação, pela infraestrutura AWS e pela observabilidade da solução.

Trata-se de uma API REST para gestão de oficinas mecânicas, construída com **NestJS** e **Clean Architecture + DDD**.
Substitui o controle manual (anotações e planilhas) de uma oficina de médio porte por um **Sistema Integrado de Atendimento e Execução de Serviços** — do recebimento do veículo à entrega, com orçamento, aprovação do cliente, reserva e baixa de estoque e execução orquestrados pelo domínio, contemplando:

- **Ordens de serviço** com máquina de estados validada no domínio
- **Orçamentos no Billing**, o serviço dono dos orçamentos e dos pagamentos: a OS com itens nasce com o orçamento inicial criado lá (**Saga de abertura**, que apaga o orçamento se a gravação da OS falhar), o envio e a rejeição chegam por mensagem e movem a OS, e o **Cliente da Oficina autenticado** consulta e decide os orçamentos pela área dele (ver [Autenticação](#-autenticação))
- **Reserva de estoque pela Saga de aprovação**: um orçamento aprovado no Billing com peças pede a reserva ao Inventory, o serviço dono do catálogo e do estoque; a OS vai a `APPROVED` quando a reserva é confirmada, e, quando falta estoque, a aprovação é desfeita no Billing e o cliente recebe um e-mail. A baixa é pedida ao Inventory no início do primeiro serviço
- **Cobrança pela Saga de cobrança**: quando o funcionário cria uma cobrança no Billing (um sinal com a OS aprovada, ou o restante com a OS concluída), a OS fica em `AWAITING_PAYMENT`, com a execução, a entrega e o cancelamento bloqueados, e o cliente recebe por e-mail o link de pagamento do Mercado Pago; paga, expirada, recusada ou cancelada, a cobrança devolve a OS ao status de antes. A entrega exige saldo zero no Billing, e o cliente vê as cobranças das OS dele na área própria
- **Autorização por papéis (RBAC)**: `ADMIN`, `MECHANIC`, `ATTENDANT`
- **Dois fluxos de autenticação JWT isolados**, os dois validados aqui só pela chave pública: interno (RS256, emitido pelo Identity, o serviço da solução dono dos usuários e das credenciais) e externo por CPF + senha (RS256, emitido por uma função serverless dedicada)
- **Usuários no Identity**: a OS, o histórico e os vínculos de acesso guardam só o id do usuário; o mecânico é conferido no Identity antes de ser atribuído, e nome, e-mail e papel são lidos nele a cada resposta
- **E-mails ao cliente por mensagem**: o orçamento enviado, o link de pagamento e o aviso de falta de estoque saem como a mensagem `notification.email.send`, gravada no outbox (a tabela das mensagens a publicar) na mesma transação da OS, uma por destinatário; quem envia o e-mail é a função serverless de notificação da solução. Os destinatários são os usuários ativos vinculados ao cliente, lidos no Identity, ou, sem nenhum, o e-mail do próprio cliente
- **Concorrência otimista** (lock por `version`) em agregados sensíveis

<details>
<summary><strong>Fase 1 — MVP: Gestão de Ordens de Serviço com DDD</strong></summary>

**Problema:** Uma oficina de médio porte conduzia o atendimento, o diagnóstico, a execução e a entrega dos veículos de forma desorganizada, apoiada em anotações manuais e planilhas — o que gerava erros na priorização dos atendimentos, falhas no controle de peças e insumos, dificuldade em acompanhar o status dos serviços, perda de histórico de clientes e veículos e ineficiência no fluxo de orçamentos e autorizações.

**Objetivo:** Entregar a primeira versão (MVP) do back-end do Sistema Integrado de Atendimento e Execução de Serviços.

**Proposta:** Construir o back-end com foco em gestão de ordens de serviço, clientes e peças, aplicando Domain-Driven Design (DDD) e boas práticas de qualidade de software e segurança.

**Requisitos:**

- Back-end monolítico em arquitetura em camadas;
- APIs RESTful documentadas via Swagger;
- Banco de dados à escolha, com justificativa (ver [ADR 0001](docs/adr/0001-uso-do-postgresql-como-banco-de-dados.md));
- `Dockerfile` e `docker-compose.yml` orquestrando o ambiente completo;
- Testes automatizados com cobertura mínima de 80% nos domínios críticos;
- Autenticação JWT e validação de dados sensíveis (CPF/CNPJ, placa).

🎥 **Demonstração:** [vídeo da Fase 1 (Google Drive)](https://drive.google.com/file/d/10DaHvGB_qMzGzi8Qty3tGAaExQTSPQ1h/view?usp=sharing)

</details>

<details>
<summary><strong>Fase 2 — Qualidade, Resiliência e Escalabilidade</strong></summary>

**Problema:** Com o sucesso do MVP vieram o aumento da demanda, a expansão para novas unidades e a necessidade de garantir alta disponibilidade. A oficina precisa reduzir riscos operacionais, automatizar o provisionamento e o deploy do ambiente e sustentar grandes volumes de ordens de serviço em horários de pico, com escalabilidade dinâmica.

**Objetivo:** Evoluir a aplicação da Fase 1 para garantir qualidade, resiliência e escalabilidade, incorporando práticas modernas de infraestrutura e automação.

**Proposta:** Refatorar o código sob Clean Code e Clean Architecture e sustentar a aplicação com containerização, orquestração em Kubernetes, infraestrutura como código e uma pipeline de CI/CD.

**Requisitos:**

- Refatoração com Clean Code e Clean Architecture, com testes automatizados cobrindo os fluxos críticos;
- APIs de abertura de OS, consulta de status, aprovação de orçamento por notificação externa, listagem ordenada por status (excluindo logicamente as finalizadas e entregues) e atualização de status por e-mail;
- Containerização com Docker e `docker-compose` para desenvolvimento local;
- Orquestração em Kubernetes: Deployments, Services, ConfigMaps e Secrets, e Horizontal Pod Autoscaler (HPA);
- Infraestrutura como Código (IaC) com Terraform, provisionando o cluster Kubernetes e o banco de dados;
- Pipeline de CI/CD: build, testes, imagem Docker, deploy no cluster e aplicação dos manifestos.

🎥 **Demonstração:** [vídeo da Fase 2 (YouTube)](https://youtu.be/9s8oesicepc)

</details>

### Fase 3 — Segurança, Escalabilidade e Observabilidade

**Desafio:** A expansão da oficina para múltiplas unidades e o crescimento contínuo da base de clientes exigiram segurança, escalabilidade, alta disponibilidade e visibilidade completa do funcionamento do sistema. A direção precisava controlar acessos e autenticações com segurança, detectar gargalos em tempo real, adotar soluções serverless para autenticação e notificações, separar a aplicação em repositórios organizados com CI/CD completo e melhorar a modelagem relacional para garantir consistência e desempenho.

**Objetivo:** Elevar a aplicação a um nível de operação corporativa por meio de práticas de cloud, infraestrutura como código, segurança e observabilidade.

**Requisitos obrigatórios:**

- Um API Gateway para controle e roteamento, rotas sensíveis protegidas por autenticação via CPF e uma Function Serverless responsável por validar o CPF, consultar a existência e o status do cliente no banco e devolver um JWT válido;
- Quatro repositórios mínimos — Function Serverless, infraestrutura Kubernetes, infraestrutura do banco gerenciado e aplicação no Kubernetes —, cada um com CI/CD e deploy automático; branch principal protegida, merge por Pull Request e deploy das branches de homologação e produção;
- Banco de dados gerenciado, cluster Kubernetes escalável e recursos provisionados com Terraform;
- Integração com Datadog ou New Relic para observar latência das APIs, CPU/memória do Kubernetes, health checks, uptime, falhas no processamento de ordens de serviço e logs JSON correlacionados;
- Dashboards de volume diário de ordens de serviço, tempo médio por status e erros/falhas nas integrações;
- Documentação arquitetural com diagrama de componentes da solução, diagramas de sequência de autenticação e abertura de ordem de serviço, RFCs/ADRs para decisões relevantes e justificativa do banco acompanhada de modelo ER.

**Estado atual da solução:** O escopo está implementado com AWS API Gateway, Lambda de autenticação por CPF emitindo JWT RS256, Amazon EKS, Amazon RDS PostgreSQL, Terraform e pipelines especializados. Os sete componentes vigentes estão listados em [Ecossistema de Repositórios](#-ecossistema-de-repositórios). A observabilidade usa logs estruturados, OpenTelemetry e Datadog; dashboards e alertas são declarados em Terraform nesta solução.

## 🧭 Do PDF ao desenho

O enunciado da fase (o PDF do desafio) pede o padrão **Saga** para "criação de ordens de serviço, aprovações e pagamentos", com o exemplo "abrir a OS → gerar orçamento → aguardar aprovação → enviar para execução" e "rollback e compensação no caso de falha em qualquer etapa". Uma Saga coordena uma operação que grava em mais de um serviço, cada um com o próprio banco, sem transação distribuída: é uma sequência de transações locais em que a falha de um passo dispara uma **compensação** que desfaz o que os passos anteriores gravaram. Ela só é necessária quando um passo pode falhar **depois** que outro serviço já gravou, e esse outro serviço precisa desfazer o que gravou. Este serviço, o work-order, guarda as ordens de serviço (OS); o Billing guarda orçamentos e pagamentos, e o Inventory, o catálogo e o estoque. Cada etapa do exemplo ficou assim:

| Etapa | Como fica consistente | Se falhar |
|---|---|---|
| Abrir a OS com o orçamento inicial | **Saga de abertura**, dentro da requisição: com itens, o work-order cria o orçamento no Billing (que confere os itens no Inventory) **antes** de gravar a OS | Item inválido ou serviço fora do ar: nada é gravado (4xx ou 503). Se a gravação da OS falhar depois, o orçamento é apagado no Billing |
| Gerar e enviar o orçamento | Transação no Billing e a mensagem `billing.quote.sent`, que leva a OS a `AWAITING_APPROVAL` | Erro imediato ao funcionário; nada muda |
| Aguardar a aprovação | A OS em `AWAITING_APPROVAL` | Rejeição: a OS vai a `REJECTED`, e um novo orçamento é possível |
| Aprovar e reservar o estoque | **Saga de aprovação**: o Billing aprova, o work-order pede a reserva ao Inventory e só então leva a OS a `APPROVED` | Falta de estoque: a aprovação é desfeita no Billing, e o orçamento volta a aguardar o cliente |
| Pagar (sinal opcional; quitação antes da entrega) | **Saga de cobrança**: o Billing cria a cobrança, e o work-order bloqueia a OS em `AWAITING_PAYMENT` até o pagamento terminar | OS que mudou de status no intervalo: a cobrança é cancelada no Billing. Cobrança expirada, recusada ou cancelada: a OS volta ao status de antes |
| Enviar para execução | Transação no work-order e o comando `inventory.stock.consume`, que pede a baixa do estoque | Falha na baixa: nova entrega pela fila, DLQ (fila de mensagens que falharam) e alerta. A OS não volta: é um passo de repetir, não de desfazer |
| Executar e entregar | Transação no work-order; a entrega confere no Billing que o saldo é zero | Saldo a pagar: 409, e a OS segue concluída |

**Por que três Sagas, e não uma para o ciclo inteiro.** Cada uma cobre um ponto em que dois serviços gravam e um deles pode precisar desfazer. As outras etapas são locais ou só propagam um fato que outro serviço já decidiu, sem nada a desfazer. Uma Saga única faria do status da OS uma máquina de orquestração, com mensagem e espera em todos os passos, inclusive nos que hoje são cliques síncronos.

**Por que orquestradas no work-order.** O work-order decide cada passo e cada compensação num lugar só; o Billing e o Inventory só recebem comandos e respondem com eventos, sem conhecer a Saga. Na alternativa coreografada, cada serviço reagiria aos eventos dos outros, e a lógica e a ordem das compensações ficariam espalhadas por três serviços. O orquestrador fica dentro do work-order porque o estado da Saga muda na mesma transação da OS e da mensagem gravada no outbox (a tabela das mensagens a publicar).

**Onde mora o estado.** As Sagas de aprovação e de cobrança esperam a resposta de outro serviço, às vezes em outra réplica ou depois de um reinício, então o estado delas fica na tabela `saga_instances`: o tipo, a OS, o id do orçamento ou da cobrança no Billing (único por tipo, o que torna inofensivas as mensagens repetidas), o status, o motivo da compensação e, na cobrança, o status de origem da OS. A Saga de abertura não tem linha: começa e termina numa requisição.

**Ciclo da OS.** `RECEIVED` → `IN_DIAGNOSIS` → `AWAITING_APPROVAL` → `APPROVED` → `IN_PROGRESS` → `COMPLETED` → `DELIVERED`, com `REJECTED` (o orçamento enviado foi rejeitado; um novo orçamento volta a `AWAITING_APPROVAL`) e `CANCELLED` (até a aprovação). `AWAITING_PAYMENT` entra entre `APPROVED` e `IN_PROGRESS` quando há sinal, ou entre `COMPLETED` e `DELIVERED` quando há cobrança do restante, e a OS sempre volta ao status de onde saiu. A tabela de transições e as regras estão em [Arquitetura › Ciclo de vida da Ordem de Serviço](docs/architecture.md#ciclo-de-vida-da-ordem-de-serviço); as Sagas, em [Arquitetura › Saga de cobrança](docs/architecture.md#saga-de-cobrança) e nas seções vizinhas; a decisão e as alternativas descartadas, no [ADR 0025](docs/adr/0025-sagas-orquestradas-no-work-order.md); e os testes de cada cenário de falha, em [Testes › Cenários de falha F1 a F14](docs/testing.md#cenários-de-falha-f1-a-f14).

## 🧰 Stack

- **Runtime**: Node.js 24 + TypeScript 6
- **Framework**: NestJS 12
- **ORM**: Prisma 7.10 (driver `@prisma/adapter-pg`, client gerado em `prisma/generated/`)
- **Banco de dados**: PostgreSQL 18
- **Mensageria**: Amazon SNS FIFO + SQS FIFO (`@aws-sdk/client-sns`, `@aws-sdk/client-sqs`, `sqs-consumer`), com outbox transacional no PostgreSQL; LocalStack 4.14 em desenvolvimento
- **Cache**: Valkey 9.1 (Amazon ElastiCache no cluster) via `ioredis`, cache-aside no detalhe da OS
- **Chamadas internas**: REST entre serviços pela rede do cluster, com `@nestjs/axios`
- **Autenticação**: dois fluxos JWT isolados via `passport-jwt`, só com as chaves públicas — interno (RS256, emitido pelo Identity) e externo por CPF + senha (RS256, emitido por uma função serverless dedicada) — ver [Autenticação](#-autenticação)
- **E-mail**: nenhum cliente SMTP neste serviço; os e-mails saem como mensagens `notification.email.send` pelo SNS e são enviados pela [função serverless de notificação](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-notification)
- **Segurança HTTP**: Helmet, CORS configurável via `ALLOWED_ORIGINS`, `SanitizeStringsPipe` global, `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`)
- **Observabilidade**: logs estruturados em JSON no stdout com `pino` + `nestjs-pino` (nomenclatura OpenTelemetry, correlação por `request.id`, redação de dados sensíveis) — ver [ADR 0002](docs/adr/0002-logging-estruturado.md)
- **Telemetria**: traces e métricas de negócio pelo SDK do OpenTelemetry, correlacionados ao log por `trace_id`, sem nenhuma dependência ou credencial de fornecedor na aplicação; desligada por padrão (endpoint vazio) — ver [ADR 0005](docs/adr/0005-opentelemetry.md)
- **Health checks**: endpoints dedicados de vivacidade (`/api/health/live`) e prontidão (`/api/health/ready`), consumidos pelas três probes do Kubernetes, com encerramento gracioso — ver [ADR 0003](docs/adr/0003-health-checks.md)
- **Documentação**: Swagger/OpenAPI (`@nestjs/swagger`) — disponível em `/api/docs`
- **Testes**: Jest 30 + ts-jest (unitários com mocks tipados e E2E com **Testcontainers 12** + PostgreSQL 18, Valkey e LocalStack reais) e BDD com `@cucumber/cucumber` 13.3 (cenários em Gherkin pt-BR do fluxo completo da OS e das compensações das Sagas)
- **Qualidade**: SonarQube Cloud (Sonar Scan via GitHub Actions)
- **Análise de segurança**: OWASP ZAP (DAST) e SonarQube (SAST/qualidade) — relatórios em `reports/`
- **Containerização**: Docker (multi-stage `node:24-alpine`) + Docker Compose
- **Linting**: ESLint 9 + Prettier 3

## ✅ Pré-requisitos

- **Node.js 24.9+** e **npm** (apenas para o setup local); para os comandos de geração do CLI (`nest generate`, `nest upgrade`), **24.15+**, que é o mínimo do `@nestjs/schematics` 12 (abaixo disso o `npm ci` avisa `EBADENGINE`)
- **Docker** + **Docker Compose** (recomendado para subir todos os serviços)
- **Git**

## 🚀 Quick Start

Esse modo sobe todos os serviços — PostgreSQL, Valkey, LocalStack (SNS e SQS) e API — em containers. As migrations são executadas automaticamente e o banco é populado com o seed.

```bash
# Clonar o repositório e entrar na pasta da aplicação
git clone https://github.com/FIAP-15SOAT/oficina-mecanica-work-order-service.git
cd oficina-mecanica-work-order-service/app

# Criar o .env e copiar a chave pública do token de funcionário do .env do Identity local
# (o Identity assina o token; este serviço só o valida). Ajuste o caminho do clone do Identity.
cp .env.example .env
grep '^STAFF_JWT_PUBLIC_KEY=' ../../oficina-mecanica-identity-service/app/.env >> .env

# Subir todos os serviços em background e esperar que fiquem saudáveis
docker compose up -d --build --wait
```

Após a inicialização:

- **API:** `http://localhost:3000`
- **Swagger:** `http://localhost:3000/api/docs`
- **LocalStack (SNS/SQS):** `http://localhost:4566`

> As rotas que mostram ou gravam itens da OS leem o catálogo no Inventory, o serviço dono de serviços, peças e estoque, e a abertura de OS com itens e os orçamentos da área do cliente chamam o Billing, o serviço dono dos orçamentos. Suba também as stacks locais do [`oficina-mecanica-inventory-service`](https://github.com/FIAP-15SOAT/oficina-mecanica-inventory-service) (API em `http://localhost:3003`) e do [`oficina-mecanica-billing-service`](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service) (API em `http://localhost:3002`); sem elas, essas rotas respondem 503. Ver [Como executar localmente › Inventory local](docs/local-setup.md#inventory-local) e [Billing local](docs/local-setup.md#billing-local).

> O login, os usuários e o mecânico das OS ficam no Identity, o serviço dono dos usuários e das credenciais. Suba também a stack local do [`oficina-mecanica-identity-service`](https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service) (API em `http://localhost:3001`) antes desta: é nela que se faz o login, e sem ela as rotas que mostram ou conferem usuários (OS, histórico e acesso de clientes) respondem 503. Ver [Como executar localmente › Identity local](docs/local-setup.md#identity-local).

```bash
# Acompanhar os logs da API em tempo real
docker compose logs -f api

# Conferir que o processo responde: 200 {"status":"ok"}
curl -i http://localhost:3000/api/health/live

# Conferir que o banco também está acessível: 200 {"status":"ok"}
curl -i http://localhost:3000/api/health/ready

# Parar e remover os containers
docker compose down
```

> O `Dockerfile` é multi-stage (`node:24-alpine` builder + runtime), executa `prisma generate` no build e tem `CMD ["node", "--require", "./dist/src/otel.js", "dist/src/main"]` — **só a aplicação**. O `--require` carrega o preload do OpenTelemetry **antes** de `express` e `pg` serem importados, que é a única ordem em que a instrumentação consegue aplicar o patch; sem `OTEL_EXPORTER_OTLP_ENDPOINT` ele retorna cedo e não carrega nada (ver [ADR 0005](docs/adr/0005-opentelemetry.md)). Em produção, o CD obtém esse valor de `vars.OTEL_EXPORTER_OTLP_ENDPOINT`, renderiza e aplica o ConfigMap; o `app-deploy` aplica o Deployment com a imagem do commit e aguarda o rollout corrente, sem executar `rollout restart`. Valor vazio mantém o SDK desligado. A migração e o seed rodam num passo próprio: o serviço `migrate` do Compose localmente, e o Job `k8s/00-db-migrate-job.yaml` no CD.

> Em produção, a credencial do PostgreSQL não vem do GitHub. O job `prepare-deploy` do CD usa `vars.RDS_INSTANCE_IDENTIFIER` para descobrir o Secret gerenciado pelo RDS, lê `AWSCURRENT` e materializa `DATABASE_URL` com encoding/TLS em `database-credentials`, usando Node.js inline e stdin. Também descobre o ElastiCache por `vars.CACHE_REPLICATION_GROUP_ID` e materializa `CACHE_URL` (`rediss://`) em `cache-credentials`. Depois, `db-migrate` executa migration/seed e `app-deploy` aplica a imagem no namespace `work-order`, aguarda o rollout e faz o smoke `GET /health/work-order` pelo API Gateway, com `kubectl rollout undo` na falha. Job e Deployment consomem o mesmo Secret do banco; `jwt-public-keys` guarda as chaves públicas dos tokens e o `kid`, e o serviço não tem chave privada. O escopo é deploy greenfield, com rotação desabilitada e sem annotation/output de versão da credencial. Veja o [ADR 0017](docs/adr/0017-materializacao-da-credencial-do-banco-no-cd.md).

> **Para testar:** faça login no Identity local, em `POST http://localhost:3001/api/auth/login`, com um admin do seed dele (veja os usuários em [Como executar localmente › Seed](docs/local-setup.md#seed)), e use o `accessToken` aqui. Para explorar os endpoints, use o **Swagger** em `/api/docs` ou importe a **collection do Postman** (`collections/oficina-collection.json` + `collections/oficina-environment.json`) — passo a passo em [Testes › Postman / Newman](docs/testing.md#postman--newman).

## ⚙️ Comandos

Execute todos os comandos a partir de `app/` (`cd app`) — não há `package.json` na raiz do repositório.

| Comando | Descrição |
|---|---|
| `npm run start` | Inicia a aplicação |
| `npm run start:dev` | Inicia em modo watch (hot reload) |
| `npm run start:prod` | Inicia em modo produção (`node --require ./dist/src/otel.js dist/src/main` — mesmo preload de telemetria do `CMD` da imagem) |
| `npm run build` | Compila o projeto |
| `npm run test` | Roda testes unitários |
| `npm run test:watch` | Testes em modo watch |
| `npm run test:cov` | Testes unitários com cobertura |
| `npm run test:e2e` | Roda testes E2E |
| `npm run test:e2e:cov` | Testes E2E com cobertura |
| `npm run test:bdd` | Testes de aceitação BDD (Cucumber), com o relatório em `app/reports/bdd/cucumber-report.html` — ver [Testes › BDD](docs/testing.md#bdd-testes-de-aceitação) |
| `npm run lint` | Linting com auto-fix |
| `npm run format` | Formata código com Prettier |
| `npm run prisma:generate` | Gera o Prisma Client (`app/prisma/generated/`) |
| `npm run prisma:migrate` | Cria/aplica migrations (dev) |
| `npm run prisma:migrate:prod` | Aplica migrations em produção (`migrate deploy`) |
| `npm run prisma:studio` | Abre o Prisma Studio (GUI do banco) |
| `npm run prisma:seed` | Popula o banco com dados iniciais |
| `npm run db:setup` | `migrate deploy` + `generate` + `seed` (primeiro setup) |
| `npm run db:reset` | Reseta o banco e re-executa o seed (apenas dev — bloqueado em `production` / `staging`) |

## 🏛️ Arquitetura

**Clean Architecture** com camadas estritas — as dependências apontam só para dentro. `domain/` e `application/` são livres de framework e ORM (uma cerca de ESLint quebra a build se `@nestjs/*` ou o client do Prisma vazarem para lá). Práticas de **DDD**: entidades ricas, value objects e o agregado `WorkOrder`, que protege invariantes. Os **Clean Controllers** e **Presenters** (POJOs) ficam em `interface-adapters/`; a borda NestJS (rotas, Swagger, guards) vive em `infrastructure/http/` e apenas delega.

➡️ Detalhes completos em **[Arquitetura](docs/architecture.md)**.

## 🔐 Autenticação

Dois fluxos de autenticação **totalmente isolados**: os dois são RS256, mas cada um tem sua chave pública, seu emissor e sua audiência, e cada estratégia fixa `algorithms: ['RS256']`. Um token de um fluxo nunca passa no verificador do outro, e um token HS256 ou sem assinatura nunca passa em nenhum:

| | Interno (funcionários) | Externo (Cliente da Oficina) |
|---|---|---|
| Quem | `ADMIN`, `MECHANIC`, `ATTENDANT` | Pessoa física dona do veículo, ou representante autorizado de uma empresa cliente |
| Como autentica | `POST /api/auth/login` (e-mail + senha) no **Identity**, o serviço da solução dono dos usuários | CPF + senha, verificados por uma **função serverless dedicada** que consulta o banco diretamente — nunca um proxy do login interno |
| Algoritmo / chave | JWT **RS256** — esta API só guarda a chave **pública** (`STAFF_JWT_PUBLIC_KEY`); as privadas do access e do refresh vivem no Identity | JWT **RS256** assimétrico — esta API só guarda a chave **pública** (`CUSTOMER_JWT_PUBLIC_KEY`); a privada vive na função serverless |
| Estratégia Passport | `jwt` (`JwtStrategy`) | `customer-jwt` (`CustomerJwtStrategy`) |
| Guard HTTP | `JwtAuthGuard`, o padrão do guard global (+ `RolesGuard` por papel) | `CustomerJwtAuthGuard` por `@CustomerArea()` |
| O que o token carrega | Access: cabeçalho com `kid` (`STAFF_JWT_KEY_ID`) e claims `sub` (userId), `email`, `name`, `role`, `typ = access`, `iss = oficina-identity`, `aud = oficina-services`, válido por 10 min; um refresh nunca é aceito como access. O principal sai das claims, sem ler o usuário: desativar o funcionário ou trocar a senha vale para esta API quando o access expira, em até 10 min | Só `sub` (userId) — **nunca** `customerId`. Autorização é resolvida por vínculo (`UserCustomer`) a cada requisição, então revogar acesso ou desativar o cliente vale imediatamente, sem lista de revogação de token; o usuário não é relido, e desativá-lo vale quando o token expira, em até 60 min |
| Superfície de rotas | Todas as rotas internas por perfil (ver matriz abaixo) | `/api/me/*` |

A função serverless de autenticação externa **não está neste repositório** — vive em [`oficina-mecanica-lambda-customer-auth`](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth). Ver [ADR 0004](docs/adr/0004-autenticacao-de-clientes.md) para o raciocínio completo por trás dessas decisões, e [docs/local-setup.md](docs/local-setup.md#variáveis-de-ambiente) para rodar os dois repositórios juntos localmente.

<details>
<summary><strong>Matriz completa de rotas e permissões</strong></summary>

| Rota | Marcação / guard | Acesso |
|---|---|---|
| `GET /api/me/work-orders` | `@CustomerArea()` (`CustomerJwtAuthGuard`) | `customer-jwt` |
| `GET /api/me/work-orders/:workOrderId` | `@CustomerArea()` (`CustomerJwtAuthGuard`) | `customer-jwt` |
| `GET /api/me/work-orders/:workOrderId/quotes` | `@CustomerArea()` (`CustomerJwtAuthGuard`) | `customer-jwt` |
| `GET /api/me/work-orders/:workOrderId/payments` | `@CustomerArea()` (`CustomerJwtAuthGuard`) | `customer-jwt` |
| `GET /api/me/quotes/:quoteId` | `@CustomerArea()` (`CustomerJwtAuthGuard`) | `customer-jwt` |
| `POST /api/me/quotes/:quoteId/decisions` | `@CustomerArea()` (`CustomerJwtAuthGuard`) | `customer-jwt` |
| `GET /api/users/:userId/customers` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `ATTENDANT` |
| `POST /api/customers` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `ATTENDANT` |
| `GET /api/customers` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `ATTENDANT` |
| `GET /api/customers/:id` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `ATTENDANT` |
| `GET /api/customers/:id/vehicles` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `ATTENDANT` |
| `PUT /api/customers/:id` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `ATTENDANT` |
| `DELETE /api/customers/:id` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `ATTENDANT` |
| `POST /api/customers/:customerId/users` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `ATTENDANT` |
| `GET /api/customers/:customerId/users` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `ATTENDANT` |
| `DELETE /api/customers/:customerId/users/:userId` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `ATTENDANT` |
| `PATCH /api/customers/:customerId` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `ATTENDANT` |
| `POST /api/vehicles` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `ATTENDANT` |
| `GET /api/vehicles` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `ATTENDANT` |
| `GET /api/vehicles/:id` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `ATTENDANT` |
| `PUT /api/vehicles/:id` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `ATTENDANT` |
| `DELETE /api/vehicles/:id` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `ATTENDANT` |
| `GET /api/services/:id/metrics` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN` |
| `GET /api/services-metrics` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN` |
| `POST /api/work-orders` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `ATTENDANT` |
| `GET /api/work-orders` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `MECHANIC`, `ATTENDANT` |
| `GET /api/work-orders/:id` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `MECHANIC`, `ATTENDANT` |
| `PUT /api/work-orders/:id` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `MECHANIC`, `ATTENDANT` |
| `PATCH /api/work-orders/:id` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `MECHANIC`, `ATTENDANT` |
| `PATCH /api/work-orders/:workOrderId/services/:serviceId` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `MECHANIC`, `ATTENDANT` |
| `GET /api/work-orders/:id/status-history` | padrão (`JwtAuthGuard`), `RolesGuard` | `ADMIN`, `MECHANIC`, `ATTENDANT` |
| `GET /api/health/live`, `GET /api/health/ready` | `@Public()` | Público |
| `GET /internal/work-orders/:id` | `@Public()` | Rede do cluster (fora do prefixo `/api`, não passa pelo API Gateway) |
| `GET /internal/users/:userId/customers` | `@Public()` | Rede do cluster (chamada pelo Identity) |

> A autenticação é negada por padrão: um guard global (`AuthenticationGuard`) exige o token de funcionário em toda rota sem marcação, `@Public()` dispensa o token e `@CustomerArea()` troca o token exigido. O `RolesGuard` restringe por papel depois dele.

> A decisão do cliente usa `POST /api/me/quotes/:quoteId/decisions`, com autenticação `customer-jwt` RS256; este serviço confere o vínculo e repassa a decisão ao Billing.

> As rotas de catálogo e estoque (`/api/services`, `/api/parts-supplies`, `/api/stock-movements`, `/api/stock-reservations`) e as permissões delas são do Inventory; deste serviço ficam só as métricas por serviço. As rotas de orçamento (`/api/quotes` e `GET /api/work-orders/:id/quotes`) e de cobrança (`/api/payments`) e as permissões delas são do Billing.

> As rotas de login, refresh e redefinição de senha (`/api/auth/*`), de cadastro de usuários (`/api/users`, `/api/users/:id`, `/api/users/:userId/password-resets`), o perfil (`GET /api/me`) e a troca da própria senha (`PATCH /api/me/password`) são do Identity; deste serviço fica só `GET /api/users/:userId/customers`, porque os vínculos são daqui.

</details>

## 🌐 Ecossistema de Repositórios

A solução é composta por **quinze repositórios especializados**, com responsabilidades separadas entre aplicação, rede, execução, mensageria, dados, entrada pública, autenticação, notificação e observabilidade. Este README funciona como índice central; os detalhes de provisionamento e operação permanecem nos repositórios responsáveis.

| Repositório | Responsabilidade | Componente arquitetural | Tecnologias |
|---|---|---|---|
| **[oficina-mecanica-work-order-service](https://github.com/FIAP-15SOAT/oficina-mecanica-work-order-service)** *(este repositório)* | Aplicação, APIs, domínio e manifests dos workloads | API REST / container de aplicação no EKS | NestJS, TypeScript, Prisma, Jest, Docker |
| **[oficina-mecanica-identity-service](https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service)** | Usuários, papéis, credenciais e emissão do token de funcionário | API REST / container de aplicação no EKS | NestJS, TypeScript, Prisma |
| **[oficina-mecanica-billing-service](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service)** | Orçamentos e pagamentos; cria o orçamento inicial da OS e publica as mudanças de status dos orçamentos | API REST / container de aplicação no EKS | NestJS, TypeScript, Prisma |
| **[oficina-mecanica-inventory-service](https://github.com/FIAP-15SOAT/oficina-mecanica-inventory-service)** | Catálogo de serviços e peças e estoque; reserva e baixa as peças das OS | API REST / container de aplicação no EKS | NestJS, TypeScript, Prisma |
| **[oficina-mecanica-infra-base](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-base)** | Fundação de rede compartilhada na AWS | VPC, subnets, IGW, NAT Gateway e rotas | Terraform, AWS VPC |
| **[oficina-mecanica-infra-k8s](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s)** | Plataforma Kubernetes, registry e entrada privada do cluster | Amazon EKS, Node Group, ECR, NLB e `metrics-server` | Terraform, Helm, Amazon EKS 1.35 |
| **[oficina-mecanica-infra-messaging](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-messaging)** | Tópico e filas da mensageria entre os serviços | Amazon SNS FIFO e uma fila Amazon SQS FIFO por serviço, com DLQ (fila de mensagens que falharam) | Terraform, Amazon SNS, Amazon SQS |
| **[oficina-mecanica-infra-database-work-order](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-work-order)** | Persistência relacional e cache gerenciados do `work-order`, fora do cluster | Amazon RDS PostgreSQL 18 e ElastiCache Valkey 9.1 em subnets privadas | Terraform, Amazon RDS, PostgreSQL 18, ElastiCache Valkey 9.1 |
| **[oficina-mecanica-infra-database-identity](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-identity)** | Persistência relacional e cache gerenciados do `identity`, fora do cluster | Amazon RDS PostgreSQL 18 e ElastiCache Valkey 9.1 em subnets privadas | Terraform, Amazon RDS, PostgreSQL 18, ElastiCache Valkey 9.1 |
| **[oficina-mecanica-infra-database-billing](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-billing)** | Persistência relacional e cache gerenciados do `billing`, fora do cluster | Amazon RDS PostgreSQL 18 e ElastiCache Valkey 9.1 em subnets privadas | Terraform, Amazon RDS, PostgreSQL 18, ElastiCache Valkey 9.1 |
| **[oficina-mecanica-infra-database-inventory](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-inventory)** | Persistência relacional e cache gerenciados do `inventory`, fora do cluster | Amazon RDS PostgreSQL 18 e ElastiCache Valkey 9.1 em subnets privadas | Terraform, Amazon RDS, PostgreSQL 18, ElastiCache Valkey 9.1 |
| **[oficina-mecanica-api-gateway](https://github.com/FIAP-15SOAT/oficina-mecanica-api-gateway)** | Entrada pública, roteamento e integração privada com o EKS | AWS API Gateway HTTP API + VPC Link | Terraform, API Gateway, OpenAPI 3.0 |
| **[oficina-mecanica-lambda-customer-auth](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth)** | Login externo por CPF e emissão de JWT RS256 | Função serverless de autenticação de clientes | TypeScript, AWS Lambda, Zod, Jest |
| **[oficina-mecanica-lambda-notification](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-notification)** | Envio dos e-mails da solução, a partir das mensagens dos serviços | Função serverless de notificação | TypeScript, AWS Lambda, Zod, Nodemailer, Jest |
| **[oficina-mecanica-custom-monitoring](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring)** | Dashboards, alertas e verificação sintética da solução | Camada de observabilidade no Datadog | Terraform, Datadog, OpenTelemetry |

## 📁 Estrutura do Repositório

```text
.
├── .github/workflows/           # CI, CD, SAST e DAST
├── .zap/                       # Apoio ao scan dinâmico
├── app/
│   ├── src/
│   │   ├── domain/              # Entidades e regras de domínio
│   │   ├── application/         # Casos de uso e portas
│   │   ├── interface-adapters/  # Controllers, presenters e DTOs
│   │   └── infrastructure/      # Persistência, mensageria, cache, clientes internos, HTTP, logging e telemetria
│   ├── localstack/             # Topologia SNS/SQS criada no LocalStack (cópia do repositório de mensageria)
│   ├── prisma/                 # Schema, migrations e seed
│   ├── test/                    # Testes unitários, E2E, BDD e fixtures de contrato das rotas /internal
│   ├── .env.example            # Referência de configuração local
│   ├── Dockerfile              # Build da imagem da API
│   ├── docker-compose.yml      # Stack para execução local
│   └── package.json            # Dependências e comandos npm
├── collections/                # Coleções para exercitar a API
├── docs/
│   ├── adr/                    # Decisões arquiteturais
│   ├── c4/                     # Diagramas e documentação C4
│   ├── diagrams/               # PNGs de infraestrutura e pipelines
│   └── infra/                  # Visão da solução, Kubernetes, Terraform e CI/CD
├── k8s/                        # Manifests aplicados pelo CD da API
├── reports/                    # Relatórios versionados da solução
├── .gitignore
└── README.md
```

## 📚 Documentação

| Documento | Conteúdo |
|---|---|
| 🏛️ [Arquitetura](docs/architecture.md) | Clean Architecture, DDD, ciclos de vida, UoW, orçamentos no Billing, Sagas de abertura, de aprovação e de cobrança, entrega com saldo zero, fluxo do orçamento, mensageria com outbox, cache, chamadas internas, exceções |
| 🗃️ [Banco de Dados](docs/database.md) | Diagrama ER, tabelas e relacionamentos, enums, convenções de modelagem |
| 🔀 [Diagramas de Sequência](docs/sequence-diagrams.md) | Abertura de OS, autenticação externa por CPF, aprovação de orçamento com reserva de estoque e Saga de cobrança |
| 🔌 [Referência da API](docs/api.md) | Endpoints por domínio, perfis (RBAC), rotas que ficam no Identity, rotas /internal, formato de resposta |
| 💻 [Como executar localmente](docs/local-setup.md) | Setup local, Valkey, LocalStack, Inventory, Billing e Identity locais, variáveis de ambiente, seed |
| 🆔 [Ids canônicos do seed](docs/seed-ids.md) | UUIDs fixos de usuários, clientes, veículos, serviços e peças, compartilhados entre os serviços |
| 🧪 [Testes](docs/testing.md) | Unitários, E2E (PostgreSQL, Valkey, LocalStack e stub do Inventory, do Billing e do Identity), BDD (Cucumber em pt-BR), cenários de falha F1 a F14, contrato das rotas /internal, Postman/Newman |
| 🔒 [Segurança](docs/security.md) | Mitigações no código, proteção de dados nos logs e relatórios (ZAP, SonarQube) |
| 🔭 [Observabilidade](docs/observability.md) | Logs estruturados, correlação, traces, métricas e degradação segura |
| 🏗️ [Infra · Visão Geral](docs/infra/overview.md) | Arquitetura da infra como sistema: componentes, ownership e fluxos |
| 🌍 [Infra · Terraform](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-base) | Infraestrutura AWS e Kubernetes (IaC nos repositórios dedicados) |
| ☸️ [Infra · Kubernetes](docs/infra/kubernetes.md) | Manifests de aplicação (`k8s/`), probes, HPA e deploy |
| 🔄 [Infra · CI/CD](docs/infra/ci-cd.md) | Workflows de CI, CD, SAST e DAST |
| 📐 [ADRs](docs/adr) | Decisões arquiteturais — [0001 PostgreSQL](docs/adr/0001-uso-do-postgresql-como-banco-de-dados.md), [0002 Logging estruturado](docs/adr/0002-logging-estruturado.md), [0003 Health checks](docs/adr/0003-health-checks.md), [0004 Autenticação de clientes](docs/adr/0004-autenticacao-de-clientes.md) *(emendada pela 0026)*, [0005 OpenTelemetry](docs/adr/0005-opentelemetry.md), [0006 Escolha de nuvem](docs/adr/0006-escolha-de-nuvem-aws.md), [0007 Padrão de comunicação](docs/adr/0007-padrao-de-comunicacao-rest-monolito.md), [0008 Autoscaling (HPA)](docs/adr/0008-autoscaling-via-hpa.md), [0009 Clean Architecture/DDD](docs/adr/0009-clean-architecture-ddd-em-camadas.md), [0010 Concorrência otimista](docs/adr/0010-concorrencia-otimista-via-version.md), [0011 Unit of Work](docs/adr/0011-unit-of-work-transacoes-multi-repositorio.md) *(emendada pela 0025)*, [0012 Exceções por camada](docs/adr/0012-hierarquia-de-excecoes-por-camada.md), [0013 Autenticação interna JWT](docs/adr/0013-autenticacao-interna-jwt-stateless.md) *(substituída pela 0022)*, [0014 Pipelines CI/CD/SAST/DAST](docs/adr/0014-pipelines-ci-cd-sast-dast-separados.md), [0015 Testcontainers no E2E](docs/adr/0015-testcontainers-e2e-postgresql-real.md), [0016 Sanitização e validação em duas camadas](docs/adr/0016-sanitizacao-e-validacao-em-duas-camadas.md), [0017 Credencial do banco no CD](docs/adr/0017-materializacao-da-credencial-do-banco-no-cd.md), [0018 Mensageria com outbox](docs/adr/0018-mensageria-sns-sqs-fifo-com-outbox.md), [0019 Cache do dono](docs/adr/0019-cache-do-dono-no-elasticache.md), [0020 Chamadas internas e rotas negadas por padrão](docs/adr/0020-chamadas-internas-e-rotas-negadas-por-padrao.md), [0021 Span de consumo de mensagens](docs/adr/0021-span-de-consumo-de-mensagens.md), [0022 Token de funcionário em RS256](docs/adr/0022-token-de-funcionario-em-rs256.md) *(emendada pela 0026)*, [0023 Catálogo e estoque no Inventory, com reserva pela Saga](docs/adr/0023-catalogo-e-estoque-no-inventory-com-reserva-pela-saga.md), [0024 Saga de abertura com orçamento inicial no Billing](docs/adr/0024-saga-de-abertura-com-orcamento-inicial-no-billing.md), [0025 Sagas orquestradas no work-order](docs/adr/0025-sagas-orquestradas-no-work-order.md), [0026 Usuários lidos no Identity, sem réplica](docs/adr/0026-usuarios-lidos-no-identity-sem-replica.md) |
| 🧩 [Modelo C4](docs/c4) | Diagramas de Contexto, Container e Componente |
| 🎨 [Modelagem de Domínio (Miro)](https://miro.com/app/board/uXjVGvVPEOw=/?share_link_id=9196435429) | Domain Storytelling, Event Storming e Dicionário de Linguagem Ubíqua |

## 👥 Autores

- [Guilherme da Rocha Salvador](https://github.com/guilhermesalvador404)
- [Lucas Almeida da Silva](https://github.com/lucas-almeida-silva)
- [Ramoon Lincoln Barros Camacho](https://github.com/ramooncamacho)
- [Renan Santana Camacho](https://github.com/renancamacho)

## 📄 Licença

Projeto acadêmico (FIAP — 15SOAT), para fins educacionais. Sem licença aberta declarada (`UNLICENSED`).

