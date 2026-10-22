# 🌍 Terraform (IaC)

A infraestrutura é provisionada em seis repositórios Terraform independentes:
- [`oficina-mecanica-infra-base`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-base): Fundação de rede AWS (VPC, subnets públicas/privadas, IGW, NAT Gateway).
- [`oficina-mecanica-infra-database`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database): Banco de dados relacional gerenciado Amazon RDS (PostgreSQL).
- [`oficina-mecanica-infra-k8s`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s): Cluster Amazon EKS, Node Group gerenciado, ECR e namespace Kubernetes.
- [`oficina-mecanica-api-gateway`](https://github.com/FIAP-15SOAT/oficina-mecanica-api-gateway): HTTP API, VPC Link, integrações, rotas e logs de acesso.
- [`oficina-mecanica-lambda-customer-auth`](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth): Função de autenticação externa, rede, segredo de assinatura e permissão do Gateway.
- [`oficina-mecanica-custom-monitoring`](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring): Dashboards, monitores, teste sintético e configuração de tags no Datadog.

> 🧭 Para a **visão de sistema** (inventário completo, topologia de rede, fluxo em tempo de execução, postura de segurança e limitações), consulte a [Visão Geral da Infraestrutura](overview.md). Este documento resume os stacks; os arquivos HCL de cada repositório são a fonte executável.

## Índice

- [Estrutura e estados remotos](#estrutura-e-estados-remotos)
- [Providers e versionamento](#providers-e-versionamento)
- [Convenções: tags e nomenclatura](#convenções-tags-e-nomenclatura)
- [Recursos provisionados — `oficina-mecanica-infra-base`](#recursos-provisionados--oficina-mecanica-infra-base)
- [Recursos provisionados — `oficina-mecanica-infra-database`](#recursos-provisionados--oficina-mecanica-infra-database)
- [Recursos provisionados — `oficina-mecanica-infra-k8s`](#recursos-provisionados--oficina-mecanica-infra-k8s)
- [Variáveis e saídas](#variáveis-e-saídas)
- [Como aplicar localmente](#como-aplicar-localmente)

## Estrutura e estados remotos

Cada stack tem **state próprio** num backend S3 (bucket dado pela variável de Actions da organização `TF_STATE_BUCKET`, passado no `terraform init` por `-backend-config`; região `us-east-1`), com chaves distintas:

| Repositório | Camada | Chave do state (S3) |
|---|---|---|
| [`oficina-mecanica-infra-base`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-base) | Rede Cloud | `infra/prod-simulated/infra-base/terraform.tfstate` |
| [`oficina-mecanica-infra-database`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database) | Banco de Dados (RDS) | `infra/prod-simulated/database/terraform.tfstate` |
| [`oficina-mecanica-infra-k8s`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s) | EKS & Workloads | `infra/prod-simulated/k8s/terraform.tfstate` |
| [`oficina-mecanica-api-gateway`](https://github.com/FIAP-15SOAT/oficina-mecanica-api-gateway) | Entrada pública | `infra/prod-simulated/gateway/terraform.tfstate` |
| [`oficina-mecanica-lambda-customer-auth`](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth) | Autenticação externa | `infra/prod-simulated/lambda-customer-auth/terraform.tfstate` |
| [`oficina-mecanica-custom-monitoring`](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring) | Monitoramento Datadog | `infra/prod-simulated/custom-monitoring/terraform.tfstate` |

Todos os backends usam `encrypt = true` (criptografia do state em repouso via SSE) e **`use_lockfile = true`** — o **lock nativo do S3** introduzido no Terraform ≥ 1.11.

Database e Kubernetes consomem o state da infra-base. O Gateway consome infra-base e o listener do NLB exportado por Kubernetes. A Lambda consome infra-base, database e Gateway. O monitoramento consome o endpoint público exportado pelo Gateway.

## Providers e versionamento

Versões fixadas por faixa (`required_providers` + `required_version`), garantindo builds reprodutíveis:

| Provider / ferramenta | Restrição | Onde | Usado por |
|---|---|---|---|
| Terraform (core) | `>= 1.11.0` | `*/backend.tf` | todos (o `use_lockfile` exige ≥ 1.11) |
| `hashicorp/aws` | `>= 6.46.0, < 7.0.0` | `*/providers.tf` | os seis stacks |
| `hashicorp/kubernetes` | `>= 2.32.0, < 3.0.0` | `k8s/providers.tf` | `oficina-mecanica-infra-k8s` |
| `hashicorp/helm` | `>= 3.0.0, < 4.0.0` | `k8s/providers.tf` | `oficina-mecanica-infra-k8s` |
| `DataDog/datadog` | `>= 4.20.0, < 5.0.0` | `custom-monitoring/providers.tf` | `oficina-mecanica-custom-monitoring` |

## Convenções: tags e nomenclatura

**Tags padrão.** O provider `aws` aplica `default_tags` a **todos** os recursos:

| Tag | Valor |
|---|---|
| `Project` | `var.project_name` (`oficina-mecanica`) |
| `ManagedBy` | `terraform` |
| `Environment` | `var.environment` (`prod-simulated`) |

**Nomenclatura.** Todos os nomes de recurso são padronizados a partir de `project_name` em `locals.tf`:

| Local | Padrão | Exemplo |
|---|---|---|
| `vpc_name` | `vpc-${project}` | `vpc-oficina-mecanica` |
| `eks_cluster_name` | `eks-${project}` | `eks-oficina-mecanica` |
| `eks_node_group_name` | `ng-eks-${project}-default` | `ng-eks-oficina-mecanica-default` |
| `ecr_app_repo_name` | `ecr-${project}-app-repo` | `ecr-oficina-mecanica-app-repo` |
| `rds_instance_name` | `rds-${project}` | `rds-oficina-mecanica` |
| `secgrp_eks_cluster_name` | `secgrp-eks-cluster-${project}` | `secgrp-eks-cluster-oficina-mecanica` |
| `secgrp_rds_name` | `secgrp-rds-${project}` | `secgrp-rds-oficina-mecanica` |

## Recursos provisionados — `oficina-mecanica-infra-base`

### Rede (`networking.tf`)

- **VPC** `10.0.0.0/16`, com `enable_dns_support` e `enable_dns_hostnames`.
- **AZs**: `slice(data.aws_availability_zones…, 0, 2)` seleciona as **2 primeiras** zonas de `us-east-1`. As variáveis `public_subnet_cidrs`/`private_subnet_cidrs` têm um bloco `validation` que falha com menos de 2 CIDRs (exigência do EKS e RDS Subnet Group).
- **2 subnets públicas** (`10.0.0.0/24`, `10.0.1.0/24`): `map_public_ip_on_launch = true`; tags `kubernetes.io/cluster/<cluster> = shared` e `kubernetes.io/role/elb = 1`.
- **2 subnets privadas** (`10.0.10.0/24`, `10.0.11.0/24`): sem IP público; tags `kubernetes.io/cluster/<cluster> = shared` e `kubernetes.io/role/internal-elb = 1`.
- **Internet Gateway** e **um único** NAT Gateway + Elastic IP, alocado na `public[0]`.
- **Route tables**: `rt_public` → `0.0.0.0/0` via IGW; `rt_private` → `0.0.0.0/0` via NAT Gateway.

## Recursos provisionados — `oficina-mecanica-infra-database`

### Amazon RDS PostgreSQL (`rds.tf` e `security_group.tf`)

- **Instância**: `db.t4g.micro` (PostgreSQL 16), com storage GP3 de 20 GiB.
- **Subnet Group**: alocado exclusivamente nas subnets privadas da VPC (`private_subnet_ids`).
- **Security Group**: porta `5432` liberada exclusivamente para a CIDR da VPC (`vpc_cidr`).
- **Credencial**: `manage_master_user_password = true`; RDS gera e mantém o Secret com a chave padrão do Secrets Manager, Terraform exporta apenas seu ARN e a rotação automática fica desabilitada.
- **State do database**: contém ARN, KMS key ID, status e metadados de conexão, mas não o valor da senha. Isso decorre do gerenciamento externo pelo RDS, não de `sensitive`, que apenas oculta a apresentação. O CD `prepare-deploy` consulta RDS/Secrets Manager diretamente, sem ler esse remote state.
- **Resiliência**: `skip_final_snapshot = true` e `deletion_protection = false` ajustados para o escopo do laboratório AWS Academy.

## Recursos provisionados — `oficina-mecanica-infra-k8s`

### IAM: roles do AWS Academy

O cluster e o node group utilizam roles IAM gerenciadas pelo laboratório (`LabEksClusterRole` e `LabEksNodeRole`), cujos nomes dinâmicos são injetados diretamente via variáveis de ambiente nas esteiras (`EKS_CLUSTER_ROLE_NAME` e `EKS_NODE_ROLE_NAME`).

### EKS (`eks.tf`)

- **Cluster** versão `1.35` (`var.kubernetes_version`), associado às subnets privadas e públicas lidas via Remote State.
- **Logs do control plane**: `api`, `audit`, `authenticator`, `controllerManager`, `scheduler` — enviados a um **CloudWatch Log Group** com **retenção de 14 dias**.
- **Security Group** do control plane: ingress `443` **apenas da CIDR da VPC**; egress liberado.
- **Node group** gerenciado: instância `t3.medium`, `desired = min = max = 1`, agendado **nas subnets privadas**.

### ECR (`ecr.tf`)

- Repositório de imagens da aplicação com `scan_on_push = true` e criptografia `AES256`.
- **Lifecycle policy**: mantém as **últimas 20 imagens** (`imageCountMoreThan 20` → `expire`).

### Namespace e metrics-server

- **Namespace** `oficina` (`k8s_namespace.tf`), com dependência explícita do Node Group (`depends_on = [aws_eks_node_group.eks_node_group]`).
- **metrics-server** via Helm (`k8s_metrics_server.tf`): `helm_release` em `kube-system`, condicionado por `count = var.enable_metrics_server ? 1 : 0`. Alimenta o HPA da API.

### Entrada privada para o API Gateway (`nlb.tf`)

- **NLB interno** nas subnets privadas, com cross-zone habilitado.
- **Target Group** do tipo `instance` na NodePort `30080`, com health check HTTP em `/api/health/ready`.
- **Listener TCP:80**, attachment ao Auto Scaling Group do node group e regra de security group restrita à CIDR da VPC.

## Variáveis e saídas

### `oficina-mecanica-infra-base` — variáveis

| Variável | Tipo | Default | Finalidade |
|---|---|---|---|
| `aws_region` | `string` | `us-east-1` | Região de todos os recursos |
| `project_name` | `string` | `oficina-mecanica` | Base para nomes e tags |
| `environment` | `string` | `prod-simulated` | Nome do ambiente (tag `Environment`) |
| `vpc_cidr` | `string` | `10.0.0.0/16` | CIDR da VPC |
| `public_subnet_cidrs` | `list(string)` | `["10.0.0.0/24","10.0.1.0/24"]` | Subnets públicas — `validation` exige ≥ 2 CIDRs |
| `private_subnet_cidrs` | `list(string)` | `["10.0.10.0/24","10.0.11.0/24"]` | Subnets privadas — `validation` exige ≥ 2 CIDRs |

### `oficina-mecanica-infra-database` — variáveis

| Variável | Tipo | Default | Finalidade |
|---|---|---|---|
| `db_name` | `string` | `techchallenge` | Nome do banco inicial |
| `db_username` | `string` | `techchallenge` | Usuário administrador |
| `db_instance_class` | `string` | `db.t4g.micro` | Família de instância RDS |
| `db_allocated_storage` | `number` | `20` | Tamanho do disco em GiB |

### `oficina-mecanica-infra-k8s` — variáveis

| Variável | Tipo | Default | Finalidade |
|---|---|---|---|
| `aws_region` | `string` | `us-east-1` | Região |
| `project_name` | `string` | `oficina-mecanica` | Base para tags |
| `environment` | `string` | `prod-simulated` | Nome do ambiente |
| `kubernetes_version` | `string` | `1.35` | Versão do EKS |
| `eks_cluster_role_name` | `string` | `""` | Role IAM do cluster (injetada via `vars.EKS_CLUSTER_ROLE_NAME`) |
| `eks_node_role_name` | `string` | `""` | Role IAM do node group (injetada via `vars.EKS_NODE_ROLE_NAME`) |
| `node_instance_type` | `string` | `t3.medium` | Tipo de instância do node group |
| `node_desired_size` | `number` | `1` | Nodes desejados |
| `k8s_namespace` | `string` | `oficina` | Namespace compartilhado |
| `enable_metrics_server` | `bool` | `true` | Instala o metrics-server (habilita o HPA) |

## Como aplicar localmente

Ordem de execução:

```bash
# 0) Informa o bucket de state ao backend e às leituras de remote state
export TF_STATE_BUCKET=<nome do bucket>
export TF_VAR_aws_base_state_bucket="$TF_STATE_BUCKET"
export TF_VAR_k8s_state_bucket="$TF_STATE_BUCKET"
export TF_VAR_database_state_bucket="$TF_STATE_BUCKET"
export TF_VAR_gateway_state_bucket="$TF_STATE_BUCKET"

# 1) Provisiona a fundação de rede AWS
cd oficina-mecanica-infra-base/terraform
# Inicializa os providers e o backend remoto desta stack
terraform init -backend-config="bucket=$TF_STATE_BUCKET"
# Revisa o plano interativo e aplica os recursos desta stack
terraform apply

# 2) Provisiona o banco de dados Amazon RDS
cd ../../oficina-mecanica-infra-database/terraform
# Inicializa os providers e o backend remoto desta stack
terraform init -backend-config="bucket=$TF_STATE_BUCKET"
# Revisa o plano interativo e aplica os recursos desta stack
terraform apply

# 3) Provisiona o cluster EKS, ECR, NLB e recursos base
cd ../../oficina-mecanica-infra-k8s/terraform
# Inicializa os providers e o backend remoto desta stack
terraform init -backend-config="bucket=$TF_STATE_BUCKET"
# Revisa o plano interativo e aplica os recursos desta stack
terraform apply -var="eks_cluster_role_name=<ROLE_CLUSTER>" -var="eks_node_role_name=<ROLE_NODE>"

# 4) Provisiona o API Gateway e o caminho privado até o NLB
cd ../../oficina-mecanica-api-gateway/terraform
# Inicializa os providers e o backend remoto desta stack
terraform init -backend-config="bucket=$TF_STATE_BUCKET"
# Revisa o plano interativo e aplica os recursos desta stack
terraform apply

# 5) Instala dependências e compila a Lambda antes de empacotá-la no Terraform
cd ../../oficina-mecanica-lambda-customer-auth/app
# Instala as dependências fixadas no lockfile
npm ci
# Gera app/dist, usado pelo archive_file do Terraform
npm run build

# Provisiona a função usando o diretório app/dist gerado pelo build
cd ../infra
# Inicializa os providers e o backend remoto desta stack
terraform init -backend-config="bucket=$TF_STATE_BUCKET"
# Revisa o plano interativo e aplica os recursos desta stack
terraform apply

# 6) Provisiona dashboards, monitores e teste sintético
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

Consulte os roteiros completos da [Lambda](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth/blob/main/docs/terraform.md) e de [monitoring](https://github.com/FIAP-15SOAT/oficina-mecanica-custom-monitoring/blob/main/README.md) para preparar as demais variáveis e credenciais. Os comandos acima usam os nomes publicados dos repositórios; adapte os caminhos se seus clones locais tiverem nomes diferentes.
