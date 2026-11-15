# 🌍 Terraform (IaC)

A infraestrutura é provisionada em onze repositórios Terraform independentes:
- [`oficina-mecanica-infra-base`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-base): Fundação de rede AWS (VPC, subnets públicas/privadas, IGW, NAT Gateway e Security Group de identidade dos nós do EKS).
- [`oficina-mecanica-infra-database-work-order`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-work-order), [`oficina-mecanica-infra-database-identity`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-identity), [`oficina-mecanica-infra-database-billing`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-billing) e [`oficina-mecanica-infra-database-inventory`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-inventory): um banco de dados relacional Amazon RDS (PostgreSQL 18) e um cache distribuído Amazon ElastiCache (Valkey 9.1) por serviço; cada serviço é o único cliente dos seus.
- [`oficina-mecanica-infra-messaging`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-messaging): o tópico SNS FIFO `oficina-events.fifo` (o canal onde os serviços publicam as mensagens, em ordem por OS), uma fila SQS FIFO por consumidor com a DLQ dela (a fila que recebe as mensagens que falharam cinco vezes) e as assinaturas com o filtro por tipo de mensagem.
- [`oficina-mecanica-infra-k8s`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s): Cluster Amazon EKS, Launch Template e Node Group gerenciado (2 nós `t3.medium`), ECRs por microsserviço, NLB interno multi-listener + SMTP, namespaces por serviço e `platform` (Datadog Agent e MailHog, o servidor SMTP de teste que recebe os e-mails da solução).
- [`oficina-mecanica-api-gateway`](https://github.com/FIAP-15SOAT/oficina-mecanica-api-gateway): HTTP API, VPC Link, integrações, rotas e logs de acesso.
- [`oficina-mecanica-lambda-customer-auth`](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth): Função de autenticação externa, rede, segredo de assinatura e permissão do Gateway.
- [`oficina-mecanica-lambda-notification`](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-notification): Função que envia os e-mails da solução ao MailHog, o event source mapping (a ligação gerenciada pela AWS que lê a fila `notification.fifo` e invoca a função) e a rede dela.
- [`oficina-mecanica-custom-monitoring`](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring): Dashboards, monitores, um teste sintético por serviço e configuração de tags no Datadog.

> 🧭 Para a **visão de sistema** (inventário completo, topologia de rede, fluxo em tempo de execução, postura de segurança e limitações), consulte a [Visão Geral da Infraestrutura](overview.md). Este documento resume os stacks; os arquivos HCL de cada repositório são a fonte executável.

## Índice

- [Estrutura e estados remotos](#estrutura-e-estados-remotos)
- [Providers e versionamento](#providers-e-versionamento)
- [Convenções: tags e nomenclatura](#convenções-tags-e-nomenclatura)
- [Recursos provisionados — `oficina-mecanica-infra-base`](#recursos-provisionados--oficina-mecanica-infra-base)
- [Recursos provisionados — repositórios de dados](#recursos-provisionados--repositórios-de-dados)
- [Recursos provisionados — `oficina-mecanica-infra-messaging`](#recursos-provisionados--oficina-mecanica-infra-messaging)
- [Recursos provisionados — `oficina-mecanica-infra-k8s`](#recursos-provisionados--oficina-mecanica-infra-k8s)
- [Recursos provisionados — `oficina-mecanica-lambda-notification`](#recursos-provisionados--oficina-mecanica-lambda-notification)
- [Variáveis e saídas](#variáveis-e-saídas)
- [Como aplicar localmente](#como-aplicar-localmente)

## Estrutura e estados remotos

Cada stack tem **state próprio** num backend S3 (bucket dado pela variável de Actions da organização `TF_STATE_BUCKET`, passado no `terraform init` por `-backend-config`; região `us-east-1`), com chaves distintas:

| Repositório | Camada | Chave do state (S3) |
|---|---|---|
| [`oficina-mecanica-infra-base`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-base) | Rede Cloud | `infra/prod-simulated/infra-base/terraform.tfstate` |
| [`oficina-mecanica-infra-database-work-order`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-work-order) | Dados do `work-order` (RDS + Valkey) | `infra/prod-simulated/infra-database-work-order/terraform.tfstate` |
| [`oficina-mecanica-infra-database-identity`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-identity) | Dados do `identity` (RDS + Valkey) | `infra/prod-simulated/infra-database-identity/terraform.tfstate` |
| [`oficina-mecanica-infra-database-billing`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-billing) | Dados do `billing` (RDS + Valkey) | `infra/prod-simulated/infra-database-billing/terraform.tfstate` |
| [`oficina-mecanica-infra-database-inventory`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-inventory) | Dados do `inventory` (RDS + Valkey) | `infra/prod-simulated/infra-database-inventory/terraform.tfstate` |
| [`oficina-mecanica-infra-messaging`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-messaging) | Mensageria (SNS + SQS FIFO) | `infra/prod-simulated/infra-messaging/terraform.tfstate` |
| [`oficina-mecanica-infra-k8s`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s) | EKS & Workloads | `infra/prod-simulated/infra-k8s/terraform.tfstate` |
| [`oficina-mecanica-api-gateway`](https://github.com/FIAP-15SOAT/oficina-mecanica-api-gateway) | Entrada pública | `infra/prod-simulated/api-gateway/terraform.tfstate` |
| [`oficina-mecanica-lambda-customer-auth`](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth) | Autenticação externa | `infra/prod-simulated/lambda-customer-auth/terraform.tfstate` |
| [`oficina-mecanica-lambda-notification`](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-notification) | Envio de e-mails | `infra/prod-simulated/lambda-notification/terraform.tfstate` |
| [`oficina-mecanica-custom-monitoring`](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring) | Monitoramento Datadog | `infra/prod-simulated/custom-monitoring/terraform.tfstate` |

Todos os backends usam `encrypt = true` (criptografia do state em repouso via SSE) e **`use_lockfile = true`** — o **lock nativo do S3** introduzido no Terraform ≥ 1.11.

Os quatro repositórios de banco e o Kubernetes consomem o state da infra-base (`vpc_id`, `vpc_cidr`, `public_subnet_ids`, `private_subnet_ids` e `eks_nodes_security_group_id`); a mensageria não consome state nenhum. O Gateway consome infra-base e os listeners do NLB exportados por Kubernetes (`service_listener_arns` e `service_listener_ports`). A customer-auth, a função Lambda de login do cliente, consome a infra-base, o endereço e as portas do NLB exportados por Kubernetes e o Gateway; ela chama o Identity e o Work Order pelo NLB e não acessa banco. A notification consome a infra-base, o endereço do NLB e a porta SMTP exportados por Kubernetes e o ARN da fila `notification.fifo` exportado pela mensageria. O monitoramento consome o endpoint público exportado pelo Gateway.

## Providers e versionamento

Versões fixadas por faixa (`required_providers` + `required_version`), garantindo builds reprodutíveis:

| Provider / ferramenta | Restrição | Onde | Usado por |
|---|---|---|---|
| Terraform (core) | `>= 1.11.0` | `*/backend.tf` | todos (o `use_lockfile` exige ≥ 1.11) |
| `hashicorp/aws` | `>= 6.46.0, < 7.0.0` | `*/providers.tf` | todos os stacks |
| `hashicorp/kubernetes` | `>= 2.32.0, < 3.0.0` | `k8s/providers.tf` | `oficina-mecanica-infra-k8s` |
| `hashicorp/helm` | `>= 3.0.0, < 4.0.0` | `k8s/providers.tf` | `oficina-mecanica-infra-k8s` |
| `DataDog/datadog` | `>= 4.20.0, < 5.0.0` | `custom-monitoring/providers.tf` | `oficina-mecanica-custom-monitoring` |

Em `oficina-mecanica-infra-k8s/terraform/providers.tf`, os providers `kubernetes` e `helm` são inicializados dinamicamente a partir dos atributos do próprio cluster provisionado (`aws_eks_cluster.eks_cluster.endpoint` e `base64decode(aws_eks_cluster.eks_cluster.certificate_authority[0].data)`) e de um token IAM efêmero obtido via `data.aws_eks_cluster_auth.eks_auth.token`, sem depender de `kubeconfig` local. O mesmo arquivo lê a fundação de rede e o Security Group de identidade dos nós via `data "terraform_remote_state" "aws_base"` apontando para a chave `infra/prod-simulated/infra-base/terraform.tfstate` no bucket S3 configurado.

## Convenções: tags e nomenclatura

**Tags padrão.** O provider `aws` aplica `default_tags` a **todos** os recursos:

| Tag | Valor |
|---|---|
| `Project` | `var.project_name` (`oficina-mecanica`) |
| `ManagedBy` | `terraform` |
| `Environment` | `var.environment` (`prod-simulated`) |

**Nomenclatura.** Todos os nomes de recurso são padronizados a partir de `project_name` e do mapa `local.services` (`work-order`, `identity`, `billing`, `inventory`) em `locals.tf`:

| Local / Recurso | Padrão | Exemplo |
|---|---|---|
| `vpc_name` | `vpc-${project}` | `vpc-oficina-mecanica` |
| `secgrp_eks_nodes_name` | `secgrp-eks-nodes-${project}` | `secgrp-eks-nodes-oficina-mecanica` |
| `eks_cluster_name` | `eks-${project}` | `eks-oficina-mecanica` |
| `eks_node_group_name` | `ng-eks-${project}-default` | `ng-eks-oficina-mecanica-default` |
| `secgrp_eks_cluster_name` | `secgrp-eks-cluster-${project}` | `secgrp-eks-cluster-oficina-mecanica` |
| `aws_ecr_repository.service` | `ecr-${project}-<contexto>` | `ecr-oficina-mecanica-work-order` (e `identity`, `billing`, `inventory`) |
| `aws_lb_target_group.service` | `tg-${project}-<contexto>` | `tg-oficina-mecanica-work-order` (e `identity`, `billing`, `inventory`) |
| `aws_lb_target_group.smtp` | `tg-${project}-smtp` | `tg-oficina-mecanica-smtp` |
| `rds_identifier` | `rds-${project}-${service_context}` | `rds-oficina-mecanica-work-order` |
| `secgrp_rds_name` | `secgrp-rds-${project}-${service_context}` | `secgrp-rds-oficina-mecanica-work-order` |
| `cache_replication_group_id` | `cache-${project}-${service_context}` | `cache-oficina-mecanica-work-order` |
| `secgrp_cache_name` | `secgrp-cache-${project}-${service_context}` | `secgrp-cache-oficina-mecanica-work-order` |

## Recursos provisionados — `oficina-mecanica-infra-base`

### Rede (`networking.tf`)

- **VPC** `10.0.0.0/16`, com `enable_dns_support` e `enable_dns_hostnames`.
- **AZs**: `slice(data.aws_availability_zones…, 0, 2)` seleciona as **2 primeiras** zonas de `us-east-1`. As variáveis `public_subnet_cidrs`/`private_subnet_cidrs` têm um bloco `validation` que falha com menos de 2 CIDRs (exigência do EKS e RDS Subnet Group).
- **2 subnets públicas** (`10.0.0.0/24`, `10.0.1.0/24`): `map_public_ip_on_launch = true`; tags `kubernetes.io/cluster/<cluster> = shared` e `kubernetes.io/role/elb = 1`.
- **2 subnets privadas** (`10.0.10.0/24`, `10.0.11.0/24`): sem IP público; tags `kubernetes.io/cluster/<cluster> = shared` e `kubernetes.io/role/internal-elb = 1`.
- **Internet Gateway** e **um único** NAT Gateway + Elastic IP, alocado na `public[0]`.
- **Route tables**: `rt_public` → `0.0.0.0/0` via IGW; `rt_private` → `0.0.0.0/0` via NAT Gateway.

### Security Group de identidade dos nós (`security_group.tf`)

- **Security Group** `secgrp-eks-nodes-oficina-mecanica`: criado sem regras locais de ingress ou egress e exportado pelo output `eks_nodes_security_group_id`.
- Anexado às ENIs dos worker nodes pelo Launch Template do `infra-k8s`, servindo como identidade lógica de origem (`source_security_group_id`) para liberar acesso mínimo dos pods às instâncias RDS PostgreSQL e aos caches Valkey nos quatro repositórios de dados, sem acoplamento circular com o ciclo de vida do cluster EKS.

## Recursos provisionados — repositórios de dados

### Amazon RDS PostgreSQL e ElastiCache Valkey (`rds.tf`, `elasticache.tf` e `security_group.tf`)

Os quatro repositórios `oficina-mecanica-infra-database-<contexto>` têm o mesmo Terraform e mudam só os valores padrão de `service_context` e `db_name`; os nomes abaixo usam o `work-order` como exemplo, e os outros trocam o contexto no nome:

| Repositório | `service_context` | Banco (`db_name`) | Instância RDS e cache |
|---|---|---|---|
| `oficina-mecanica-infra-database-work-order` | `work-order` | `work_order` | `rds-oficina-mecanica-work-order` e `cache-oficina-mecanica-work-order` |
| `oficina-mecanica-infra-database-identity` | `identity` | `identity_service` | `rds-oficina-mecanica-identity` e `cache-oficina-mecanica-identity` |
| `oficina-mecanica-infra-database-billing` | `billing` | `billing` | `rds-oficina-mecanica-billing` e `cache-oficina-mecanica-billing` |
| `oficina-mecanica-infra-database-inventory` | `inventory` | `inventory` | `rds-oficina-mecanica-inventory` e `cache-oficina-mecanica-inventory` |

- **Instância RDS**: `db.t4g.micro` (PostgreSQL 18), com storage GP3 de 20 GiB.
- **ElastiCache Valkey**: `cache.t4g.micro` (Valkey 9.1), single-node (`num_cache_clusters = 1`), TLS em trânsito obrigatório, criptografia em repouso e token AUTH gerado via `ephemeral "aws_secretsmanager_random_password"` e gravado com `auth_token_wo` / `secret_string_wo` no Secret `cache-oficina-mecanica-<contexto>-auth-token`.
- **Subnet Groups**: `dbsng-oficina-mecanica-<contexto>` e `cachesng-oficina-mecanica-<contexto>` alocados nas subnets privadas da VPC (`private_subnet_ids`).
- **Security Groups**: `secgrp-rds-oficina-mecanica-<contexto>` (porta `5432` liberada exclusivamente para `eks_nodes_security_group_id`) e `secgrp-cache-oficina-mecanica-<contexto>` (porta `6379` liberada exclusivamente para `eks_nodes_security_group_id`), ambos sem regras de egress.
- **Credencial do RDS**: `manage_master_user_password = true`; RDS gera e mantém o Secret com a chave padrão do Secrets Manager, Terraform exporta apenas seu ARN e a rotação automática fica desabilitada.
- **State do database**: contém ARNs, nomes de segredos e metadados de conexão, mas não o valor da senha do RDS nem o token do Valkey. O CD `prepare-deploy` consulta RDS/Secrets Manager diretamente, sem ler esse remote state.
- **Resiliência**: `skip_final_snapshot = true`, `deletion_protection = false` e `recovery_window_in_days = 0` ajustados para o escopo do laboratório AWS Academy.

## Recursos provisionados — `oficina-mecanica-infra-messaging`

### Tópico, filas e assinaturas (`topic.tf`, `queues.tf` e `subscriptions.tf`)

- **Tópico SNS FIFO** `oficina-events.fifo`, sem deduplicação por conteúdo: quem publica informa o `MessageDeduplicationId` (o `messageId` da mensagem).
- **Uma fila SQS FIFO por consumidor**, gerada a partir das chaves de `subscribed-types.json`: `work-order.fifo`, `billing.fifo`, `inventory.fifo` e `notification.fifo`, com criptografia gerenciada pelo SQS, visibility timeout de 30 s e long polling de 20 s. As filas da notification guardam as mensagens por 1 dia, porque levam dados de e-mail; as outras, por 4 dias.
- **Uma DLQ por fila** (`<consumidor>-dlq.fifo`), para onde a mensagem vai depois de cinco recebimentos sem sucesso (`maxReceiveCount = 5`); as DLQs guardam por 14 dias, o máximo do SQS, para o reenvio manual (a da notification, por 1 dia).
- **Assinaturas**: cada fila assina o tópico com entrega crua (`raw_message_delivery`) e um filtro pelo atributo `type` da mensagem, com os tipos que o consumidor trata listados em `subscribed-types.json`; a policy da fila aceita só o tópico.

Os serviços publicam no tópico pelo ARN, montado no CD de cada um, e consomem a própria fila pela URL; a notification recebe a fila pelo event source mapping. Saídas: `topic_arn`, `topic_name`, `queue_urls`, `queue_arns`, `dlq_urls` e `dlq_arns`.

## Recursos provisionados — `oficina-mecanica-infra-k8s`

### IAM: roles do AWS Academy

O control plane do cluster utiliza a role IAM gerenciada pelo laboratório (`LabEksClusterRole`, lida via `data "aws_iam_role" "eks_cluster_iam_role"`), cujo nome por conta é injetado via variável `EKS_CLUSTER_ROLE_NAME` (`TF_VAR_eks_cluster_role_name`). Já os worker nodes do Node Group utilizam diretamente a role fixa **`LabRole`** do AWS Academy (`data "aws_iam_role" "lab_role"`, sem variável de entrada). Combinada ao Launch Template com IMDSv2 obrigatório e `http_put_response_hop_limit = 2`, a `LabRole` do nó fornece credenciais AWS temporárias diretamente aos pods (para acesso a SQS, SNS e Secrets Manager na Fase 4), contornando o bloqueio de criação de OIDC Provider/IRSA no AWS Academy.

### EKS, Launch Template e Node Group (`eks.tf`)

- **Cluster** versão `1.35` (`var.kubernetes_version`), associado às subnets privadas e públicas lidas via Remote State.
- **Logs do control plane**: `api`, `audit`, `authenticator`, `controllerManager`, `scheduler` — enviados a um **CloudWatch Log Group** com **retenção de 14 dias**.
- **Security Group** do control plane (`secgrp-eks-cluster-oficina-mecanica`): ingress `443` **apenas da CIDR da VPC**; egress liberado.
- **Launch Template** (`aws_launch_template.eks_nodes`): define `instance_type = var.node_instance_type` (`t3.medium`), `metadata_options` com `http_endpoint = "enabled"`, `http_tokens = "required"` (IMDSv2 obrigatório) e `http_put_response_hop_limit = 2`, além de associar às interfaces dos nós tanto o Security Group gerenciado do cluster quanto o Security Group de identidade `secgrp-eks-nodes-oficina-mecanica` (`eks_nodes_security_group_id`).
- **Node group** gerenciado: agendado **nas subnets privadas**, utilizando o Launch Template e a `LabRole`, com escala fixa em **2 nós `t3.medium`** (`desired = min = max = 2`, até 34 pods no total pelo VPC CNI).

### ECR por microsserviço (`ecr.tf`)

- Quatro repositórios de imagens gerados via `for_each = local.services` no padrão `ecr-oficina-mecanica-<contexto>` (`work-order`, `identity`, `billing` e `inventory`), com `image_tag_mutability = "MUTABLE"`, `scan_on_push = true`, criptografia `AES256` e `force_delete = true` (para permitir que o `terraform destroy` ao fim da sessão do laboratório apague os repositórios mesmo quando contêm imagens publicadas).
- **Lifecycle policy** individual por repositório: mantém as **últimas 20 imagens** (`imageCountMoreThan 20` → `expire`) de cada microsserviço.

### Namespaces, metrics-server e plataforma (`k8s_namespace.tf`, `k8s_metrics_server.tf` e `k8s/platform/`)

- **Namespaces** (`k8s_namespace.tf`): criados via `for_each` (`local.namespaces`) para cada bounded context (`work-order`, `identity`, `billing`, `inventory`) e para a camada compartilhada (`platform`), todos com labels `app.kubernetes.io/part-of = oficina-mecanica` e `managed-by = terraform` e `depends_on = [aws_eks_node_group.eks_node_group]`.
- **metrics-server** via Helm (`k8s_metrics_server.tf`): `helm_release` em `kube-system`, condicionado por `count = var.enable_metrics_server ? 1 : 0`. Alimenta os HPAs dos serviços.
- **Componentes do namespace `platform` (`k8s/platform/`)**: aplicados pelo job `platform-apply` do workflow de CD do `infra-k8s` após o `terraform apply`. O job valida `secrets.DD_API_KEY`, cria o Secret `datadog-secret` por stdin (`kubectl create secret generic ... --dry-run=client -o yaml | kubectl apply -f -`, sem gravar a chave no state do Terraform nem em disco) e aplica o **Datadog Agent** (`DaemonSet` `gcr.io/datadoghq/agent:7.83.1` e `Service` ClusterIP `datadog-agent:4318`) e o **MailHog** (`Deployment` `mailhog/mailhog:v1.0.1`, `Service` ClusterIP `mailhog` `1025`/`8025` e `Service` NodePort `mailhog-smtp` no NodePort `31025`).

### Entrada privada para o API Gateway e SMTP (`nlb.tf`)

- **NLB interno** (`nlb-oficina-mecanica`) nas subnets privadas, com cross-zone habilitado.
- **Listeners e Target Groups HTTP por serviço (`for_each = local.services`)**: quatro target groups do tipo `instance` (`preserve_client_ip = false`) com health check HTTP em `/api/health/ready` e seus respectivos listeners TCP no NLB, attachments ao Auto Scaling Group do node group e regras de ingress no Security Group gerenciado do cluster restritas à CIDR da VPC:
  - `work-order`: listener `80/TCP` → `tg-oficina-mecanica-work-order` → NodePort `30080`
  - `identity`: listener `8081/TCP` → `tg-oficina-mecanica-identity` → NodePort `30081`
  - `billing`: listener `8082/TCP` → `tg-oficina-mecanica-billing` → NodePort `30082`
  - `inventory`: listener `8083/TCP` → `tg-oficina-mecanica-inventory` → NodePort `30083`
- **Listener e Target Group TCP para SMTP**: listener `1025/TCP` encaminhando ao target group `tg-oficina-mecanica-smtp` (`instance` mode, health check TCP) no NodePort `31025` (exposto pelo Service `mailhog-smtp` no namespace `platform`), com attachment ao ASG e regra de ingress da CIDR da VPC. É por ele que a função Lambda de notificação ([`oficina-mecanica-lambda-notification`](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-notification)), fora do cluster, entrega os e-mails ao MailHog.

## Recursos provisionados — `oficina-mecanica-lambda-notification`

- **Função Lambda** `lbd-oficina-mecanica-notification` (Node.js 24, 256 MB, 5 s), nas subnets privadas, com a role `LabRole` e as variáveis `SMTP_HOST` e `SMTP_PORT` apontando para o listener SMTP do NLB interno.
- **Event source mapping** da fila `notification.fifo`: uma mensagem por invocação, até 10 invocações simultâneas e resposta parcial (`ReportBatchItemFailures`), para que só a mensagem que falhou volte à fila.
- **Security Group** sem entrada e com saída liberada, e o **log group** `/aws/lambda/lbd-oficina-mecanica-notification` com retenção de 14 dias.
- A extensão do Datadog entra como layer só com `enable_telemetry_collection` ligado; os detalhes estão no [Terraform da notification](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-notification/blob/main/docs/terraform.md).

## Variáveis e saídas

### `oficina-mecanica-infra-base` — variáveis e saídas

| Variável | Tipo | Default | Finalidade |
|---|---|---|---|
| `aws_region` | `string` | `us-east-1` | Região de todos os recursos |
| `project_name` | `string` | `oficina-mecanica` | Base para nomes e tags |
| `environment` | `string` | `prod-simulated` | Nome do ambiente (tag `Environment`) |
| `vpc_cidr` | `string` | `10.0.0.0/16` | CIDR da VPC |
| `public_subnet_cidrs` | `list(string)` | `["10.0.0.0/24","10.0.1.0/24"]` | Subnets públicas — `validation` exige ≥ 2 CIDRs |
| `private_subnet_cidrs` | `list(string)` | `["10.0.10.0/24","10.0.11.0/24"]` | Subnets privadas — `validation` exige ≥ 2 CIDRs |

Outputs exportados pelo `infra-base`: `vpc_id`, `vpc_cidr`, `public_subnet_ids`, `private_subnet_ids` e `eks_nodes_security_group_id`.

### Repositórios de dados — variáveis

Os quatro repositórios têm as mesmas variáveis; `service_context` e `db_name` mudam conforme a tabela de [recursos provisionados](#recursos-provisionados--repositórios-de-dados). Os valores padrão do `work-order`:

| Variável | Tipo | Default | Finalidade |
|---|---|---|---|
| `service_context` | `string` | `work-order` | Identificador do bounded context dono desta camada de dados |
| `db_name` | `string` | `work_order` | Nome do banco inicial |
| `db_username` | `string` | `oficina` | Usuário administrador |
| `db_engine_version` | `string` | `18` | Versão do PostgreSQL no RDS |
| `db_instance_class` | `string` | `db.t4g.micro` | Família de instância RDS |
| `db_allocated_storage` | `number` | `20` | Tamanho do disco em GiB |

### `oficina-mecanica-infra-k8s` — variáveis e saídas

| Variável | Tipo | Default | Finalidade |
|---|---|---|---|
| `aws_region` | `string` | `us-east-1` | Região |
| `project_name` | `string` | `oficina-mecanica` | Base para nomes e tags |
| `environment` | `string` | `prod-simulated` | Nome do ambiente |
| `kubernetes_version` | `string` | `1.35` | Versão do EKS |
| `eks_cluster_role_name` | `string` | `""` | Role IAM do control plane do cluster (injetada via `vars.EKS_CLUSTER_ROLE_NAME`; os nós usam `LabRole` diretamente) |
| `node_instance_type` | `string` | `t3.medium` | Tipo de instância EC2 configurado no Launch Template dos nós |
| `node_desired_size` | `number` | `2` | Quantidade desejada de nós (escala fixa em 2 nós) |
| `node_min_size` | `number` | `2` | Quantidade mínima de nós |
| `node_max_size` | `number` | `2` | Quantidade máxima de nós |
| `aws_base_state_bucket` | `string` | — | Bucket S3 do state de rede (`infra-base`) |
| `aws_base_state_key` | `string` | `infra/prod-simulated/infra-base/terraform.tfstate` | Chave do state de rede (`infra-base`) |
| `aws_base_state_region` | `string` | `us-east-1` | Região do state de rede |
| `enable_metrics_server` | `bool` | `true` | Instala o `metrics-server` via Helm (habilita o HPA) |
| `metrics_server_chart_version` | `string` | `""` | Versão opcional do chart do `metrics-server` (`3.13.0` em `terraform.tfvars`) |

| Output (`infra-k8s`) | Finalidade |
|---|---|
| `cluster_name` | Nome do cluster EKS (`eks-oficina-mecanica`) |
| `cluster_endpoint` | Endpoint da API do control plane do EKS |
| `cluster_certificate_authority_data` | Certificado CA do cluster em base64 |
| `cluster_version` | Versão ativa do Kubernetes |
| `service_listener_arns` | Mapa `contexto → ARN` dos listeners TCP do NLB interno (`work-order`, `identity`, `billing`, `inventory`) |
| `service_listener_ports` | Mapa `contexto → porta TCP` dos listeners do NLB interno (`80`, `8081`, `8082`, `8083`) |
| `nlb_dns_name` | Nome DNS interno do NLB (`nlb-oficina-mecanica`) |
| `smtp_listener_port` | Porta TCP do listener SMTP no NLB interno (`1025`), lida com `nlb_dns_name` pela função Lambda de notificação |
| `zz_next_steps` | Guia rápido pós-deploy para configurar `kubeconfig` e validar acesso |

## Como aplicar localmente

Ordem de execução:

```bash
# 0) Informa o bucket de state ao backend e às leituras de remote state
export TF_STATE_BUCKET=<nome do bucket>
export TF_VAR_aws_base_state_bucket="$TF_STATE_BUCKET"
export TF_VAR_k8s_state_bucket="$TF_STATE_BUCKET"
export TF_VAR_database_state_bucket="$TF_STATE_BUCKET"
export TF_VAR_gateway_state_bucket="$TF_STATE_BUCKET"
export TF_VAR_messaging_state_bucket="$TF_STATE_BUCKET"

# 1) Provisiona a fundação de rede AWS
cd oficina-mecanica-infra-base/terraform
# Inicializa os providers e o backend remoto desta stack
terraform init -backend-config="bucket=$TF_STATE_BUCKET"
# Revisa o plano interativo e aplica os recursos desta stack
terraform apply

# 2) Provisiona o banco RDS e o cache Valkey de cada serviço e a mensageria
for repo in infra-database-work-order infra-database-identity infra-database-billing infra-database-inventory infra-messaging; do
  cd ../../oficina-mecanica-$repo/terraform
  # Inicializa os providers e o backend remoto desta stack
  terraform init -backend-config="bucket=$TF_STATE_BUCKET"
  # Revisa o plano interativo e aplica os recursos desta stack
  terraform apply
done

# 3) Provisiona o cluster EKS, ECRs, namespaces, NLB e recursos de plataforma
cd ../../oficina-mecanica-infra-k8s/terraform
# Inicializa os providers e o backend remoto desta stack
terraform init -backend-config="bucket=$TF_STATE_BUCKET"
# Revisa o plano interativo e aplica os recursos desta stack (os nós usam LabRole via data source)
terraform apply -var="eks_cluster_role_name=<ROLE_CLUSTER>"
# Configura o kubeconfig e aplica o Secret do Datadog e os manifests do namespace platform
aws eks update-kubeconfig --region us-east-1 --name eks-oficina-mecanica
kubectl create secret generic datadog-secret \
  --namespace platform \
  --from-literal=DD_API_KEY="$DD_API_KEY" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f ../k8s/platform/

# 4) Provisiona o API Gateway e o caminho privado até o NLB
cd ../../oficina-mecanica-api-gateway/terraform
# Inicializa os providers e o backend remoto desta stack
terraform init -backend-config="bucket=$TF_STATE_BUCKET"
# Revisa o plano interativo e aplica os recursos desta stack
terraform apply

# 5) Compila e provisiona as duas Lambdas
for repo in lambda-customer-auth lambda-notification; do
  cd ../../oficina-mecanica-$repo/app
  # Instala as dependências fixadas no lockfile e gera app/dist, usado pelo archive_file do Terraform
  npm ci
  npm run build
  # Provisiona a função usando o diretório app/dist gerado pelo build
  cd ../infra
  terraform init -backend-config="bucket=$TF_STATE_BUCKET"
  terraform apply
done

# 6) Provisiona dashboards, monitores e os testes sintéticos
cd ../../oficina-mecanica-custom-monitoring/terraform
# Inicializa os providers e o backend remoto desta stack
terraform init -backend-config="bucket=$TF_STATE_BUCKET"
# Revisa o plano interativo e aplica os recursos desta stack
terraform apply
```

Antes do passo 6, forneça os inputs obrigatórios de monitoring:

- `TF_VAR_datadog_api_key`: API key do Datadog.
- `TF_VAR_datadog_app_key`: application key com permissões para os recursos gerenciados.
- `TF_VAR_alert_emails`: string com os destinatários separados por vírgula.

Consulte os roteiros completos das Lambdas ([customer-auth](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth/blob/main/docs/terraform.md) e [notification](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-notification/blob/main/docs/terraform.md)) e de [monitoring](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring/blob/main/README.md) para preparar as demais variáveis e credenciais. Os comandos acima usam os nomes publicados dos repositórios; adapte os caminhos se seus clones locais tiverem nomes diferentes.
