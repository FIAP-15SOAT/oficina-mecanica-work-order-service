# Índice de decisões de arquitetura (ADRs)

Cada um dos quinze repositórios da solução guarda as próprias decisões de arquitetura em `docs/adr/`, no formato ADR (Architecture Decision Record, um registro curto com o contexto, a decisão e as consequências). Esta página reúne todas num lugar só, com o título e a situação de cada uma, para achar a decisão certa sem abrir repositório por repositório. A lista dos repositórios, com o papel de cada um, está em [Ecossistema de Repositórios](../README.md#-ecossistema-de-repositórios).

O campo "Substituída por" aponta, no mesmo repositório, a decisão que mudou a ADR: numa substituída, a leitura correta é a da substituta; numa emendada ou superada em parte, a ADR continua valendo e a decisão apontada diz o que mudou. As situações usadas:

| Situação | Significado |
|---|---|
| Aceita | Vale como está escrita |
| Aceita, emendada ou revisada | Vale, mas uma decisão posterior mudou parte dela; o campo "Substituída por" aponta qual, ou traz "—" quando a emenda foi feita no próprio arquivo, sem outra ADR |
| Superada em parte | Só uma parte deixou de valer; o campo indica as decisões que a substituem nessa parte |
| Substituída | Deixou de valer por inteiro; fica como histórico |

## Decisões que se repetem nos serviços

Os serviços Identity, Billing e Inventory nasceram como cópia do Work Order e herdaram as decisões abaixo, adaptadas a cada um. Para saber por que uma decisão foi tomada, leia a do Work Order, que é a original; nos outros três, a cópia diz só o que muda no serviço.

| Tema | Work Order (original) | Identity | Billing | Inventory |
|---|---|---|---|---|
| Mensageria SNS/SQS FIFO com outbox (a tabela das mensagens a publicar, gravada na mesma transação do dado) | [0018](adr/0018-mensageria-sns-sqs-fifo-com-outbox.md) | [0005](https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service/blob/main/docs/adr/0005-mensageria-sns-fifo-com-outbox.md) | [0005](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/adr/0005-mensageria-sns-sqs-fifo-com-outbox.md) | [0005](https://github.com/FIAP-15SOAT/oficina-mecanica-inventory-service/blob/main/docs/adr/0005-mensageria-sns-sqs-fifo-com-outbox.md) |
| Cache do dono no ElastiCache | [0019](adr/0019-cache-do-dono-no-elasticache.md) | [0006](https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service/blob/main/docs/adr/0006-cache-do-dono-no-elasticache.md) | [0006](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/adr/0006-cache-do-dono-no-elasticache.md) | [0006](https://github.com/FIAP-15SOAT/oficina-mecanica-inventory-service/blob/main/docs/adr/0006-cache-do-dono-no-elasticache.md) |
| Clean Architecture em camadas | [0009](adr/0009-clean-architecture-ddd-em-camadas.md) | [0001](https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service/blob/main/docs/adr/0001-clean-architecture-em-camadas.md) | [0001](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/adr/0001-clean-architecture-em-camadas.md) | [0001](https://github.com/FIAP-15SOAT/oficina-mecanica-inventory-service/blob/main/docs/adr/0001-clean-architecture-em-camadas.md) |
| Pipelines de CI, CD, SAST e DAST | [0014](adr/0014-pipelines-ci-cd-sast-dast-separados.md) | [0002](https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service/blob/main/docs/adr/0002-pipelines-ci-cd-sast-dast-com-rollback.md) | [0002](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/adr/0002-pipelines-ci-cd-sast-dast-com-rollback.md) | [0002](https://github.com/FIAP-15SOAT/oficina-mecanica-inventory-service/blob/main/docs/adr/0002-pipelines-ci-cd-sast-dast-com-rollback.md) |
| Testes E2E com Testcontainers | [0015](adr/0015-testcontainers-e2e-postgresql-real.md) | [0003](https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service/blob/main/docs/adr/0003-testcontainers-e2e-com-valkey-e-localstack.md) | [0003](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/adr/0003-testcontainers-com-postgresql-valkey-e-localstack.md) | [0003](https://github.com/FIAP-15SOAT/oficina-mecanica-inventory-service/blob/main/docs/adr/0003-testcontainers-e2e-com-valkey-e-localstack.md) |
| Credencial do banco materializada no CD | [0017](adr/0017-materializacao-da-credencial-do-banco-no-cd.md) | [0004](https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service/blob/main/docs/adr/0004-materializacao-da-credencial-do-banco-no-cd.md) | [0004](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/adr/0004-materializacao-da-credencial-do-banco-no-cd.md) | [0004](https://github.com/FIAP-15SOAT/oficina-mecanica-inventory-service/blob/main/docs/adr/0004-materializacao-da-credencial-do-banco-no-cd.md) |

Os quatro repositórios de dados (`infra-database-*`) repetem do mesmo modo as cinco decisões da seção de cada um deles abaixo.

## oficina-mecanica-work-order-service

Work Order, o serviço de ordens de serviço (este repositório). [Pasta das decisões](https://github.com/FIAP-15SOAT/oficina-mecanica-work-order-service/tree/main/docs/adr).

| Número | Título | Situação | Substituída por |
|---|---|---|---|
| [0001](adr/0001-uso-do-postgresql-como-banco-de-dados.md) | Uso do PostgreSQL como Banco de Dados Relacional | Aceita | — |
| [0002](adr/0002-logging-estruturado.md) | Logging Estruturado em JSON com Nomenclatura OpenTelemetry | Superada em parte | [0003](adr/0003-health-checks.md) e [0005](adr/0005-opentelemetry.md) |
| [0003](adr/0003-health-checks.md) | Health Checks — Liveness e Readiness como Endpoints Dedicados | Aceita, emendada | [0026](adr/0026-usuarios-lidos-no-identity-sem-replica.md) |
| [0004](adr/0004-autenticacao-de-clientes.md) | Autenticação externa de clientes por CPF via função serverless | Aceita, emendada | [0026](adr/0026-usuarios-lidos-no-identity-sem-replica.md) |
| [0005](adr/0005-opentelemetry.md) | Instrumentação OpenTelemetry — traces, correlação e métricas de negócio | Aceita, emendada | [0021](adr/0021-span-de-consumo-de-mensagens.md) |
| [0006](adr/0006-escolha-de-nuvem-aws.md) | Escolha de nuvem — AWS (EKS + RDS) no ambiente `prod-simulated` | Aceita | — |
| [0007](adr/0007-padrao-de-comunicacao-rest-monolito.md) | Padrão de comunicação — REST síncrono num monólito modular | Superada em parte | [0018](adr/0018-mensageria-sns-sqs-fifo-com-outbox.md) e [0020](adr/0020-chamadas-internas-e-rotas-negadas-por-padrao.md) |
| [0008](adr/0008-autoscaling-via-hpa.md) | Autoscaling via HPA de pods, não autoscaling de cluster | Aceita | — |
| [0009](adr/0009-clean-architecture-ddd-em-camadas.md) | Clean Architecture e DDD em camadas, com fronteira livre de framework | Aceita | — |
| [0010](adr/0010-concorrencia-otimista-via-version.md) | Concorrência otimista via coluna `version` | Aceita | — |
| [0011](adr/0011-unit-of-work-transacoes-multi-repositorio.md) | Unit of Work para transações multi-repositório | Aceita, emendada | [0025](adr/0025-sagas-orquestradas-no-work-order.md) |
| [0012](adr/0012-hierarquia-de-excecoes-por-camada.md) | Hierarquia de exceções por camada, com Exception Filters dedicados | Aceita | — |
| [0013](adr/0013-autenticacao-interna-jwt-stateless.md) | Autenticação interna via JWT stateless (access + refresh) | Substituída | [0022](adr/0022-token-de-funcionario-em-rs256.md) |
| [0014](adr/0014-pipelines-ci-cd-sast-dast-separados.md) | Pipelines de CI, CD, SAST e DAST separados | Aceita | — |
| [0015](adr/0015-testcontainers-e2e-postgresql-real.md) | Testes E2E contra PostgreSQL real via Testcontainers, não mocks | Aceita | — |
| [0016](adr/0016-sanitizacao-e-validacao-em-duas-camadas.md) | Sanitização e validação de entrada em duas camadas, sempre nesta ordem | Aceita | — |
| [0017](adr/0017-materializacao-da-credencial-do-banco-no-cd.md) | Materialização da credencial do banco no CD | Aceita | — |
| [0018](adr/0018-mensageria-sns-sqs-fifo-com-outbox.md) | Mensageria SNS/SQS FIFO com outbox transacional | Aceita | — |
| [0019](adr/0019-cache-do-dono-no-elasticache.md) | Cache do dono no ElastiCache | Aceita | — |
| [0020](adr/0020-chamadas-internas-e-rotas-negadas-por-padrao.md) | Chamadas internas pela rede do cluster e rotas públicas negadas por padrão | Aceita | — |
| [0021](adr/0021-span-de-consumo-de-mensagens.md) | Span de consumo de mensagens | Aceita, emendada | — |
| [0022](adr/0022-token-de-funcionario-em-rs256.md) | Token de funcionário em RS256 com chave pública por configuração | Aceita, emendada | [0026](adr/0026-usuarios-lidos-no-identity-sem-replica.md) |
| [0023](adr/0023-catalogo-e-estoque-no-inventory-com-reserva-pela-saga.md) | Catálogo e estoque no Inventory, com reserva pela Saga de aprovação | Aceita | — |
| [0024](adr/0024-saga-de-abertura-com-orcamento-inicial-no-billing.md) | Saga de abertura com orçamento inicial no Billing | Aceita | — |
| [0025](adr/0025-sagas-orquestradas-no-work-order.md) | Sagas orquestradas no work-order | Aceita | — |
| [0026](adr/0026-usuarios-lidos-no-identity-sem-replica.md) | Usuários lidos no Identity, sem réplica | Aceita | — |

## oficina-mecanica-identity-service

Identity, o serviço de usuários e credenciais. [Pasta das decisões](https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service/tree/main/docs/adr).

| Número | Título | Situação | Substituída por |
|---|---|---|---|
| [0001](https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service/blob/main/docs/adr/0001-clean-architecture-em-camadas.md) | Clean Architecture em camadas, com fronteira livre de framework | Aceita | — |
| [0002](https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service/blob/main/docs/adr/0002-pipelines-ci-cd-sast-dast-com-rollback.md) | Pipelines de CI, CD, SAST e DAST separados, com rollback e DAST pelo login | Aceita, revisada | — |
| [0003](https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service/blob/main/docs/adr/0003-testcontainers-e2e-com-valkey-e-localstack.md) | Testes E2E com Testcontainers, incluindo Valkey e LocalStack | Aceita | — |
| [0004](https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service/blob/main/docs/adr/0004-materializacao-da-credencial-do-banco-no-cd.md) | Materialização da credencial do banco no CD | Aceita | — |
| [0005](https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service/blob/main/docs/adr/0005-mensageria-sns-fifo-com-outbox.md) | Publicação no SNS FIFO com outbox transacional | Aceita | — |
| [0006](https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service/blob/main/docs/adr/0006-cache-do-dono-no-elasticache.md) | Cache do dono no ElastiCache | Aceita, revisada | — |
| [0007](https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service/blob/main/docs/adr/0007-identity-unico-emissor-do-token-de-funcionario.md) | Identity como único emissor do token de funcionário | Aceita | — |
| [0008](https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service/blob/main/docs/adr/0008-codigo-de-reset-no-valkey.md) | Código de redefinição de senha no Valkey | Aceita | — |

## oficina-mecanica-billing-service

Billing, o serviço de orçamentos e pagamentos. [Pasta das decisões](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/tree/main/docs/adr).

| Número | Título | Situação | Substituída por |
|---|---|---|---|
| [0001](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/adr/0001-clean-architecture-em-camadas.md) | Clean Architecture em camadas, com cerca de ESLint | Aceita | — |
| [0002](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/adr/0002-pipelines-ci-cd-sast-dast-com-rollback.md) | Pipelines de CI, CD, SAST e DAST, com rollback e DAST com JWT de teste | Aceita | — |
| [0003](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/adr/0003-testcontainers-com-postgresql-valkey-e-localstack.md) | E2E com Testcontainers: PostgreSQL, Valkey e LocalStack | Aceita | — |
| [0004](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/adr/0004-materializacao-da-credencial-do-banco-no-cd.md) | Materialização da credencial do banco no CD | Aceita | — |
| [0005](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/adr/0005-mensageria-sns-sqs-fifo-com-outbox.md) | Mensageria SNS/SQS FIFO com outbox transacional | Aceita | — |
| [0006](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/adr/0006-cache-do-dono-no-elasticache.md) | Cache do dono no ElastiCache | Aceita | — |
| [0007](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/adr/0007-aprovacao-sincrona-com-irmaos-reversiveis.md) | Aprovação síncrona com irmãos reversíveis | Aceita | — |
| [0008](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/adr/0008-checkout-pro-via-orders-api.md) | Checkout Pro via Orders API, atrás de uma porta neutra | Aceita | — |
| [0009](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/adr/0009-webhook-com-hmac-e-consulta-da-order.md) | Webhook com HMAC e consulta da order, sem reconciliador | Aceita | — |

## oficina-mecanica-inventory-service

Inventory, o serviço de catálogo e estoque. [Pasta das decisões](https://github.com/FIAP-15SOAT/oficina-mecanica-inventory-service/tree/main/docs/adr).

| Número | Título | Situação | Substituída por |
|---|---|---|---|
| [0001](https://github.com/FIAP-15SOAT/oficina-mecanica-inventory-service/blob/main/docs/adr/0001-clean-architecture-em-camadas.md) | Clean Architecture em camadas, com fronteira livre de framework | Aceita | — |
| [0002](https://github.com/FIAP-15SOAT/oficina-mecanica-inventory-service/blob/main/docs/adr/0002-pipelines-ci-cd-sast-dast-com-rollback.md) | Pipelines de CI, CD, SAST e DAST separados, com rollback e DAST com JWT de teste | Aceita | — |
| [0003](https://github.com/FIAP-15SOAT/oficina-mecanica-inventory-service/blob/main/docs/adr/0003-testcontainers-e2e-com-valkey-e-localstack.md) | Testes E2E com Testcontainers, incluindo Valkey e LocalStack | Aceita | — |
| [0004](https://github.com/FIAP-15SOAT/oficina-mecanica-inventory-service/blob/main/docs/adr/0004-materializacao-da-credencial-do-banco-no-cd.md) | Materialização da credencial do banco no CD | Aceita | — |
| [0005](https://github.com/FIAP-15SOAT/oficina-mecanica-inventory-service/blob/main/docs/adr/0005-mensageria-sns-sqs-fifo-com-outbox.md) | Mensageria SNS/SQS FIFO com outbox transacional | Aceita | — |
| [0006](https://github.com/FIAP-15SOAT/oficina-mecanica-inventory-service/blob/main/docs/adr/0006-cache-do-dono-no-elasticache.md) | Cache do dono no ElastiCache | Aceita | — |

## oficina-mecanica-lambda-customer-auth

customer-auth, a função Lambda de login do cliente por CPF. [Pasta das decisões](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth/tree/main/docs/adr).

| Número | Título | Situação | Substituída por |
|---|---|---|---|
| [0001](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth/blob/main/docs/adr/0001-driver-em-vez-de-orm.md) | Acesso ao banco por driver, não por ORM | Substituída | [0007](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth/blob/main/docs/adr/0007-credencial-e-vinculo-verificados-nos-servicos-donos.md) |
| [0002](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth/blob/main/docs/adr/0002-camadas-enxutas-com-composicao-memoizada.md) | Camadas enxutas com composição memoizada | Aceita | — |
| [0003](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth/blob/main/docs/adr/0003-bcrypt-em-javascript-puro.md) | bcrypt em JavaScript puro, artefato compactado e emulação local | Aceita, emendada | [0007](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth/blob/main/docs/adr/0007-credencial-e-vinculo-verificados-nos-servicos-donos.md) |
| [0004](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth/blob/main/docs/adr/0004-empacotamento-e-publicacao.md) | Empacotamento e publicação da função | Aceita | — |
| [0005](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth/blob/main/docs/adr/0005-coleta-de-telemetria-sem-instrumentacao.md) | Coleta de telemetria sem instrumentação no código | Aceita, emendada | [0008](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth/blob/main/docs/adr/0008-contexto-de-trace-sem-sdk.md) |
| [0006](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth/blob/main/docs/adr/0006-sem-analise-dinamica.md) | Sem análise dinâmica de segurança neste repositório | Aceita | — |
| [0007](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth/blob/main/docs/adr/0007-credencial-e-vinculo-verificados-nos-servicos-donos.md) | Credencial e vínculo verificados nos serviços donos | Aceita | — |
| [0008](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth/blob/main/docs/adr/0008-contexto-de-trace-sem-sdk.md) | Contexto de trace sem SDK | Aceita | — |

## oficina-mecanica-lambda-notification

notification, a função Lambda de envio de e-mails. [Pasta das decisões](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-notification/tree/main/docs/adr).

| Número | Título | Situação | Substituída por |
|---|---|---|---|
| [0001](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-notification/blob/main/docs/adr/0001-envio-sem-templates.md) | Envio sem templates, do e-mail montado por quem pede | Aceita | — |
| [0002](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-notification/blob/main/docs/adr/0002-uma-mensagem-por-invocacao.md) | Uma mensagem por execução, com a ordem por grupo garantida no código | Aceita | — |
| [0003](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-notification/blob/main/docs/adr/0003-camadas-enxutas-e-empacotamento.md) | Camadas enxutas e empacotamento iguais aos da Lambda customer-auth | Aceita | — |
| [0004](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-notification/blob/main/docs/adr/0004-span-de-processamento-por-mensagem.md) | Span de processamento por mensagem, enviado à extensão por OTLP | Aceita | — |

## oficina-mecanica-infra-base

infra-base, a rede compartilhada (Terraform). [Pasta das decisões](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-base/tree/main/docs/adr).

| Número | Título | Situação | Substituída por |
|---|---|---|---|
| [0001](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-base/blob/main/docs/adr/0001-escolha-de-nuvem-e-infra-base.md) | Escolha da nuvem (AWS) e criação da infraestrutura de rede base | Aceita | — |
| [0002](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-base/blob/main/docs/adr/0002-postura-de-rede-apenas-security-groups.md) | Controle de tráfego só por Security Groups — sem NACLs nem VPC Flow Logs | Aceita | — |
| [0003](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-base/blob/main/docs/adr/0003-ci-tolerante-a-indisponibilidade-do-lab.md) | CI tolerante à indisponibilidade do ambiente AWS Academy | Aceita | — |
| [0004](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-base/blob/main/docs/adr/0004-security-group-de-identidade-dos-nos-do-eks.md) | Security group de identidade dos nós do EKS | Aceita | — |
| [0005](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-base/blob/main/docs/adr/0005-ciclo-de-vida-do-ambiente-por-script.md) | Ciclo de vida do ambiente por script | Aceita | — |

## oficina-mecanica-infra-k8s

infra-k8s, o cluster Amazon EKS e o registro de imagens (Terraform). [Pasta das decisões](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s/tree/main/docs/adr).

| Número | Título | Situação | Substituída por |
|---|---|---|---|
| [0001](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s/blob/main/docs/adr/0001-suporte-a-hpa-e-dimensionamento-do-node-group.md) | Suporte ao HPA da API e dimensionamento do Node Group em função dele | Substituída | [0008](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s/blob/main/docs/adr/0008-escalonamento-do-node-group-para-2-nos-t3-medium.md) |
| [0002](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s/blob/main/docs/adr/0002-eks-como-distribuicao-gerenciada.md) | Amazon EKS como distribuição gerenciada de Kubernetes | Aceita | — |
| [0003](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s/blob/main/docs/adr/0003-endpoint-publico-e-privado-simultaneos.md) | Endpoint do control plane EKS público e privado simultaneamente | Aceita | — |
| [0004](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s/blob/main/docs/adr/0004-ecr-scan-on-push-tags-mutaveis.md) | Amazon ECR por serviço com scan-on-push, tags mutáveis, force_delete e retenção de 20 imagens | Aceita, revisada | — |
| [0005](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s/blob/main/docs/adr/0005-auth-providers-k8s-helm-via-token-iam-efemero.md) | Providers Kubernetes/Helm autenticados por token IAM efêmero, sem kubeconfig estático | Aceita | — |
| [0006](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s/blob/main/docs/adr/0006-namespace-unico-compartilhado.md) | Namespace único compartilhado para todos os recursos da aplicação | Substituída | [0007](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s/blob/main/docs/adr/0007-isolamento-por-namespace-e-ecr-por-bounded-context.md) |
| [0007](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s/blob/main/docs/adr/0007-isolamento-por-namespace-e-ecr-por-bounded-context.md) | Namespace por serviço e namespace de plataforma | Aceita | — |
| [0008](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s/blob/main/docs/adr/0008-escalonamento-do-node-group-para-2-nos-t3-medium.md) | Dois nós `t3.medium` fixos no Node Group | Aceita | — |
| [0009](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s/blob/main/docs/adr/0009-nlb-interno-unico-com-listeners-por-porta.md) | NLB interno com listener por serviço e listener SMTP | Aceita | — |
| [0010](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s/blob/main/docs/adr/0010-launch-template-com-imdsv2-e-labrole-nos-nos.md) | Credenciais AWS dos pods pela `LabRole` como role do nó com Launch Template IMDSv2 | Aceita | — |

## oficina-mecanica-infra-messaging

infra-messaging, o tópico SNS e as filas SQS (Terraform). [Pasta das decisões](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-messaging/tree/main/docs/adr).

| Número | Título | Situação | Substituída por |
|---|---|---|---|
| [0001](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-messaging/blob/main/docs/adr/0001-um-topico-fifo-e-uma-fila-por-consumidor.md) | Um tópico SNS FIFO e uma fila SQS FIFO por consumidor | Aceita | — |
| [0002](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-messaging/blob/main/docs/adr/0002-mapa-unico-de-tipos-e-script-local.md) | Filter policies de um mapa único e script do LocalStack conferido no CI | Aceita | — |

## oficina-mecanica-infra-database-work-order

infra-database-work-order, o banco e o cache do Work Order (Terraform). [Pasta das decisões](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-work-order/tree/main/docs/adr).

| Número | Título | Situação | Substituída por |
|---|---|---|---|
| [0001](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-work-order/blob/main/docs/adr/0001-banco-gerenciado-amazon-rds.md) | Banco de dados relacional como serviço gerenciado (Amazon RDS) | Aceita, revisada | [0004](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-work-order/blob/main/docs/adr/0004-um-repositorio-de-dados-por-servico.md) |
| [0002](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-work-order/blob/main/docs/adr/0002-credencial-via-variavel-terraform-sensivel.md) | Senha do banco por variável Terraform sensível e publicação no Secrets Manager | Substituída | [0003](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-work-order/blob/main/docs/adr/0003-master-password-gerenciada-pelo-rds.md) |
| [0003](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-work-order/blob/main/docs/adr/0003-master-password-gerenciada-pelo-rds.md) | Master password gerenciada pelo Amazon RDS | Aceita | — |
| [0004](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-work-order/blob/main/docs/adr/0004-um-repositorio-de-dados-por-servico.md) | Um repositório de dados por serviço | Aceita | — |
| [0005](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-work-order/blob/main/docs/adr/0005-elasticache-com-tls-e-senha-fora-do-state.md) | ElastiCache for Valkey com TLS e senha fora do state | Aceita | — |

## oficina-mecanica-infra-database-identity

infra-database-identity, o banco e o cache do Identity (Terraform). [Pasta das decisões](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-identity/tree/main/docs/adr).

| Número | Título | Situação | Substituída por |
|---|---|---|---|
| [0001](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-identity/blob/main/docs/adr/0001-banco-gerenciado-amazon-rds.md) | Banco de dados relacional como serviço gerenciado (Amazon RDS) | Aceita, revisada | [0004](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-identity/blob/main/docs/adr/0004-um-repositorio-de-dados-por-servico.md) |
| [0002](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-identity/blob/main/docs/adr/0002-credencial-via-variavel-terraform-sensivel.md) | Senha do banco por variável Terraform sensível e publicação no Secrets Manager | Substituída | [0003](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-identity/blob/main/docs/adr/0003-master-password-gerenciada-pelo-rds.md) |
| [0003](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-identity/blob/main/docs/adr/0003-master-password-gerenciada-pelo-rds.md) | Master password gerenciada pelo Amazon RDS | Aceita | — |
| [0004](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-identity/blob/main/docs/adr/0004-um-repositorio-de-dados-por-servico.md) | Um repositório de dados por serviço | Aceita | — |
| [0005](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-identity/blob/main/docs/adr/0005-elasticache-com-tls-e-senha-fora-do-state.md) | ElastiCache for Valkey com TLS e senha fora do state | Aceita | — |

## oficina-mecanica-infra-database-billing

infra-database-billing, o banco e o cache do Billing (Terraform). [Pasta das decisões](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-billing/tree/main/docs/adr).

| Número | Título | Situação | Substituída por |
|---|---|---|---|
| [0001](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-billing/blob/main/docs/adr/0001-banco-gerenciado-amazon-rds.md) | Banco de dados relacional como serviço gerenciado (Amazon RDS) | Aceita, revisada | [0004](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-billing/blob/main/docs/adr/0004-um-repositorio-de-dados-por-servico.md) |
| [0002](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-billing/blob/main/docs/adr/0002-credencial-via-variavel-terraform-sensivel.md) | Senha do banco por variável Terraform sensível e publicação no Secrets Manager | Substituída | [0003](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-billing/blob/main/docs/adr/0003-master-password-gerenciada-pelo-rds.md) |
| [0003](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-billing/blob/main/docs/adr/0003-master-password-gerenciada-pelo-rds.md) | Master password gerenciada pelo Amazon RDS | Aceita | — |
| [0004](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-billing/blob/main/docs/adr/0004-um-repositorio-de-dados-por-servico.md) | Um repositório de dados por serviço | Aceita | — |
| [0005](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-billing/blob/main/docs/adr/0005-elasticache-com-tls-e-senha-fora-do-state.md) | ElastiCache for Valkey com TLS e senha fora do state | Aceita | — |

## oficina-mecanica-infra-database-inventory

infra-database-inventory, o banco e o cache do Inventory (Terraform). [Pasta das decisões](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-inventory/tree/main/docs/adr).

| Número | Título | Situação | Substituída por |
|---|---|---|---|
| [0001](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-inventory/blob/main/docs/adr/0001-banco-gerenciado-amazon-rds.md) | Banco de dados relacional como serviço gerenciado (Amazon RDS) | Aceita, revisada | [0004](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-inventory/blob/main/docs/adr/0004-um-repositorio-de-dados-por-servico.md) |
| [0002](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-inventory/blob/main/docs/adr/0002-credencial-via-variavel-terraform-sensivel.md) | Senha do banco por variável Terraform sensível e publicação no Secrets Manager | Substituída | [0003](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-inventory/blob/main/docs/adr/0003-master-password-gerenciada-pelo-rds.md) |
| [0003](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-inventory/blob/main/docs/adr/0003-master-password-gerenciada-pelo-rds.md) | Master password gerenciada pelo Amazon RDS | Aceita | — |
| [0004](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-inventory/blob/main/docs/adr/0004-um-repositorio-de-dados-por-servico.md) | Um repositório de dados por serviço | Aceita | — |
| [0005](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-inventory/blob/main/docs/adr/0005-elasticache-com-tls-e-senha-fora-do-state.md) | ElastiCache for Valkey com TLS e senha fora do state | Aceita | — |

## oficina-mecanica-api-gateway

api-gateway, a entrada pública da solução (Terraform). [Pasta das decisões](https://github.com/FIAP-15SOAT/oficina-mecanica-api-gateway/tree/main/docs/adr).

| Número | Título | Situação | Substituída por |
|---|---|---|---|
| [0001](https://github.com/FIAP-15SOAT/oficina-mecanica-api-gateway/blob/main/docs/adr/0001-http-api-em-vez-de-rest-api.md) | HTTP API (v2) em vez de REST API (v1) no Amazon API Gateway | Aceita | — |
| [0002](https://github.com/FIAP-15SOAT/oficina-mecanica-api-gateway/blob/main/docs/adr/0002-contrato-do-gateway-em-openapi.md) | A superfície de roteamento é declarada em OpenAPI, sem schemas | Aceita, revisada | [0005](https://github.com/FIAP-15SOAT/oficina-mecanica-api-gateway/blob/main/docs/adr/0005-integracao-privada-por-servico-e-tabela-de-donos.md) |
| [0003](https://github.com/FIAP-15SOAT/oficina-mecanica-api-gateway/blob/main/docs/adr/0003-integracao-privada-com-o-eks.md) | Integração privada com o EKS — VPC Link V2, NLB interno e NodePort, com o balanceador em `oficina-mecanica-infra-k8s` | Substituída | [0005](https://github.com/FIAP-15SOAT/oficina-mecanica-api-gateway/blob/main/docs/adr/0005-integracao-privada-por-servico-e-tabela-de-donos.md) |
| [0004](https://github.com/FIAP-15SOAT/oficina-mecanica-api-gateway/blob/main/docs/adr/0004-autenticacao-permanece-nos-backends.md) | Autenticação e autorização permanecem inteiramente nos backends | Aceita, revisada | [0005](https://github.com/FIAP-15SOAT/oficina-mecanica-api-gateway/blob/main/docs/adr/0005-integracao-privada-por-servico-e-tabela-de-donos.md) |
| [0005](https://github.com/FIAP-15SOAT/oficina-mecanica-api-gateway/blob/main/docs/adr/0005-integracao-privada-por-servico-e-tabela-de-donos.md) | Integração privada por serviço e tabela de donos das rotas | Aceita | — |

## oficina-mecanica-custom-monitoring

custom-monitoring, os dashboards e alertas do Datadog (Terraform). [Pasta das decisões](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring/tree/main/docs/adr).

| Número | Título | Situação | Substituída por |
|---|---|---|---|
| [0001](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring/blob/main/docs/adr/0001-terraform-com-provider-datadog.md) | Terraform com o provider Datadog, em HCL tipado | Aceita | — |
| [0002](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring/blob/main/docs/adr/0002-latencia-por-metrica-otlp.md) | Latência vem da métrica OTLP, não das *trace metrics* do APM | Aceita | — |
| [0003](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring/blob/main/docs/adr/0003-uptime-por-verificacao-externa.md) | Uptime por verificação externa | Aceita, revisada | [0006](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring/blob/main/docs/adr/0006-monitoramento-por-servico.md) |
| [0004](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring/blob/main/docs/adr/0004-state-no-s3-compartilhado.md) | State no S3 compartilhado, com o acoplamento declarado | Aceita | — |
| [0005](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring/blob/main/docs/adr/0005-conjunto-minimo-de-alertas.md) | Conjunto mínimo de alertas para um ambiente efêmero | Aceita, revisada | — |
| [0006](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring/blob/main/docs/adr/0006-monitoramento-por-servico.md) | Monitoramento por serviço e da solução distribuída | Aceita | — |
