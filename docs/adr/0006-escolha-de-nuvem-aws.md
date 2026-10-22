# ADR 0006: Escolha de nuvem — AWS (EKS + RDS) no ambiente `prod-simulated`

## Status

Aceito — 2026-09-07

## Contexto

O projeto é acadêmico (FIAP, pós-graduação em Arquitetura de Software, turma 15SOAT), evoluído ao longo de 5 fases — a última exige demonstrar competência em containerização, orquestração via Kubernetes, infraestrutura como código (Terraform) e um pipeline de CI/CD com deploy automatizado, num ambiente que simula produção (`prod-simulated`).

O fator determinante desta decisão não foi uma avaliação técnica multi-cloud: o curso disponibiliza acesso via **AWS Academy**, uma conta de laboratório com um orçamento de crédito limitado (US$ 50) e restrições próprias do ambiente educacional — sem acesso à criação de roles/policies IAM (as roles usadas pelo EKS e pelos node groups são **pré-existentes**, lidas via `data source` no Terraform, nunca criadas pela infraestrutura do projeto), e sem o catálogo completo de serviços de uma conta comercial. Documentar essa restrição explicitamente é parte do rigor do projeto — sem ela, várias escolhas de infraestrutura registradas em [`docs/infra/overview.md`](../infra/overview.md) pareceriam arbitrárias.

## Decisão

Adotar a **AWS** como provedor de nuvem único do projeto, via conta AWS Academy, com:

- **Amazon EKS** (Kubernetes gerenciado) para orquestração dos containers da aplicação.
- **Amazon RDS** (PostgreSQL 16 gerenciado) para a persistência relacional, **fora do cluster**.
- **Terraform**, dividido em stacks com states independentes por camada (rede, plataforma Kubernetes, banco — ver [`docs/infra/overview.md`](../infra/overview.md#as-sete-camadas-de-provisionamento)), para toda a infraestrutura declarativa.
- **Amazon ECR** como registry de imagens da API, com scan on push e lifecycle policy.
- **Amazon CloudWatch** para logs do control plane do EKS.

## Alternativas consideradas

### Google Cloud Platform / Microsoft Azure

Tecnicamente comparáveis à AWS para este caso de uso (GKE e AKS ofereceriam Kubernetes gerenciado equivalente). Descartados porque o curso disponibiliza especificamente créditos e acesso à AWS Academy — não há sandbox educacional equivalente configurado para GCP ou Azure neste contexto. Sem essa restrição de acesso, a escolha entre os três seria uma decisão técnica genuína; aqui não foi.

### Amazon ECS / Fargate em vez de EKS

Teria menos partes móveis para operar — sem control plane de Kubernetes para gerenciar, custo potencialmente menor. Descartado porque o requisito da fase é demonstrar competência especificamente em **Kubernetes** (manifests declarativos, `Deployment`/`Service`/HPA, probes de liveness/readiness via a API do K8s) — ECS/Fargate não usa a API do Kubernetes, então não atenderia ao objetivo pedagógico da entrega.

### PaaS gerenciado (Render, Railway, Heroku, Fly.io)

Ofereceria deploy mais simples, sem gestão de infraestrutura nenhuma. Descartado pelo mesmo motivo do ECS/Fargate: não demonstra IaC nem Kubernetes, que são competências avaliadas nesta fase — e não haveria uso para o crédito AWS Academy já disponibilizado pelo curso.

### PostgreSQL self-hosted dentro do cluster (`StatefulSet`)

Foi a abordagem de uma fase anterior do projeto, e não uma alternativa hipotética: o Postgres rodou dentro do EKS num `StatefulSet` com volume `emptyDir` (efêmero, sem persistência real entre reagendamentos de pod), consequência direta de o EBS CSI Driver não ter credenciais IAM disponíveis no ambiente Academy (a conta lab bloqueia IAM/IRSA). A análise completa dessa tentativa (incluindo os diagnósticos de `CrashLoopBackOff` com `gp2`/`gp3`) está registrada em [ADR 0001 do `oficina-mecanica-infra-database`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database/blob/main/docs/adr/0001-banco-gerenciado-amazon-rds.md#postgresql-auto-hospedado-dentro-do-cluster-eks). Foi abandonada em favor do Amazon RDS, fora do cluster — a mesma direção que aquela análise já apontava.

## Consequências

### Positivas

- **RDS gerenciado** remove a necessidade de operar backup, patching de versão e failover do banco manualmente — ganho direto sobre a fase anterior (Postgres em `emptyDir`, que perdia todos os dados a cada reagendamento de pod).
- **EKS demonstra competência real e transferível em Kubernetes gerenciado** (HPA, probes, `Deployment`/`Service`, manifests declarativos) — o conhecimento não fica preso à AWS; a mesma base de manifests funcionaria, com ajustes, em GKE ou AKS.
- **Terraform em camadas com states independentes** (rede, plataforma, banco) permite evoluir ou recriar cada camada sem afetar as demais — detalhado em [`docs/infra/overview.md`](../infra/overview.md#as-sete-camadas-de-provisionamento).
- **ECR com scan on push e lifecycle policy** (mantém as últimas 20 imagens) mantém a superfície de imagens sob controle sem esforço manual.

### Negativas / Trade-offs

- **Vínculo à conta AWS Academy**: as roles IAM usadas pelo EKS e node groups são pré-existentes e lidas via `data source`, nunca criadas pelo Terraform do projeto — portar esta infraestrutura para uma conta AWS comercial exigiria criar e versionar essas roles, hoje fora do escopo do IaC.
- **Sem redundância real entre AZs**: node group fixo em 1 nó e um único NAT Gateway — o sistema é efetivamente single-AZ apesar de usar 2 subnets por camada (requisito do próprio EKS, não alta disponibilidade). Decisão consciente por orçamento de laboratório, detalhada em [`docs/infra/overview.md` › Limitações](../infra/overview.md#limitações-e-o-que-produção-exigiria).
- **Sem VPC endpoints**: tráfego de `pull` do ECR e acesso ao state no S3 saem pela internet via NAT/IGW, em vez de permanecerem na rede privada — custo e latência adicionais que uma conta de produção exigiria mitigar.
- **Custo do control plane do EKS** consome boa parte do crédito de laboratório disponível, o que restringe o restante da infraestrutura ao mínimo (RDS `db.t4g.micro`, Single-AZ) — trade-off aceito para poder demonstrar Kubernetes de verdade em vez de uma alternativa mais barata e menos representativa (ECS/Fargate).

### Riscos mitigados

- **Perda de dados por reagendamento de pod**: eliminado ao migrar do Postgres self-hosted (`emptyDir`) para o Amazon RDS, fora do cluster e com armazenamento persistente gerenciado.
- **Acoplamento de toda a infraestrutura a um único estado Terraform monolítico**: mitigado pela divisão em camadas (rede, plataforma Kubernetes, banco) com states próprios, cada uma consumindo a anterior via `data.terraform_remote_state` — trocar ou recriar uma camada não exige recriar as demais.

## Referências

- [`docs/infra/overview.md`](../infra/overview.md) — visão geral, camadas de provisionamento, inventário de componentes, limitações.
- [`docs/infra/terraform.md`](../infra/terraform.md) — stacks, estados remotos, entradas/saídas.
- [`docs/infra/kubernetes.md`](../infra/kubernetes.md) — manifests, histórico do armazenamento do PostgreSQL, health probes.
- AWS Academy: https://awsacademy.instructure.com/
