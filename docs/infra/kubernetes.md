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
  - cluster EKS, ECR, namespaces `work-order` e `platform`, metrics-server e, no namespace `platform`, o Datadog Agent e o MailHog (o banco relacional é **Amazon RDS** e o cache é **ElastiCache Valkey**, provisionados em [stack própria](#banco-de-dados-relacional-amazon-rds), fora do cluster)
- Aplicação via manifests YAML (`k8s/`), no namespace `work-order`
  - Secret, ConfigMap, Deployment, Service, HPA e o Job de migração

## Motivo da divisão

- Recursos de plataforma e dados (cluster, namespace, DB, observabilidade mínima) têm ciclo de vida mais estável e exigem rastreabilidade de estado: por isso ficam no Terraform.
- Recursos da aplicação mudam com maior frequência (imagem, envs, escala): por isso ficam em manifests declarativos no diretório `k8s/` e são aplicados no deploy.

## Ownership de recursos

| Recurso | Ownership | Onde é definido/aplicado |
|---|---|---|
| Namespaces `work-order` e `platform` | Terraform | [`oficina-mecanica-infra-k8s`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s) (`terraform/k8s_namespace.tf`) |
| Datadog Agent e MailHog (namespace `platform`) | CD do infra-k8s | [`oficina-mecanica-infra-k8s`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s) (`k8s/platform/`, job `platform-apply`); o CD deste repositório não os aplica |
| Banco de dados relacional (Amazon RDS PostgreSQL) e cache (ElastiCache Valkey) | Terraform, em **stack própria** | [`oficina-mecanica-infra-database-work-order`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-work-order) — **fora do cluster**; nenhum manifesto em `k8s/` define workload de banco ou cache |
| metrics-server | Terraform | [`oficina-mecanica-infra-k8s`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s) (`terraform/k8s_metrics_server.tf`) |
| DB migration Job (`00-db-migrate-job.yaml`) | Workflow de CD | Render + `kubectl apply` (job `db-migrate`) em `.github/workflows/cd.yml` |
| Database Secret (`database-credentials`) | Workflow de CD | Declarado em `01-secrets.yaml`; job `prepare-deploy`: descoberta RDS + `GetSecretValue`, e o trecho Node.js preenche o documento e o aplica por stdin; nenhum valor é versionado |
| Cache Secret (`cache-credentials`) | Workflow de CD | Declarado em `01-secrets.yaml`; job `prepare-deploy`: descoberta do replication group + `GetSecretValue` do auth token, `envsubst` do documento e aplicação por stdin; nenhum valor é versionado |
| Chaves privadas do token de funcionário (`jwt-private-keys`) | Workflow de CD | Declarado em `01-secrets.yaml`; outro step de `prepare-deploy` preenche `STAFF_JWT_PRIVATE_KEY` e `STAFF_JWT_REFRESH_PRIVATE_KEY` (secrets do environment `production`) em base64 mascarado e aplica por stdin |
| Chaves públicas JWT (`jwt-public-keys`) | Workflow de CD | Declarado em `01-secrets.yaml`; mesmo step, com `CUSTOMER_JWT_PUBLIC_KEY` (secret do repositório), `STAFF_JWT_PUBLIC_KEY` e `STAFF_JWT_KEY_ID` (secrets da organização) em base64 |
| ConfigMap (`02-work-order-configmap.yaml`) | Workflow de CD | Job `prepare-deploy`: render de `OTEL_EXPORTER_OTLP_ENDPOINT` (GitHub Actions Variable) e `MESSAGING_TOPIC_ARN` (conta da sessão AWS) via `envsubst` + `kubectl apply` |
| Deployment (`03-work-order-deployment.yaml`) | Workflow de CD | Render da imagem e da label `version` + `kubectl apply` em `.github/workflows/cd.yml` |
| Service (`04-work-order-service.yaml`) | Workflow de CD | `kubectl apply` em `.github/workflows/cd.yml` |
| HPA (`05-api-hpa.yaml`) | Workflow de CD | `kubectl apply` em `.github/workflows/cd.yml` |

## Convenções: labels e wiring de configuração

**Labels.** Todos os recursos carregam as labels recomendadas do Kubernetes, o que permite selecioná-los e agrupá-los de forma consistente:

- `app.kubernetes.io/name` — identifica o componente (`work-order-service`, `db-migrate-job`).
- `app.kubernetes.io/part-of` — sempre `oficina-mecanica` (a solução como um todo).
- `managed-by: terraform` — presente apenas nos recursos provisionados pelo Terraform (`oficina-mecanica-infra-k8s`), distinguindo-os dos manifests aplicados pelo CD.

**Wiring de configuração.** A configuração da API é injetada por `envFrom` a partir de cinco fontes, separadas por ownership e sensibilidade, sem chave repetida entre elas:

- `work-order-config` (`ConfigMap`, **não sensível**): `NODE_ENV`, `PORT`, `STAFF_JWT_ISSUER`, `STAFF_JWT_AUDIENCE`, `STAFF_JWT_EXPIRATION`, `STAFF_JWT_REFRESH_EXPIRATION`, `BCRYPT_SALT_ROUNDS`, `MAIL_HOST` (`mailhog.platform.svc.cluster.local`), `MAIL_PORT`, `TZ`, `LOG_LEVEL`, `OTEL_SERVICE_NAME`, `OTEL_SERVICE_NAMESPACE`, `TRUSTED_PROXY_CIDRS`, `CUSTOMER_JWT_ISSUER`, `CUSTOMER_JWT_AUDIENCE`, `AWS_REGION`, `WORK_ORDER_QUEUE_NAME` (`work-order.fifo`), `MESSAGING_TOPIC_ARN`, `CACHE_TTL_SECONDS` (`43200`), `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_LOGS_EXPORTER` e `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE`.
- `database-credentials` (`Secret`, **sensível**): somente `DATABASE_URL`, materializada pelo CD a partir de RDS/Secrets Manager.
- `cache-credentials` (`Secret`, **sensível**): somente `CACHE_URL` (`rediss://` com o auth token), materializada pelo CD a partir do ElastiCache/Secrets Manager.
- `jwt-private-keys` (`Secret`): `STAFF_JWT_PRIVATE_KEY` e `STAFF_JWT_REFRESH_PRIVATE_KEY`, as chaves privadas RS256 do access e do refresh de funcionário.
- `jwt-public-keys` (`Secret`): `CUSTOMER_JWT_PUBLIC_KEY`, `STAFF_JWT_PUBLIC_KEY` e `STAFF_JWT_KEY_ID`.

`CUSTOMER_JWT_ISSUER`/`CUSTOMER_JWT_AUDIENCE` são valores fixos e não secretos (identificadores de emissor/audiência do token externo), por isso vivem no ConfigMap; `CUSTOMER_JWT_PUBLIC_KEY`, `STAFF_JWT_PUBLIC_KEY` e `STAFF_JWT_KEY_ID` ficam num Secret próprio, separado das chaves privadas, embora uma chave pública não exija sigilo.

Nenhum Secret carrega credencial AWS: SNS e SQS são chamados com o papel do nó (`LabRole`), resolvido pelo SDK.

> ⚠️ **Formato do `CUSTOMER_JWT_PUBLIC_KEY` no GitHub Secret.** O job `prepare-deploy` do `cd.yml` codifica a chave em base64, que ocupa uma linha só, antes de preenchê-la no documento `jwt-public-keys` de `k8s/01-secrets.yaml`; o PEM com quebras de linha reais não chega ao YAML. **Por isso o GitHub Secret pode ser cadastrado com o PEM no formato natural, multilinha, exatamente como o `openssl` ou a autoridade certificadora o gerou**.
>
> A [documentação de CI/CD](ci-cd.md#injeção-de-secrets-da-aplicação) explica por que o PEM cru quebraria o YAML e como o base64 evita isso.
>
> A conversão para uma linha com `\n` literais (a que `app/.env.example` usa) continua necessária **apenas para o `.env` local**: arquivos `.env` não suportam valores multilinha sem aspas, e o parser usado pelo projeto não desfaz esse escape sozinho — por isso `CustomerJwtStrategy` (`customer-jwt.strategy.ts`) aplica `.replaceAll(String.raw`\n`, '\n')` na leitura da env var. Esse mesmo `replaceAll` é um no-op inofensivo quando o valor já chega com quebras de linha reais (como no Secret do cluster), então o código funciona sem alteração nos dois ambientes. Para gerar a versão de uma linha para o `.env`:
>
> ```bash
> awk 'NF {sub(/\r/, ""); printf "%s\\n", $0}' public.pem
> ```

**Telemetria.** Três chaves controlam o SDK do OpenTelemetry, e a primeira é o interruptor:

| Chave | Valor no ConfigMap | Efeito |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Renderizado de `vars.OTEL_EXPORTER_OTLP_ENDPOINT` | É o interruptor do SDK: vazio desliga instrumentações e exportadores; preenchido ativa traces e métricas para o endpoint informado. Com o Agent do projeto, usar o **DNS do Service** (`http://datadog-agent.platform.svc.cluster.local:4318`), nunca `status.hostIP` via Downward API |
| `OTEL_LOGS_EXPORTER` | `none` | A **ausência** desta chave faria o SDK instanciar um `LoggerProvider` com exportador OTLP de rede. Os logs têm um caminho único — o stdout do contêiner, lido pelo coletor |
| `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE` | `delta` | O OTel JS exporta cumulative por padrão, e os destinos compatíveis esperam delta; cumulative descarta pontos na inicialização do processo |

O manifesto contém um placeholder, não um estado fixo. A cada deploy, o workflow lê `vars.OTEL_EXPORTER_OTLP_ENDPOINT`, renderiza `02-work-order-configmap.yaml` e aplica o resultado. Variável ausente ou vazia produz uma chave vazia e mantém o SDK desligado; qualquer URL válida ativa a exportação sem rebuild da imagem. O `app-deploy` aplica o Deployment renderizado com a imagem do commit e aguarda o rollout corrente; não executa `rollout restart`.

### Camada de coleta

O Datadog Agent (DaemonSet, RBAC somente-leitura e o Service `datadog-agent` na porta OTLP HTTP `4318`) roda no namespace `platform` e é aplicado pelo CD do [`oficina-mecanica-infra-k8s`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s) (`k8s/platform/`), que serve todos os serviços do cluster. O CD deste repositório não aplica nem conhece o Agent. É a **única peça do sistema que conhece o fornecedor**: a aplicação exporta OTLP puro, sem dependência, cabeçalho ou credencial de plataforma.

Ligar a telemetria da aplicação é só preencher `vars.OTEL_EXPORTER_OTLP_ENDPOINT` com `http://datadog-agent.platform.svc.cluster.local:4318`; com o valor vazio, o Agent continua coletando os logs do contêiner e as métricas do kubelet, sem traces nem métricas OTLP da aplicação.

⚠️ `OTEL_RESOURCE_ATTRIBUTES` **não** entra aqui com nenhum dos cinco atributos compartilhados (`service.name`, `service.namespace`, `service.version`, `service.instance.id`, `deployment.environment.name`): o detector de ambiente do SDK **vence** o resource montado em código, e o caminho de log não lê essa variável — trace e log passariam a reportar valores diferentes, em silêncio, desligando a navegação cruzada entre sinais. Os cinco continuam vindo de `OTEL_SERVICE_NAME`, `OTEL_SERVICE_NAMESPACE`, `SERVICE_VERSION` (assada na imagem) e `NODE_ENV`, que **ambos** os caminhos leem. Ver [ADR 0005](../adr/0005-opentelemetry.md).

### Classificação e atribuição dos logs de contêiner

O log **não** passa por OTLP (`OTEL_LOGS_EXPORTER: none`): o caminho é o stdout do contêiner, lido pelo agente com `DD_LOGS_CONFIG_CONTAINER_COLLECT_ALL`. Isso muda duas coisas em relação ao trace e à métrica, que leem o resource do OTel.

**Severidade vem do stream, não do conteúdo.** Sem pipeline de integração, o coletor deriva o status do canal de saída: **stdout → `info`, stderr → `error`**. Escapa disso apenas quem emite JSON com nível próprio — que é o caso da API, cujo envelope carrega `level` (ver [ADR 0002](../adr/0002-logging-estruturado.md)). Todo o resto do node é classificado pelo canal, e é por isso que aparecem como `error` linhas perfeitamente normais de `kube-proxy`, `coredns`, `metrics-server` e `aws-node`: são componentes em Go, e o `klog` escreve em stderr. **Não é defeito da aplicação nem do coletor** — e a contrapartida é que a falha de verdade desses componentes chega pelo mesmo canal, então filtrá-la fora custaria o sinal junto com o ruído. A exclusão feita no agente (`DD_CONTAINER_EXCLUDE_LOGS`) alcança o MailHog, o próprio agente e o `kube-proxy`. Os dois primeiros eram ruído de probe sem contrapartida de sinal; o terceiro é a maior fatia isolada do índice depois da própria aplicação, quase toda classificada como `error` pelo motivo acima. O que o `kube-proxy` registra é sincronização de regra de iptables, e uma falha de rede real aparece antes na aplicação — o que o torna o único dos quatro componentes em Go cuja exclusão não custa sinal junto com o ruído. `coredns`, `metrics-server` e `aws-node` **continuam sendo coletados**: ali a falha do componente é o próprio sinal.

**`HOST_PROC` é contorno de defeito, não configuração de coleta.** A partir da 7.61.0 o pipeline de ingestão OTLP do agente falha na inicialização com `failed to register process metrics: process does not exist` quando `/proc` do host está montado em `/host/proc` — que é a montagem deste DaemonSet. O sintoma é traiçoeiro: o pod fica `Running` e `Ready`, a porta 4318 aparece no Service, e a aplicação recebe `ECONNREFUSED` porque **nada escuta ali**. `HOST_PROC: /proc` é um dos contornos publicados no [issue #32947](https://github.com/DataDog/datadog-agent/issues/32947).

Não remova esta variável junto com uma atualização do agente sem antes confirmar que a 4318 continua escutando:

```sh
kubectl exec -n platform ds/datadog-agent -- ss -lntp | grep 4318
```

**Nome de operação do APM.** Até a 7.65, o agente nomeava a operação de um span OTLP pelo **escopo de instrumentação**, e o que aparecia no APM era literalmente `opentelemetry_instrumentation_http.server` — com as métricas de trace derivadas herdando esse nome. A partir da **7.66** a lógica de mapeamento v2 é o padrão na ingestão OTLP via agente. A imagem 7.83.1 está acima desse piso; nesta solução, as operações vigentes são `http.server.request` para HTTP e `postgresql.query` para PostgreSQL, sem consumidores baseados nos nomes anteriores dos escopos de instrumentação.

Nenhum dashboard ou monitor da solução consulta `trace.*`: a latência permanece na métrica OTLP `http.server.request.duration`, cujo nome é definido pela convenção semântica. A versão do agente não migra os consumidores nem substitui a decisão sobre dimensões e amostragem.

**Atribuição de serviço vem de label, não do resource.** Como o log não passa por OTLP, o agente não enxerga `service.name` e cai no **nome da imagem** — o que fazia a mesma aplicação aparecer como `ecr-oficina-mecanica-app-repo` no log e `oficina-mecanica-work-order-service` no APM, quebrando a aba Logs da página do serviço e qualquer métrica derivada de log. As labels de Unified Service Tagging no `spec.template.metadata.labels` resolvem:

| Workload | `tags.datadoghq.com/service` | Manifesto |
|---|---|---|
| API | `oficina-mecanica-work-order-service` | `k8s/03-work-order-deployment.yaml` |
| Job de migração | `oficina-mecanica-work-order-service-db-migrate` | `k8s/00-db-migrate-job.yaml` |

Os dois valores são **deliberadamente diferentes**. Job e Deployment compartilham a imagem, mas são workloads distintos com ciclo de vida distinto: unificá-los encheria a aba Logs da API com saída de migração a cada deploy — que é o problema que as labels vieram resolver, só que com outro nome.

O Deployment também carrega `tags.datadoghq.com/version`, com a tag da imagem (o SHA do commit) renderizada pelo CD no lugar de `VERSION_PLACEHOLDER` — o mesmo valor que a imagem assa em `SERVICE_VERSION`.

⚠️ As labels são valores **espelhados**, não derivados: label de Kubernetes não referencia ConfigMap. `service` precisa seguir igual a `OTEL_SERVICE_NAME` e `env` igual a `NODE_ENV`, ambos em `02-work-order-configmap.yaml`, de onde o resource do OTel tira `service.name` e `deployment.environment.name`. **Mudou lá, muda aqui** — não há verificação automática.

## Recursos: CPU e memória (requests e limits)

Cada workload declara `requests` (o que o scheduler reserva) e `limits` (o teto antes de throttling/OOM-kill):

| Workload | Requests (CPU / memória) | Limits (CPU / memória) | Fonte |
|---|---|---|---|
| API (`work-order-service`) | `200m` / `256Mi` | `500m` / `512Mi` | `k8s/03-work-order-deployment.yaml` |
| Job `db-migrate` | — (não define) | — (não define) | `k8s/00-db-migrate-job.yaml` |

## Banco de Dados Relacional (Amazon RDS)

A persistência relacional da aplicação é fornecida pelo **Amazon RDS (PostgreSQL)**, gerenciado no repositório dedicado [`oficina-mecanica-infra-database-work-order`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-work-order):

- Instância gerenciada PostgreSQL 18 (`rds-oficina-mecanica-work-order`, Single-AZ, `db.t4g.micro`, 20 GiB GP3), acompanhada de uma instância ElastiCache Valkey 9.1 (`cache-oficina-mecanica-work-order`, `cache.t4g.micro`).
- Alocados nas subnets privadas da VPC, com Security Groups restritos por origem (`secgrp-eks-nodes-oficina-mecanica`, mais as CIDRs privadas da VPC no RDS de forma transitória até a C-20).
- A master password é gerada e mantida pelo RDS em um Secret do AWS Secrets Manager, com rotação automática desabilitada. O Terraform conhece ARN/status/KMS e metadados de conexão, não o valor da senha; `sensitive` sozinho não impediria sua presença no State.
- O job `prepare-deploy` do CD descobre o Secret e o endpoint pelo identificador da instância, lê `AWSCURRENT` e materializa `DATABASE_URL` em `database-credentials` usando Node.js inline, que preenche o documento `database-credentials` de `k8s/01-secrets.yaml` e o aplica por stdin, com os parâmetros descritos em [Conexão obrigatoriamente cifrada (TLS)](#conexão-obrigatoriamente-cifrada-tls). Migration/seed ficam somente no job `db-migrate` seguinte.

O [ADR de database sobre RDS](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-work-order/blob/main/docs/adr/0001-banco-gerenciado-amazon-rds.md#postgresql-auto-hospedado-dentro-do-cluster-eks) preserva o diagnóstico histórico das tentativas de persistência com EBS CSI no EKS e as razões para abandonar `emptyDir`/`hostPath`.

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
- `01-secrets.yaml`: os quatro Secrets do serviço (`jwt-private-keys`, `jwt-public-keys`, `database-credentials` e `cache-credentials`), com nome, namespace, labels e chaves. Os valores são placeholders base64 (`${<CHAVE>_B64}`): cada passo do CD seleciona o seu documento com `yq`, preenche e aplica por stdin, e nenhum valor é versionado
- `02-work-order-configmap.yaml`: ConfigMap `work-order-config` com as variáveis não sensíveis listadas em [wiring de configuração](#convenções-labels-e-wiring-de-configuração); os placeholders `OTEL_EXPORTER_OTLP_ENDPOINT` (variável homônima do GitHub Actions) e `MESSAGING_TOPIC_ARN` (`arn:aws:sns:<região>:<conta>:oficina-events.fifo`, com a conta de `aws sts get-caller-identity`, porque o SNS não resolve ARN por nome) são renderizados pelo CD
- `03-work-order-deployment.yaml`: Deployment `work-order-service` com placeholders de imagem e de `version`, `imagePullPolicy: Always`, `envFrom` dos Secrets e do ConfigMap e probes de saúde. **Não declara `replicas`**: o HPA é o dono da contagem, e um valor no manifesto a reverteria a cada apply
- `04-work-order-service.yaml`: Service **`NodePort`** `work-order-service` (`3000` → `30080` nos nós). `NodePort` é um superconjunto de `ClusterIP`: o Service continua recebendo um ClusterIP e o DNS interno segue igual. A porta dos nós é o destino do target group do NLB interno provisionado em `oficina-mecanica-infra-k8s`, que por sua vez é o backend da integração privada do [API Gateway](https://github.com/FIAP-15SOAT/oficina-mecanica-api-gateway). O valor precisa casar com o `node_port` de `work-order` em `local.services` (`terraform/locals.tf`) naquele repositório
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

O `05-api-hpa.yaml` (HPA `autoscaling/v2` `work-order-service-hpa`) escala o Deployment `work-order-service` com base em **duas métricas de recurso**:

| Campo | Valor |
|---|---|
| `scaleTargetRef` | `Deployment/work-order-service` |
| `minReplicas` / `maxReplicas` | `1` / `2` |
| CPU (`Resource`, `averageUtilization`) | `70` |
| Memória (`Resource`, `averageUtilization`) | `80` |

`averageUtilization` é medido como **percentual da `request`** do pod — por exemplo, 70% de CPU significa 70% dos `200m` requisitados pela API (≈ `140m` de média entre as réplicas) como gatilho para escalar. O HPA escala quando **qualquer** das duas métricas ultrapassa seu alvo. As métricas vêm do **metrics-server** (provisionado em `oficina-mecanica-infra-k8s`); sem ele, o HPA não teria dados para decidir.

O HPA escala apenas os **pods da API** (`1→2`); a escala do _cluster_ (nodes) está fora do escopo — o node group é mantido fixo por decisão, como registrado em [overview.md › Limitações](overview.md#limitações-e-o-que-produção-exigiria).

⚠️ **O `maxReplicas: 2` existe porque os nós são compartilhados pelos quatro serviços.** Pela fórmula padrão do VPC CNI (sem prefix delegation), cada `t3.medium` configurado permite **17 pods**. Nesse teto entram `coredns` ×2, `aws-node`, `kube-proxy`, `metrics-server`, o MailHog e o DaemonSet do Agent do namespace `platform` e as réplicas de todos os serviços. O valor observado no cluster pode ser consultado com:

```bash
kubectl get node -o jsonpath='{.items[*].status.allocatable.pods}'
```

O `node_instance_type` é definido em `oficina-mecanica-infra-k8s`; o valor atual é `t3.medium`.

## Acesso à aplicação em Kubernetes

A aplicação tem **dois** caminhos de acesso.

**Público**, para uso real: pelo endereço do [API Gateway](https://github.com/FIAP-15SOAT/oficina-mecanica-api-gateway), que alcança o cluster por VPC Link → NLB interno → NodePort `30080`. Nada disso tem IP público: o Service é `NodePort`, mas a porta só é alcançável de dentro da VPC.

**Diagnóstico**, para testes e validações manuais: `kubectl port-forward`. O Service `NodePort` também possui `ClusterIP`, portanto suporta o túnel e o DNS interno.

```bash
kubectl port-forward -n work-order svc/work-order-service 3000:3000
```

Após estabelecer o túnel, a aplicação poderá ser acessada localmente através dos seguintes endereços:

- API: `http://localhost:3000`
- Swagger: `http://localhost:3000/api/docs`

Para interromper o túnel, pressione `Ctrl+C` no terminal onde o comando estiver em execução.

Caso seja necessário validar se o Service possui endpoints disponíveis:

```bash
kubectl get endpoints work-order-service -n work-order
```

Para acessar a interface web do MailHog executando no cluster (namespace `platform`):

```bash
kubectl port-forward -n platform svc/mailhog 8025:8025
```

A interface ficará disponível em:

- MailHog: `http://localhost:8025`

## Health probes

A API (`work-order-service`) usa probes HTTP `GET` em `/api/health/live` e `/api/health/ready` (porta 3000). As probes do MailHog são do `oficina-mecanica-infra-k8s`, dono dele.

O smoke do CD é outra coisa: `GET /health/work-order` **pelo API Gateway**, depois do rollout, para provar o caminho público inteiro (Gateway → VPC Link → NLB → NodePort `30080` → pod). Ver [ci-cd.md](ci-cd.md).

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

> O caminho canônico de deploy manual é `workflow_dispatch` (com `image_tag` para reimplantar uma imagem já publicada, sem build nem migração), pois ele descobre e materializa as credenciais sem expô-las. Os comandos abaixo pressupõem que `database-credentials`, `cache-credentials` e `jwt-public-keys` já foram criados pelo CD no namespace e não leem seus valores.

```bash
# Aplica as chaves privadas do token de funcionário por stdin (base64 numa linha só, como o CD),
# lidas de arquivos fora do repositório; nada é gravado em disco

export STAFF_JWT_PRIVATE_KEY_B64="$(base64 -w0 < <caminho>/staff.key)"
export STAFF_JWT_REFRESH_PRIVATE_KEY_B64="$(base64 -w0 < <caminho>/refresh.key)"

yq 'select(.metadata.name == "jwt-private-keys")' k8s/01-secrets.yaml \
| envsubst '${STAFF_JWT_PRIVATE_KEY_B64} ${STAFF_JWT_REFRESH_PRIVATE_KEY_B64}' \
| kubectl apply -f -

# Renderiza o ConfigMap: endpoint OTLP (vazio desliga o SDK) e ARN do tópico com a conta da sessão

export OTEL_EXPORTER_OTLP_ENDPOINT=http://datadog-agent.platform.svc.cluster.local:4318
export MESSAGING_TOPIC_ARN="arn:aws:sns:us-east-1:$(aws sts get-caller-identity --query Account --output text):oficina-events.fifo"

envsubst '${OTEL_EXPORTER_OTLP_ENDPOINT} ${MESSAGING_TOPIC_ARN}' \
< k8s/02-work-order-configmap.yaml \
> k8s/02-work-order-configmap.rendered.yaml

# Renderiza imagem e a label version (a tag da imagem)

sed -e "s|IMAGE_URI_PLACEHOLDER|<IMAGE_URI>|g" -e "s|VERSION_PLACEHOLDER|<IMAGE_TAG>|g" \
  k8s/03-work-order-deployment.yaml > k8s/03-work-order-deployment.rendered.yaml

# Confere os Secrets do CD (só os nomes das chaves) e aplica os recursos da aplicação

kubectl get secret database-credentials cache-credentials jwt-public-keys -n work-order \
  -o go-template='{{range .items}}{{.metadata.name}} {{range $key, $_ := .data}}{{$key}}{{end}}{{"\n"}}{{end}}'
kubectl apply -f k8s/02-work-order-configmap.rendered.yaml
kubectl apply -f k8s/03-work-order-deployment.rendered.yaml
kubectl apply -f k8s/04-work-order-service.yaml
kubectl apply -f k8s/05-api-hpa.yaml
```
