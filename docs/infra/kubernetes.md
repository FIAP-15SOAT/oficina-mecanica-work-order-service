# ☸️ Kubernetes

Divisão de responsabilidade: base e plataforma via Terraform no repositório [`oficina-mecanica-infra-k8s`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s); aplicação via manifests em `k8s/`.

> 🧭 Para a **visão de sistema** (inventário, topologia, fluxo em tempo de execução, segurança e limitações), comece pela [Visão Geral da Infraestrutura](overview.md). **Este documento é a referência em nível de manifesto**: como cada workload é configurado e por quê. As stacks Terraform de EKS e RDS são descritas em [terraform.md](terraform.md).

## Índice

- [Motivo da divisão](#motivo-da-divisão)
- [Ownership de recursos](#ownership-de-recursos)
- [Convenções: labels e wiring de configuração](#convenções-labels-e-wiring-de-configuração)
- [Recursos: CPU e memória (requests e limits)](#recursos-cpu-e-memória-requests-e-limits)
- [Banco de Dados Relacional (Amazon RDS)](#banco-de-dados-relacional-amazon-rds)
- [Manifestos da aplicação](#manifestos-da-aplicação)
- [Job de migração do banco](#job-de-migração-do-banco)
- [Autoscaling da API (HPA)](#autoscaling-da-api-hpa)
- [Acesso à aplicação](#acesso-à-aplicação-em-kubernetes)
- [Health probes](#health-probes)
- [Deploy manual](#deploy-em-kubernetes-manual)

Os recursos em Kubernetes foram divididos por responsabilidade:

- Base e dados críticos via Terraform ([`oficina-mecanica-infra-k8s`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s))
  - cluster EKS, ECR, namespace `oficina` e metrics-server (o banco relacional é **Amazon RDS**, provisionado em [stack própria](#banco-de-dados-relacional-amazon-rds), fora do cluster)
- Aplicação via manifests YAML (`k8s/`)
  - Secret, ConfigMap, Deployments, Services e HPA

## Motivo da divisão

- Recursos de plataforma e dados (cluster, namespace, DB, observabilidade mínima) têm ciclo de vida mais estável e exigem rastreabilidade de estado: por isso ficam no Terraform.
- Recursos da aplicação mudam com maior frequência (imagem, envs, escala): por isso ficam em manifests declarativos no diretório `k8s/` e são aplicados no deploy.

## Ownership de recursos

| Recurso | Ownership | Onde é definido/aplicado |
|---|---|---|
| Namespace `oficina` | Terraform | [`oficina-mecanica-infra-k8s`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s) (`terraform/k8s_namespace.tf`) |
| Banco de dados relacional (Amazon RDS PostgreSQL) | Terraform, em **stack própria** | [`oficina-mecanica-infra-database`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database) — **fora do cluster**; nenhum manifesto em `k8s/` define workload de banco |
| metrics-server | Terraform | [`oficina-mecanica-infra-k8s`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s) (`terraform/k8s_metrics_server.tf`) |
| DB migration Job (`00-db-migrate-job.yaml`) | Workflow de CD | Render + `kubectl apply` (job `db-migrate`) em `.github/workflows/cd.yml` |
| Database Secret (`database-credentials`) | Workflow de CD | Job `prepare-deploy`: descoberta RDS + `GetSecretValue` e manifesto JSON por stdin; não há YAML com valor versionado |
| Application Secret (`api-secret`; `01-api-secret.yaml` é referência) | Workflow de CD | Outro step de `prepare-deploy`: `kubectl create secret --from-literal` apenas para JWTs/chave pública |
| API ConfigMap (`02-api-configmap.yaml`) | Workflow de CD | Job `prepare-deploy`: render de `OTEL_EXPORTER_OTLP_ENDPOINT` a partir de GitHub Actions Variables via `envsubst` + `kubectl apply` |
| API Deployment (`03-api-deployment.yaml`) | Workflow de CD | Render + `kubectl apply` em `.github/workflows/cd.yml` |
| MailHog Deployment (`03-mailhog-deployment.yaml`) | Workflow de CD | `kubectl apply` em `.github/workflows/cd.yml` (dependência de e-mail) |
| API Service (`04-api-service.yaml`) | Workflow de CD | `kubectl apply` em `.github/workflows/cd.yml` |
| MailHog Service (`04-mailhog-service.yaml`) | Workflow de CD | `kubectl apply` em `.github/workflows/cd.yml` (SMTP `1025` / Web UI `8025`) |
| API HPA (`05-api-hpa.yaml`) | Workflow de CD | `kubectl apply` em `.github/workflows/cd.yml` |

## Convenções: labels e wiring de configuração

**Labels.** Todos os recursos carregam as labels recomendadas do Kubernetes, o que permite selecioná-los e agrupá-los de forma consistente:

- `app.kubernetes.io/name` — identifica o componente (`oficina-api`, `mailhog`, `db-migrate-job`).
- `app.kubernetes.io/part-of` — sempre `oficina-mecanica` (a solução como um todo).
- `managed-by: terraform` — presente apenas nos recursos provisionados pelo Terraform (`oficina-mecanica-infra-k8s`), distinguindo-os dos manifests aplicados pelo CD.

**Wiring de configuração.** A configuração da API é injetada como variáveis de ambiente a partir de três fontes, separando ownership e sensibilidade:

- `configMapKeyRef` → `api-config` (`ConfigMap`, **não sensível**): `NODE_ENV`, `PORT`, `JWT_EXPIRATION`, `JWT_REFRESH_EXPIRATION`, `BCRYPT_SALT_ROUNDS`, `MAIL_HOST`, `MAIL_PORT`, `TZ`, `CUSTOMER_JWT_ISSUER`, `CUSTOMER_JWT_AUDIENCE`, `LOG_LEVEL`, `OTEL_SERVICE_NAME`, `OTEL_SERVICE_NAMESPACE`, `TRUSTED_PROXY_CIDRS`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_LOGS_EXPORTER` e `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE`.
- `secretKeyRef` → `database-credentials` (`Secret`, **sensível**): somente `DATABASE_URL`, materializada pelo CD a partir de RDS/Secrets Manager.
- `secretKeyRef` → `api-secret` (`Secret` da aplicação): `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CUSTOMER_JWT_PUBLIC_KEY`.

`CUSTOMER_JWT_ISSUER`/`CUSTOMER_JWT_AUDIENCE` são valores fixos e não secretos (identificadores de emissor/audiência do token externo), por isso vivem no ConfigMap; `CUSTOMER_JWT_PUBLIC_KEY` fica no Secret por uniformidade de injeção com os demais valores usados pela validação de JWT, embora uma chave pública não exija sigilo.

O Deployment referencia cada chave individualmente (`valueFrom`), o que torna explícito no manifesto de onde vem cada env — em vez de um `envFrom` opaco.

> ⚠️ **Formato do `CUSTOMER_JWT_PUBLIC_KEY` no GitHub Secret.** O job `prepare-deploy` do `cd.yml` cria o Secret de forma **imperativa** (`kubectl create secret generic ... --from-literal=CUSTOMER_JWT_PUBLIC_KEY="${CUSTOMER_JWT_PUBLIC_KEY}" --dry-run=client -o yaml | kubectl apply -f -`). `--from-literal` aceita o PEM com quebras de linha reais e o próprio `kubectl` faz o escape ao montar o Secret. **Por isso o GitHub Secret pode ser cadastrado com o PEM no formato natural, multilinha, exatamente como o `openssl` ou a autoridade certificadora o gerou**.
>
> A [documentação de CI/CD](ci-cd.md#injeção-de-secrets-da-aplicação) explica por que interpolar esse PEM diretamente com `envsubst` pode quebrar o YAML e detalha a criação imperativa do Secret.
>
> A conversão para uma linha com `\n` literais (a que `app/.env.example` usa) continua necessária **apenas para o `.env` local**: arquivos `.env` não suportam valores multilinha sem aspas, e o parser usado pelo projeto não desfaz esse escape sozinho — por isso `CustomerJwtStrategy` (`customer-jwt.strategy.ts`) aplica `.replaceAll(String.raw`\n`, '\n')` na leitura da env var. Esse mesmo `replaceAll` é um no-op inofensivo quando o valor já chega com quebras de linha reais (como no Secret do cluster), então o código funciona sem alteração nos dois ambientes. Para gerar a versão de uma linha para o `.env`:
>
> ```bash
> awk 'NF {sub(/\r/, ""); printf "%s\\n", $0}' public.pem
> ```

**Telemetria.** Três chaves controlam o SDK do OpenTelemetry, e a primeira é o interruptor:

| Chave | Valor no ConfigMap | Efeito |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Renderizado de `vars.OTEL_EXPORTER_OTLP_ENDPOINT` | É o interruptor do SDK: vazio desliga instrumentações e exportadores; preenchido ativa traces e métricas para o endpoint informado. Com o Agent do projeto, usar o **DNS do Service** (`http://datadog-agent.oficina.svc:4318`), nunca `status.hostIP` via Downward API |
| `OTEL_LOGS_EXPORTER` | `none` | A **ausência** desta chave faria o SDK instanciar um `LoggerProvider` com exportador OTLP de rede. Os logs têm um caminho único — o stdout do contêiner, lido pelo coletor |
| `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` | `delta` | O OTel JS exporta cumulative por padrão, e os destinos compatíveis esperam delta; cumulative descarta pontos na inicialização do processo |

O manifesto contém um placeholder, não um estado fixo. A cada deploy, o workflow lê `vars.OTEL_EXPORTER_OTLP_ENDPOINT`, renderiza `02-api-configmap.yaml` e aplica o resultado. Variável ausente ou vazia produz uma chave vazia e mantém o SDK desligado; qualquer URL válida ativa a exportação sem rebuild da imagem. O `app-deploy` aplica o Deployment renderizado com a imagem do commit e aguarda o rollout corrente; não executa `rollout restart`.

### Camada de coleta

Os manifestos do agente vivem em `k8s/06-datadog-secret.yaml` (chave por `envsubst`, nunca committada), `k8s/07-datadog-agent.yaml` (ServiceAccount + RBAC somente-leitura + DaemonSet) e `k8s/08-datadog-service.yaml` (ClusterIP expondo `4318`). É a **única peça do sistema que conhece o fornecedor**: a aplicação exporta OTLP puro, sem dependência, cabeçalho ou credencial de plataforma.

O CD aplica o Agent quando `vars.ENABLE_TELEMETRY_COLLECTION == 'true'`. O node group usa `t3.medium`, com teto de 17 pods pela configuração atual do VPC CNI. O workflow exige `DD_API_KEY` como secret; `OTEL_EXPORTER_OTLP_ENDPOINT=http://datadog-agent.oficina.svc:4318` é a configuração da aplicação para exportar ao Service do Agent.

Os dois controles continuam independentes: `ENABLE_TELEMETRY_COLLECTION` instala ou remove da execução do CD a camada do Agent; `OTEL_EXPORTER_OTLP_ENDPOINT` liga ou desliga o SDK da aplicação. Assim é possível manter apenas logs/métricas de infraestrutura pelo Agent com o endpoint vazio, ou apontar a aplicação para outro coletor OTLP.

⚠️ `OTEL_RESOURCE_ATTRIBUTES` **não** entra aqui com nenhum dos cinco atributos compartilhados (`service.name`, `service.namespace`, `service.version`, `service.instance.id`, `deployment.environment.name`): o detector de ambiente do SDK **vence** o resource montado em código, e o caminho de log não lê essa variável — trace e log passariam a reportar valores diferentes, em silêncio, desligando a navegação cruzada entre sinais. Os cinco continuam vindo de `OTEL_SERVICE_NAME`, `OTEL_SERVICE_NAMESPACE`, `SERVICE_VERSION` (assada na imagem) e `NODE_ENV`, que **ambos** os caminhos leem. Ver [ADR 0005](../adr/0005-opentelemetry.md).

### Classificação e atribuição dos logs de contêiner

O log **não** passa por OTLP (`OTEL_LOGS_EXPORTER: none`): o caminho é o stdout do contêiner, lido pelo agente com `DD_LOGS_CONFIG_CONTAINER_COLLECT_ALL`. Isso muda duas coisas em relação ao trace e à métrica, que leem o resource do OTel.

**Severidade vem do stream, não do conteúdo.** Sem pipeline de integração, o coletor deriva o status do canal de saída: **stdout → `info`, stderr → `error`**. Escapa disso apenas quem emite JSON com nível próprio — que é o caso da API, cujo envelope carrega `level` (ver [ADR 0002](../adr/0002-logging-estruturado.md)). Todo o resto do node é classificado pelo canal, e é por isso que aparecem como `error` linhas perfeitamente normais de `kube-proxy`, `coredns`, `metrics-server` e `aws-node`: são componentes em Go, e o `klog` escreve em stderr. **Não é defeito da aplicação nem do coletor** — e a contrapartida é que a falha de verdade desses componentes chega pelo mesmo canal, então filtrá-la fora custaria o sinal junto com o ruído. A exclusão feita no agente (`DD_CONTAINER_EXCLUDE_LOGS`) alcança o MailHog, o próprio agente e o `kube-proxy`. Os dois primeiros eram ruído de probe sem contrapartida de sinal; o terceiro é a maior fatia isolada do índice depois da própria aplicação, quase toda classificada como `error` pelo motivo acima. O que o `kube-proxy` registra é sincronização de regra de iptables, e uma falha de rede real aparece antes na aplicação — o que o torna o único dos quatro componentes em Go cuja exclusão não custa sinal junto com o ruído. `coredns`, `metrics-server` e `aws-node` **continuam sendo coletados**: ali a falha do componente é o próprio sinal.

**`HOST_PROC` é contorno de defeito, não configuração de coleta.** A partir da 7.61.0 o pipeline de ingestão OTLP do agente falha na inicialização com `failed to register process metrics: process does not exist` quando `/proc` do host está montado em `/host/proc` — que é a montagem deste DaemonSet. O sintoma é traiçoeiro: o pod fica `Running` e `Ready`, a porta 4318 aparece no Service, e a aplicação recebe `ECONNREFUSED` porque **nada escuta ali**. `HOST_PROC: /proc` é um dos contornos publicados no [issue #32947](https://github.com/DataDog/datadog-agent/issues/32947).

Não remova esta variável junto com uma atualização do agente sem antes confirmar que a 4318 continua escutando:

```sh
kubectl exec -n oficina ds/datadog-agent -- ss -lntp | grep 4318
```

**Nome de operação do APM.** Até a 7.65, o agente nomeava a operação de um span OTLP pelo **escopo de instrumentação**, e o que aparecia no APM era literalmente `opentelemetry_instrumentation_http.server` — com as métricas de trace derivadas herdando esse nome. A partir da **7.66** a lógica de mapeamento v2 é o padrão na ingestão OTLP via agente. A imagem 7.83.1 está acima desse piso; nesta solução, as operações vigentes são `http.server.request` para HTTP e `postgresql.query` para PostgreSQL, sem consumidores baseados nos nomes anteriores dos escopos de instrumentação.

Nenhum dashboard ou monitor da solução consulta `trace.*`: a latência permanece na métrica OTLP `http.server.request.duration`, cujo nome é definido pela convenção semântica. A versão do agente não migra os consumidores nem substitui a decisão sobre dimensões e amostragem.

**Atribuição de serviço vem de label, não do resource.** Como o log não passa por OTLP, o agente não enxerga `service.name` e cai no **nome da imagem** — o que fazia a mesma aplicação aparecer como `ecr-oficina-mecanica-app-repo` no log e `oficina-mecanica-work-order-service` no APM, quebrando a aba Logs da página do serviço e qualquer métrica derivada de log. As labels de Unified Service Tagging no `spec.template.metadata.labels` resolvem:

| Workload | `tags.datadoghq.com/service` | Manifesto |
|---|---|---|
| API | `oficina-mecanica-work-order-service` | `k8s/03-api-deployment.yaml` |
| Job de migração | `oficina-mecanica-work-order-service-db-migrate` | `k8s/00-db-migrate-job.yaml` |

Os dois valores são **deliberadamente diferentes**. Job e Deployment compartilham a imagem, mas são workloads distintos com ciclo de vida distinto: unificá-los encheria a aba Logs da API com saída de migração a cada deploy — que é o problema que as labels vieram resolver, só que com outro nome.

⚠️ As labels são valores **espelhados**, não derivados: label de Kubernetes não referencia ConfigMap. `service` precisa seguir igual a `OTEL_SERVICE_NAME` e `env` igual a `NODE_ENV`, ambos em `02-api-configmap.yaml`, de onde o resource do OTel tira `service.name` e `deployment.environment.name`. **Mudou lá, muda aqui** — não há verificação automática.

## Recursos: CPU e memória (requests e limits)

Cada workload declara `requests` (o que o scheduler reserva) e `limits` (o teto antes de throttling/OOM-kill):

| Workload | Requests (CPU / memória) | Limits (CPU / memória) | Fonte |
|---|---|---|---|
| API (`oficina-api`) | `200m` / `256Mi` | `500m` / `512Mi` | `k8s/03-api-deployment.yaml` |
| MailHog | `50m` / `64Mi` | `200m` / `256Mi` | `k8s/03-mailhog-deployment.yaml` |
| Job `db-migrate` | — (não define) | — (não define) | `k8s/00-db-migrate-job.yaml` |

## Banco de Dados Relacional (Amazon RDS)

A persistência relacional da aplicação é fornecida pelo **Amazon RDS (PostgreSQL)**, gerenciado no repositório dedicado [`oficina-mecanica-infra-database`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database):

- Instância gerenciada PostgreSQL 16 (Single-AZ, `db.t4g.micro`, 20 GiB GP3).
- Alocado nas subnets privadas da VPC, com Security Group restrito ao CIDR da VPC.
- A master password é gerada e mantida pelo RDS em um Secret do AWS Secrets Manager, com rotação automática desabilitada. O Terraform conhece ARN/status/KMS e metadados de conexão, não o valor da senha; `sensitive` sozinho não impediria sua presença no State.
- O job `prepare-deploy` do CD descobre o Secret e o endpoint pelo identificador da instância, lê `AWSCURRENT` e materializa `DATABASE_URL` em `database-credentials` usando Node.js inline e manifesto JSON por stdin, com os parâmetros descritos em [Conexão obrigatoriamente cifrada (TLS)](#conexão-obrigatoriamente-cifrada-tls). Migration/seed ficam somente no job `db-migrate` seguinte.

O [ADR de database sobre RDS](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database/blob/main/docs/adr/0001-banco-gerenciado-amazon-rds.md#postgresql-auto-hospedado-dentro-do-cluster-eks) preserva o diagnóstico histórico das tentativas de persistência com EBS CSI no EKS e as razões para abandonar `emptyDir`/`hostPath`.

### Conexão obrigatoriamente cifrada (TLS)

O parameter group `default.postgres16` traz **`rds.force_ssl = 1`** — padrão do sistema desde o PostgreSQL 15, não uma escolha desta stack. O servidor recusa qualquer conexão sem criptografia com `no pg_hba.conf entry for host "...", user "...", no encryption`, um SQLSTATE `28000` que o Prisma reporta como **`P1010 "User was denied access on the database"`**: uma mensagem de permissão para o que é, na verdade, ausência de TLS.

Por isso a `DATABASE_URL` de `database-credentials` termina em **`sslmode=require&uselibpqcompat=true`**. A mesma URL é lida por **dois clientes com defaults opostos**:

| Consumidor | Cliente | Sem `sslmode` na URL |
|---|---|---|
| `prisma migrate deploy` | motor Rust do Prisma | assume `sslmode=prefer` e negocia TLS sozinho |
| `prisma db seed` e o `pg.Pool` do `PrismaService` | node-postgres | **não usa TLS algum** |

A assimetria produz um sintoma enganoso: a migração passa e o seed falha. E, se o seed não estivesse no caminho, a falha só apareceria adiante — no `$connect()` do `onModuleInit` da API, com a readiness nunca ficando pronta.

`require` sozinho não fecha o caso: no parser do `pg` ele hoje equivale a `verify-full`, e a cadeia do RDS termina na raiz **autoassinada** `Amazon RDS <região> Root CA RSA2048 G1`, que não está no truststore do Node — a conexão passaria a falhar na validação do certificado, trocando um erro por outro. **`uselibpqcompat=true`** dá a `require` a semântica do libpq (cifra sem validar a cadeia) e é a grafia que o próprio `pg` recomenda para o comportamento que valerá a partir do `pg` v9. O motor do Prisma descarta a chave que não conhece e segue exigindo TLS por `require`.

Validar a cadeia exigiria embarcar o bundle de CAs do RDS na imagem e nomeá-lo **duas vezes** na URL — `sslrootcert` para o `pg`, `sslcert` para o Prisma —, com o PEM entrando no ciclo de rotação. Com o RDS em subnet privada e Security Group restrito à VPC, o risco residual é MITM interno à VPC, e a troca não se paga aqui.

O ambiente local não carrega esses parâmetros: `docker-compose` e Testcontainers sobem PostgreSQL sem TLS, e a `DATABASE_URL` do `.env` continua sem `sslmode`.

## Manifestos da aplicação

Arquivos em `k8s/`:

- `00-db-migrate-job.yaml`: Job **one-shot** de migração/seed do banco (`prisma migrate deploy` + `db seed`), com placeholders de nome (`JOB_NAME_PLACEHOLDER`) e imagem (`IMAGE_URI_PLACEHOLDER`); renderizado e aplicado pelo job `db-migrate` do CD antes do rollout — não é um recurso de estado da aplicação, por isso o prefixo `00-`. Detalhes em [Job de migração do banco](#job-de-migração-do-banco)
- `01-api-secret.yaml`: referência apenas dos secrets da aplicação (`JWT_SECRET`, `JWT_REFRESH_SECRET` e `CUSTOMER_JWT_PUBLIC_KEY`) para deploy manual; `DATABASE_URL` pertence ao Secret separado `database-credentials`
- `02-api-configmap.yaml`: variáveis não sensíveis da aplicação (`NODE_ENV`, `PORT`, `JWT_EXPIRATION`, `JWT_REFRESH_EXPIRATION`, `BCRYPT_SALT_ROUNDS`, `MAIL_HOST`, `MAIL_PORT`, `TZ`, `LOG_LEVEL`, `OTEL_SERVICE_NAME`, `OTEL_SERVICE_NAMESPACE`, `TRUSTED_PROXY_CIDRS`, `CUSTOMER_JWT_ISSUER`, `CUSTOMER_JWT_AUDIENCE` e as chaves de telemetria); o placeholder de `OTEL_EXPORTER_OTLP_ENDPOINT` é renderizado pelo CD a partir da variável homônima do GitHub Actions
- `03-api-deployment.yaml`: deployment da API com placeholder de imagem, `imagePullPolicy: Always`, consumo de Secret/ConfigMap (ver [wiring de configuração](#convenções-labels-e-wiring-de-configuração)) e probes de saúde
- `03-mailhog-deployment.yaml`: deployment do MailHog para captura de e-mails enviados pela aplicação
- `04-api-service.yaml`: Service **`NodePort`** da API (`3000` → `30080` nos nós). `NodePort` é um superconjunto de `ClusterIP`: o Service continua recebendo um ClusterIP e o DNS interno segue igual. A porta dos nós é o destino do target group do NLB interno provisionado em `oficina-mecanica-infra-k8s`, que por sua vez é o backend da integração privada do [API Gateway](https://github.com/FIAP-15SOAT/oficina-mecanica-api-gateway). O valor precisa casar com `api_node_port` naquele repositório
- `04-mailhog-service.yaml`: Service `ClusterIP` do MailHog, expondo as portas SMTP (`1025`) e Web UI (`8025`) para acesso interno ao cluster
- `05-api-hpa.yaml`: autoscaling da API por CPU e memória (HPA v2) — ver [Autoscaling da API (HPA)](#autoscaling-da-api-hpa)

## Job de migração do banco

O `00-db-migrate-job.yaml` é um `Job` do Kubernetes executado **uma vez por deploy**, antes do rollout da API, para deixar o schema em dia. Características relevantes:

- **`backoffLimit: 0` + `restartPolicy: Never`** — falha rápido, sem retentativas silenciosas: se a migração falhar, o Job falha imediatamente e o pipeline para (em vez de mascarar o erro com reinícios).
- **`ttlSecondsAfterFinished: 1209600`** — o Job é coletado automaticamente **14 dias** após terminar, evitando acúmulo de Jobs concluídos no namespace (cada run cria um Job com nome renderizado, via `JOB_NAME_PLACEHOLDER`).
- **Consumo da `DATABASE_URL`** — o container recebe `DATABASE_URL` via `secretKeyRef` de `database-credentials` e executa:

  ```sh
  set -e
  npx prisma migrate deploy
  npx prisma db seed
  ```

- **`prisma migrate deploy`** aplica apenas migrations pendentes (não-destrutivo) e **`prisma db seed`** é idempotente.
- ⚠️ **O `set -e` é o que torna verdadeiro o parágrafo do `backoffLimit: 0` acima.** O status de saída de `sh -c` é o do **último** comando: sem ele, uma migração que falha seguida de um seed que passa faz o Job terminar com **sucesso**, e o CD segue para o rollout com o schema desatualizado — exatamente o mascaramento que o `backoffLimit: 0` existe para impedir, só que um nível abaixo, onde ele não alcança.
- **`PRISMA_HIDE_UPDATE_MESSAGE: "true"`** — o verificador de versão do Prisma CLI escreve uma caixa de 10 linhas em **stderr**, e o coletor classifica stderr como `error`. Uma migração bem-sucedida pintava dez linhas vermelhas por deploy, sobre um `npm i` que ninguém executa dentro de um contêiner. O restante do stderr do CLI fica: são poucas linhas e é o mesmo canal que carrega a falha **real** (`P1001`, `P3009`), que precisa continuar vermelha — e é por isso que também não se redireciona `2>&1` aqui. Ver [Classificação e atribuição dos logs de contêiner](#classificação-e-atribuição-dos-logs-de-contêiner).
- **O seed é o primeiro consumidor node-postgres do pipeline** — e, por isso, o primeiro a expor uma `DATABASE_URL` sem parâmetros de TLS, já que o `migrate deploy` negocia a criptografia por conta própria. Ver [Conexão obrigatoriamente cifrada (TLS)](#conexão-obrigatoriamente-cifrada-tls).

## Autoscaling da API (HPA)

O `05-api-hpa.yaml` (HPA `autoscaling/v2`) escala o Deployment `oficina-api` com base em **duas métricas de recurso**:

| Campo | Valor |
|---|---|
| `scaleTargetRef` | `Deployment/oficina-api` |
| `minReplicas` / `maxReplicas` | `1` / `5` |
| CPU (`Resource`, `averageUtilization`) | `70` |
| Memória (`Resource`, `averageUtilization`) | `80` |

`averageUtilization` é medido como **percentual da `request`** do pod — por exemplo, 70% de CPU significa 70% dos `200m` requisitados pela API (≈ `140m` de média entre as réplicas) como gatilho para escalar. O HPA escala quando **qualquer** das duas métricas ultrapassa seu alvo. As métricas vêm do **metrics-server** (provisionado em `oficina-mecanica-infra-k8s`); sem ele, o HPA não teria dados para decidir.

O HPA escala apenas os **pods da API** (`1→5`); a escala do _cluster_ (nodes) está fora do escopo — o node group é mantido fixo em 1 por decisão, como registrado em [overview.md › Limitações](overview.md#limitações-e-o-que-produção-exigiria).

⚠️ **O `maxReplicas: 5` compartilha a capacidade de um único node com os workloads de sistema.** Pela fórmula padrão do VPC CNI (sem prefix delegation), o `t3.medium` configurado permite **17 pods**. Nesse teto entram `coredns` ×2, `aws-node`, `kube-proxy`, `metrics-server`, `mailhog`, o DaemonSet do Agent e as réplicas da API. O valor observado no cluster pode ser consultado com:

```bash
kubectl get node -o jsonpath='{.items[*].status.allocatable.pods}'
```

O `node_instance_type` é definido em `oficina-mecanica-infra-k8s`; o valor atual é `t3.medium`.

## Acesso à aplicação em Kubernetes

A aplicação tem **dois** caminhos de acesso.

**Público**, para uso real: pelo endereço do [API Gateway](https://github.com/FIAP-15SOAT/oficina-mecanica-api-gateway), que alcança o cluster por VPC Link → NLB interno → NodePort `30080`. Nada disso tem IP público: o Service é `NodePort`, mas a porta só é alcançável de dentro da VPC.

**Diagnóstico**, para testes e validações manuais: `kubectl port-forward`. O Service `NodePort` também possui `ClusterIP`, portanto suporta o túnel e o DNS interno.

```bash
kubectl port-forward -n oficina svc/oficina-api 3000:3000
```

Após estabelecer o túnel, a aplicação poderá ser acessada localmente através dos seguintes endereços:

- API: `http://localhost:3000`
- Swagger: `http://localhost:3000/api/docs`

Para interromper o túnel, pressione `Ctrl+C` no terminal onde o comando estiver em execução.

Caso seja necessário validar se o Service possui endpoints disponíveis:

```bash
kubectl get endpoints oficina-api -n oficina
```

Para acessar a interface web do MailHog executando no cluster:

```bash
kubectl port-forward -n oficina svc/mailhog 8025:8025
```

A interface ficará disponível em:

- MailHog: `http://localhost:8025`

## Health probes

Cada workload usa o **mecanismo de probe mais adequado ao que expõe**:

| Workload | Mecanismo | Alvo |
|---|---|---|
| API (`oficina-api`) | HTTP `GET` | `/api/health/live` e `/api/health/ready` (porta 3000) |
| MailHog | TCP socket | porta `1025` (SMTP) |

O MailHog não tem endpoint HTTP de health dedicado, então um **TCP check** na porta SMTP (`1025`) basta para saber que o processo está de pé. A API expõe HTTP e tem endpoints de saúde próprios, então usa probes HTTP.

**Não existe probe de banco de dados aqui.** A persistência relacional é [Amazon RDS, fora do cluster](#banco-de-dados-relacional-amazon-rds); nenhum manifesto em `k8s/` define workload de PostgreSQL, e portanto não há `pg_isready` a descrever. Quem reporta a capacidade da aplicação de **alcançar** o banco é a `readinessProbe` da API. Diagnóstico de `/ready` falhando em produção começa nos eventos do pod, no DNS e no Security Group da VPC, e nas métricas da instância RDS — não em `kubectl logs` de um pod de banco, que não existe.

### Três probes, dois endpoints

A API expõe dois endpoints de saúde com semânticas **opostas e deliberadamente separadas** (contrato em [api.md](../api.md#exceção-as-rotas-de-saúde) e o registro da decisão em [ADR 0003](../adr/0003-health-checks.md)):

- `GET /api/health/live` — não executa I/O algum. Responde à única pergunta cujo remédio é **reiniciar o processo**.
- `GET /api/health/ready` — verifica o PostgreSQL (`SELECT 1`, com prazo próprio) e o estado de encerramento. Responde à pergunta de **roteamento de tráfego**.

O `startupProbe` e o `livenessProbe` apontam ambos para `/live`; só o `readinessProbe` aponta para `/ready`.

**Por que o `startupProbe` não aponta para readiness:** a falha de um `startupProbe` **mata o container**. Apontá-lo para uma verificação de dependência externa recriaria exatamente a armadilha que a separação existe para evitar — com o banco fora, toda a frota entraria em reinício sucessivo com espera crescente, somando indisponibilidade a um sistema já degradado. Startup é uma *probe*, não uma semântica de saúde distinta, e por isso reusa o endpoint de vivacidade em vez de exigir um terceiro.

**O que o `startupProbe` cobre, e o que não cobre:** só a inicialização da própria aplicação. Com Prisma 7 + `@prisma/adapter-pg` o `$connect()` é preguiçoso — ele não abre conexão física —, então um pod criado com o banco indisponível **sobe normalmente**, passa no startup, responde `/live` = 200 e `/ready` = 503, e se recupera sozinho quando o banco volta, sem `CrashLoopBackOff` e sem reinício. Alcançabilidade do banco pertence ao orçamento da readiness, nunca ao do startup.

### Parâmetros, e a característica que determina cada um

| Parâmetro | `startupProbe` | `livenessProbe` | `readinessProbe` |
|---|---|---|---|
| Alvo | `/api/health/live` | `/api/health/live` | `/api/health/ready` |
| `initialDelaySeconds` | `0` | `0` | `0` |
| `periodSeconds` | `5` | `20` | `10` |
| `timeoutSeconds` | `3` | `5` | `5` |
| `failureThreshold` | `12` | `3` | `3` |
| `successThreshold` | `1` | `1` | `1` |

**Nenhum parâmetro fica implícito**, e isso é decisão, não estilo: o `timeoutSeconds` default do kubelet é **1 s**, menor que o prazo próprio de 3,5 s da verificação de prontidão — deixá-lo herdado faria a probe abortar antes de a aplicação responder, e o desfecho seria interrupção pelo cliente, sem categoria de causa.

| Parâmetro | Derivado de |
|---|---|
| `startupProbe` `12 × 5 s` = **60 s de orçamento** | Boot da aplicação **só** — nada de banco entra aqui (ver acima). 60 s cobre com folga um boot de Nest + módulos, e o período curto faz o pod ficar `Ready` cedo no caminho feliz |
| `initialDelaySeconds: 0` nas três | Com `startupProbe` presente, liveness e readiness não rodam antes de ele passar. Mas o kubelet conta `initialDelaySeconds` a partir de `container.State.Running.StartedAt`, **não** do sucesso do startup — um valor herdado seria parcialmente consumido em vez de somado, e a temporização real ficaria diferente da aparente. `0` é o único valor que não exige explicação |
| `livenessProbe` `periodSeconds: 20`, `failureThreshold: 3` | 60 s de tolerância antes de reiniciar — a mais folgada das três, porque reiniciar destrói requisições em voo enquanto desregistrar é reversível |
| `livenessProbe` `timeoutSeconds: 5` | Quanto bloqueio do laço de eventos se tolera antes de considerar o processo travado, sob `limits.cpu: 500m` — onde pausa de GC e throttling são plausíveis, **e** onde o destino de log é `pino.destination({ sync: true })`: se o coletor parar de drenar, o `sonic-boom` entra em espera bloqueante e segura o laço ([ADR 0002](../adr/0002-logging-estruturado.md)). Essa condição é **compartilhada por toda a frota**, como o banco, então apertar aqui converteria um soluço do coletor em restart loop geral |
| `readinessProbe` `periodSeconds: 10` | Quanto tempo se aceita rotear tráfego para uma instância que já não atende |
| `readinessProbe` `timeoutSeconds: 5` | Maior que o prazo próprio da verificação (3,5 s) somado à margem de rede. O prazo próprio, por sua vez, é maior que o `connectionTimeoutMillis` do pool (3 s): um prazo menor responderia **antes** de a falha de aquisição se manifestar e a classificaria como `timeout`, apagando a categoria `pool` justamente no caso que a readiness existe para detectar |
| `readinessProbe` `failureThreshold: 3` | Compromisso explícito, e ele **erra para o lado de demorar a retirar**: 30 s de falha sustentada antes de sair do balanceamento. Como o RDS é compartilhado por todas as réplicas, um valor baixo faria uma oscilação transitória retirar as réplicas de uma vez; o custo do valor escolhido é servir erro por até 30 s numa falha por-réplica, que é o caso mais raro |
| `successThreshold: 1` | O Kubernetes exige `1` em liveness e startup. A verificação é determinística, então `1` também na readiness — e recuperação rápida é desejável dado o `failureThreshold` alto |
| `terminationGracePeriodSeconds: 40` | Ver [Encerramento gracioso](#encerramento-gracioso-e-terminationgraceperiodseconds) |

### As sete relações que precisam continuar valendo

Se qualquer número acima mudar, **estas relações são o que deve ser reverificado**:

1. `prazo próprio da verificação (3,5 s) + margem de rede < readinessProbe.timeoutSeconds (5 s)`.
2. `orçamento de startup = failureThreshold × periodSeconds = 12 × 5 = 60 s`.
3. `image pull + scheduling + boot + orçamento de startup + 1ª readiness OK + propagação < rollout gate do CD` (`--timeout=180s`, em `.github/workflows/cd.yml`). Com 60 s de orçamento sobra margem folgada; um orçamento de 300 s — o exemplo canônico da documentação do Kubernetes, `30 × 10` — faria o CD desistir **antes** de a probe concluir que o container é irrecuperável, trocando um diagnóstico correto por uma falha de pipeline.
4. `terminationGracePeriodSeconds (40 s) > janela de drain (10 s) + fechamento do servidor + $disconnect() + margem`.
5. `tolerância da liveness até reinício = failureThreshold × periodSeconds = 3 × 20 = 60 s`. Apertar esse produto torna a liveness mais sensível e converte soluço transitório em reinício, pelo motivo registrado na tabela acima.
6. `connectionTimeoutMillis do pool (3 s) < prazo próprio da verificação (3,5 s)`. Inverter isso volta a mascarar saturação de pool como `timeout` — a categoria de causa deixa de distinguir o que ela existe para distinguir.
7. `connectionTimeoutMillis (3 s) + query_timeout da verificação (2 s) = 5 s < readinessProbe.periodSeconds (10 s)`. É o pior caso para a operação subjacente **assentar** e liberar o slot único; se ele passar do período, uma consulta presa atrasa a recuperação por mais de uma probe.

### Encerramento gracioso e `terminationGracePeriodSeconds`

O par `terminationGracePeriodSeconds` ↔ **janela de drain da aplicação** é o que faz um rollout drenar em vez de descartar requisições em voo:

1. O pod é deletado; o endpoint correspondente no EndpointSlice é marcado **não pronto pela própria deleção**, sem depender de uma nova falha de probe.
2. O kubelet envia `SIGTERM`. A aplicação marca o estado `draining` — `/ready` passa a responder `503` **antes** de o servidor parar de aceitar — e sustenta esse estado por **10 s**, dimensionados pela propagação da remoção no plano de dados (EndpointSlice → kube-proxy, tipicamente 1–5 s) somada a um orçamento para requisições já roteadas.
3. Só depois da janela o servidor HTTP fecha e **só então** o pool do banco é liberado. Liberá-lo antes converteria "descartar requisição em voo" em "responder erro", que é pior do que não ter janela.
4. `/live` continua respondendo `200` durante toda a janela: a instância está encerrando de forma ordenada, não travada, e reiniciá-la interromperia o próprio encerramento.

Os 40 s do grace period são a relação 4 acima, e são mantidos baixos de propósito — ele alonga node drain e evicção. Estourá-lo é `SIGKILL`. A janela é declarada como **orçamento fixo e de melhor esforço**: enquanto houver operação sem prazo próprio no caminho de requisição (hoje o envio de e-mail dentro da transação, sem timeouts SMTP), não há garantia de que toda requisição em voo termine dentro dela.

*Nota de mecânica:* o `kubectl rollout status` **não** espera o `terminationGracePeriodSeconds` — pods com `DeletionTimestamp` saem da contagem de ativos do ReplicaSet —, então subir o grace period não consome o gate do CD.

### Custo em log

As rotas de saúde ficam **dentro** da fronteira de cobertura do access log — são rotas do router do Nest e não escapam por ordem de middleware, como escapam as rotas servidas pelo Swagger. A supressão silencia **apenas o sucesso**; uma probe que falha preserva a linha completa. Ver [architecture.md](../architecture.md).

## Deploy em Kubernetes (manual)

> O caminho canônico de deploy manual é `workflow_dispatch`, pois ele descobre e materializa a credencial sem expô-la. Os comandos abaixo pressupõem que `database-credentials` já foi criado pelo CD no namespace e não leem seu valor. Ao renderizar `01-api-secret.yaml` com `envsubst`, `CUSTOMER_JWT_PUBLIC_KEY` precisa estar em uma única linha, com `\n` literais; prefira o comando imperativo do CD para usar o PEM multilinha natural.

```bash
# Renderiza segredo

export JWT_SECRET=<JWT_SECRET>
export JWT_REFRESH_SECRET=<JWT_REFRESH_SECRET>
export CUSTOMER_JWT_PUBLIC_KEY=<CUSTOMER_JWT_PUBLIC_KEY>
export OTEL_EXPORTER_OTLP_ENDPOINT=http://datadog-agent.oficina.svc:4318

envsubst \
'${JWT_SECRET} ${JWT_REFRESH_SECRET} ${CUSTOMER_JWT_PUBLIC_KEY}' \
< k8s/01-api-secret.yaml \
> k8s/01-api-secret.rendered.yaml

# Renderiza o ConfigMap com o endpoint OTLP; use valor vazio para desligar o SDK

envsubst '${OTEL_EXPORTER_OTLP_ENDPOINT}' \
< k8s/02-api-configmap.yaml \
> k8s/02-api-configmap.rendered.yaml

# Renderiza imagem

sed -e "s|IMAGE_URI_PLACEHOLDER|<IMAGE_URI>|g" \
  k8s/03-api-deployment.yaml > k8s/03-api-deployment.rendered.yaml

# Aplica recursos da aplicação

kubectl get secret database-credentials -n oficina \
  -o go-template='{{.metadata.name}} {{range $key, $_ := .data}}{{$key}}{{end}}{{"\n"}}'
kubectl apply -f k8s/01-api-secret.rendered.yaml
kubectl apply -f k8s/02-api-configmap.rendered.yaml
kubectl apply -f k8s/03-api-deployment.rendered.yaml
kubectl apply -f k8s/04-api-service.yaml
kubectl apply -f k8s/05-api-hpa.yaml
```
