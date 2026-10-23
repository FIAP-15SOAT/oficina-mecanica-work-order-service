# 🔄 CI/CD

Quatro workflows do GitHub Actions, um por responsabilidade: CI, CD, SAST e DAST.

## Índice

- [Fluxo de branch e Pull Request](#fluxo-de-branch-e-pull-request)
- [Controle de concorrência de runs](#controle-de-concorrência-de-runs)
- [1) Workflow de CI](#1-workflow-de-ci-ciyml)
- [2) Workflow de CD](#2-workflow-de-cd-cdyml)
- [Seed dos dados de referência](#seed-dos-dados-de-referência)
- [3) Workflow de SAST](#3-workflow-de-sast-sastyml)
- [4) Workflow de DAST](#4-workflow-de-dast-dastyml)
- [Secrets e Variables](#secrets-e-variables)

A automação está dividida por responsabilidade, em quatro workflows:

| Workflow | Arquivo | Gatilho | Responsabilidade |
|---|---|---|---|
| CI | `.github/workflows/ci.yml` | `push` em branches de trabalho (`feature/**`, `fix/**`) | Executar lint, testes, build e validação de banco; depois abrir o PR |
| CD | `.github/workflows/cd.yml` | `push` em `main` (pós-merge) + `workflow_dispatch` | Fluxo de entrega da aplicação: **builda e publica a imagem, migra o banco e deploya a app**. Não provisiona infraestrutura |
| SAST | `.github/workflows/sast.yml` | `pull_request` + `push` em `main` | Análise do SonarCloud (PR + `main`), em paralelo ao CD (não bloqueia o deploy) |
| DAST | `.github/workflows/dast.yml` | `pull_request` → `main` + `workflow_dispatch` | Scan ativo OWASP ZAP da API em execução (autenticado, via OpenAPI), em paralelo ao CI/CD |

O CD faz o fluxo de entrega **da aplicação**: publica a imagem, migra o banco e deploya. Não há acoplamento por `workflow_run` — a ordem é garantida pelas dependências entre jobs (`needs:`) dentro do próprio CD.

**Infraestrutura não é provisionada por este repositório.** Rede, cluster, banco, API Gateway e a função serverless de autenticação externa vivem em stacks Terraform próprias, cada uma com o seu `plan` no CI e o seu `apply` no CD — ver [overview.md › Camadas](overview.md#as-sete-camadas-de-provisionamento).

> **Como ler os diagramas.** Nos diagramas de **CI** e **CD**, cada caixa é um **job** (com os principais steps em bullets) e as setas seguem as dependências `needs:`. Nos de **SAST** e **DAST** — que têm um **único job** —, cada caixa é um **step**, executado em sequência no mesmo runner.

## Fluxo de branch e Pull Request

O CI dispara no `push` de uma branch de trabalho e roda todos os jobs de validação em paralelo (fail-fast). Se todos passam, o job `open-pr` abre um Pull Request para `main` — de forma idempotente (não abre duplicado se já existir PR); em pushes seguintes, o CI reexecuta e o `open-pr` vira no-op.

Os jobs pesados **não** são disparados por `pull_request`. O evento `pull_request` (ação `synchronize`) já reexecuta a cada novo push numa branch com PR aberto; disparar por `push` **e** por `pull_request` executaria tudo em dobro. Mantendo o gatilho apenas em `push`, cada commit é validado uma única vez — os check-runs ficam gravados no SHA do commit, e a branch protection da `main` (required status checks) os lê para liberar ou bloquear o merge.

## Controle de concorrência de runs

| Workflow | `group` | `cancel-in-progress` | Porquê |
|---|---|---|---|
| `ci.yml` | `ci-<ref>` | `true` | Um push mais novo torna o run anterior obsoleto; cancelar economiza runners |
| `cd.yml` | `production` | `false` | Nunca interromper build, migração ou deploy no meio; o próximo run enfileira atrás (protege a publicação da imagem, o banco e o rollout) |
| `sast.yml` | `sast-<pr ou ref>` | `true` | Um push novo no PR/`main` torna a análise anterior obsoleta; cancelar economiza runners |
| `dast.yml` | `dast-<pr ou ref>` | `true` | Um push novo no PR torna o scan anterior obsoleto; cancelar economiza runners |

Todos os jobs do CD rodam sob o GitHub `environment: production` (portão de deploy / regras de proteção) e são gated por `vars.ENABLE_DEPLOY` — o interruptor mestre do fluxo cloud: quando `false`, merges não disparam entrega cloud. O disparo manual em `main` ultrapassa esse interruptor; em outra branch, os jobs são pulados.

## 1) Workflow de CI (`ci.yml`)

![Diagrama do workflow de CI: os 5 jobs de validação (Lint, Unit Tests, E2E Tests, Build, DB Validation) rodam em paralelo a partir do push e convergem no job open-pr, que abre o PR para main](../diagrams/ci-workflow.png)

Escopo: validação de qualquer branch de trabalho, sempre por completo (sem detecção condicional de mudança — determinístico e consistente).

Os 5 jobs de validação rodam **em paralelo** (fail-fast); passando todos, o `open-pr` abre o PR. Os jobs usam o composite `.github/actions/setup-ci` (Node com cache de npm + `npm ci` + `prisma generate`, tudo em `app/`); todas as actions de terceiros são fixadas por commit SHA completo (mitigação de supply-chain).

| # | Job | O que faz |
|---|---|---|
| 1 | `lint` | `npm run lint` — ESLint (inclui a cerca de dependências entre camadas) |
| 2 | `unit-tests` | `npm run test:cov` — testes unitários com cobertura |
| 3 | `e2e-tests` | `npm run test:e2e:cov` — E2E com um PostgreSQL descartável via Testcontainers no próprio job |
| 4 | `build` | `npm run build` — compila o TypeScript |
| 5 | `db-validation` | Sobe um PostgreSQL efêmero (service container) e roda `npm run db:reset` (migrate reset + seed): prova que as migrations aplicam do zero e o seed funciona. Banco descartado com o job — nunca toca ambiente real |
| 6 | `open-pr` | `needs:` os 5 jobs acima; abre o PR para `main` de forma idempotente (não duplica), autenticado por **GitHub App** (`BOT_APP_ID` + `BOT_PRIVATE_KEY`) para que o `sast.yml` rode no PR desde o primeiro push |

### Steps de cada job de CI

#### `lint` — Lint

| # | Step no workflow | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Obtém a revisão que disparou o workflow; os comandos seguintes usam esse checkout. |
| 2 | Setup CI (`./.github/actions/setup-ci`) | Composite local: Node 24 com cache npm, `npm ci` e `prisma generate` em `app/`. |
| 3 | Lint | Executa `npm run lint`; formatação e dependências proibidas entre camadas reprovam. |

#### `unit-tests` — Unit Tests

| # | Step no workflow | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Obtém a revisão que disparou o workflow; os comandos seguintes usam esse checkout. |
| 2 | Setup CI (`./.github/actions/setup-ci`) | Composite local: Node 24 com cache npm, `npm ci` e `prisma generate` em `app/`. |
| 3 | Unit tests with coverage | Executa `npm run test:cov`, com cobertura unitária. |

#### `e2e-tests` — E2E Tests

| # | Step no workflow | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Obtém a revisão que disparou o workflow; os comandos seguintes usam esse checkout. |
| 2 | Setup CI (`./.github/actions/setup-ci`) | Composite local: Node 24 com cache npm, `npm ci` e `prisma generate` em `app/`. |
| 3 | E2E tests with coverage | Executa `npm run test:e2e:cov` com PostgreSQL descartável via Testcontainers. |

#### `build` — Build

| # | Step no workflow | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Obtém a revisão que disparou o workflow; os comandos seguintes usam esse checkout. |
| 2 | Setup CI (`./.github/actions/setup-ci`) | Composite local: Node 24 com cache npm, `npm ci` e `prisma generate` em `app/`. |
| 3 | Build | Compila/empacota a aplicação em `app/dist` com o comando de build do projeto. |
| 4 | Telemetry preload smoke | Executa `npm run test:smoke` fora do Jest; verifica o preload/instrumentações no runtime compilado após o build. |

#### `db-validation` — DB Validation

| # | Step no workflow | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Obtém a revisão que disparou o workflow; os comandos seguintes usam esse checkout. |
| 2 | Setup CI (`./.github/actions/setup-ci`) | Composite local: Node 24 com cache npm, `npm ci` e `prisma generate` em `app/`. |
| 3 | Reset and seed the throwaway database | Executa `npm run db:reset` sobre o service container PostgreSQL; prova migrations do zero e seed sem tocar o banco real. |

#### `open-pr` — Open Pull Request

| # | Step no workflow | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Obtém a revisão que disparou o workflow; os comandos seguintes usam esse checkout. |
| 2 | Generate GitHub App Token | Gera `app_token` com `BOT_APP_ID` e `BOT_PRIVATE_KEY`; o próximo step recebe o token como `GH_TOKEN`. |
| 3 | Open a PR to main if none exists | Consulta `gh pr list` para head → main e cria o PR só se não houver um aberto; erro do CLI reprova o job. |

> As validações de Terraform (`fmt`, `validate`, `plan`) são executadas nos repositórios dedicados de infraestrutura ([`oficina-mecanica-infra-base`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-base) e [`oficina-mecanica-infra-k8s`](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s)).

## 2) Workflow de CD (`cd.yml`)

![Diagrama do workflow de CD da API](../diagrams/cd-workflow.png)

Escopo: `push` em `main` (após o merge) e `workflow_dispatch` (deploy sob demanda). O filtro do evento e as condições dos jobs referenciam `main` literalmente; cada job exige também `vars.ENABLE_DEPLOY == 'true' || github.event_name == 'workflow_dispatch'`. O workflow roda sob `environment: production`, com concorrência que não cancela execução em andamento. A ordem é um **DAG de quatro jobs por `needs:`**: `build-push-image` → `prepare-deploy` → `db-migrate` → `app-deploy`. As dependências diretas adicionais permitem receber a imagem do build e aguardar o sucesso da preparação/migration, sem repassar metadados de credenciais entre jobs.

| # | Job | `needs:` | O que faz |
|---|---|---|---|
| 1 | `build-push-image` | — | Login no Amazon ECR, build **único** da imagem multi-stage NestJS e push com tag por commit (`:sha`) e tag móvel `:latest`; exporta o `image_uri` |
| 2 | `prepare-deploy` | `build-push-image` | **Valida `CUSTOMER_JWT_PUBLIC_KEY`** (presente e com formato PEM) antes de chamadas AWS/kubectl, para evitar uma falha tardia de autenticação no Pod. Configura a própria sessão AWS/kubeconfig; descobre RDS/Secret, espera `available`/`active`, lê `AWSCURRENT`, monta a URL com encoding/TLS e materializa somente `DATABASE_URL` em `database-credentials`. Em outro step, cria `api-secret` imperativamente apenas com JWTs/chave pública, preservando PEM multilinha sem `envsubst`, e renderiza/aplica `OTEL_EXPORTER_OTLP_ENDPOINT` no ConfigMap. Não publica outputs |
| 3 | `db-migrate` | `build-push-image` + `prepare-deploy` | Configura sua própria sessão AWS/kubeconfig; **renderiza `k8s/00-db-migrate-job.yaml`** com nome único por run/tentativa e imagem da tag do commit via `sed`; executa **`prisma migrate deploy` + `prisma db seed`**. Aplica somente migrations pendentes (não destrutivo, nunca reseta) e seed idempotente (`upsert`, sem duplicar). Detecta sucesso/falha por `.status.succeeded`/`.status.failed`, com limite de 900 s; saída não bem-sucedida coleta `describe` do Job e logs do Pod. Não recupera nem publica credenciais |
| 4 | `app-deploy` | `build-push-image` + `prepare-deploy` + `db-migrate` | Renderiza `k8s/03-api-deployment.yaml` com a tag do commit, sem annotation de versão da credencial. Aplica **MailHog** (`Deployment` + `Service`) e `Deployment`/`Service`/`HPA` da API; quando `ENABLE_TELEMETRY_COLLECTION == 'true'`, valida `DD_API_KEY` e aplica a camada do Datadog Agent; aguarda o rollout da API |

O Job usa `backoffLimit: 0`: uma execução quebrada recebe `Failed`, não `Complete`. Por isso o workflow **não usa `kubectl wait --for=condition=Complete`** como única espera — esse comando só perceberia o problema quando expirasse. O polling verifica os contadores de sucesso e falha a cada 5 s; os 900 s são a rede de segurança para uma execução que não termina. Isso evita segurar desnecessariamente a fila serializada por `concurrency: production`. Em timeout/falha, o próprio step coleta diagnóstico antes de reprovar, bloqueando o deploy; após sucesso, o step seguinte mostra os logs de migration/seed.

### Steps de cada job de CD

#### `build-push-image` — Build and Push App Image

| # | Step no workflow | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Obtém a revisão que disparou o workflow; os comandos seguintes usam esse checkout. |
| 2 | Configure AWS Credentials | Configura access key, secret key e session token da mesma sessão AWS, em us-east-1. |
| 3 | Login to Amazon ECR | Autentica Docker no registry ECR e expõe `login_ecr.outputs.registry`. |
| 4 | Set image metadata | Calcula repositório/tag por commit e publica `image_meta.outputs.image_uri` para os consumidores. |
| 5 | Build and Push Image | Constrói uma única imagem multi-stage e publica a tag por commit e latest; falha de build/push reprova. |

#### `prepare-deploy` — Prepare Deployment Configuration

| # | Step no workflow | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Obtém a revisão que disparou o workflow; os comandos seguintes usam esse checkout. |
| 2 | Validate required secrets | Confere `CUSTOMER_JWT_PUBLIC_KEY` e seu formato PEM antes de chamadas AWS/Kubernetes; ausência ou formato inválido reprova. |
| 3 | Configure AWS Credentials | Configura access key, secret key e session token da mesma sessão AWS, em us-east-1. |
| 4 | Configure kubectl | Configura o kubeconfig do EKS com as credenciais desse job; não herda a sessão do job anterior. |
| 5 | Discover and materialize database credentials | Usa `vars.RDS_INSTANCE_IDENTIFIER` e `vars.K8S_NAMESPACE`; faz até 60 consultas com intervalo de 10 s para `available`/`active`, lê somente `SecretString` de `AWSCURRENT` e verifica campos obrigatórios/porta/username, sem regex redundantes sobre formatos AWS. Um trecho Node.js **inline** aplica percent-encoding, mascara as representações sensíveis e envia o manifesto de `database-credentials` ao `kubectl` por stdin, sem publicar outputs. O job inteiro tem limite de 15 min. |
| 6 | Render and apply application secrets and ConfigMap | Cria `api-secret` imperativamente apenas com `JWT_SECRET`, `JWT_REFRESH_SECRET` e `CUSTOMER_JWT_PUBLIC_KEY`, preservando o PEM multilinha, e renderiza/aplica o ConfigMap. |

#### `db-migrate` — DB Migrate & Seed

| # | Step no workflow | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Obtém a revisão que disparou o workflow. |
| 2 | Configure AWS Credentials | Configura a sessão AWS desse job; não herda credenciais/environment da preparação. |
| 3 | Configure kubectl | Configura seu próprio kubeconfig do EKS. |
| 4 | Apply DB migration Job | Renderiza o Job com nome exclusivo do run/tentativa e `image_uri` do build; aplica migrate deploy + seed e expõe `db_job.outputs.job_name`. |
| 5 | Wait DB migration Job completion | Consulta `.status.succeeded`/`.status.failed` a cada 5 s, por até 900 s; falha/timeout coleta diagnóstico do Job e logs do Pod, sem consultar Secret/environment. |
| 6 | Show DB migration Job logs | Exibe os logs de migration/seed após sucesso. |

#### `app-deploy` — App Deploy

| # | Step no workflow | O que faz |
| --- | --- | --- |
| 1 | actions/checkout | Obtém a revisão que disparou o workflow; os comandos seguintes usam esse checkout. |
| 2 | Configure AWS Credentials | Configura access key, secret key e session token da mesma sessão AWS, em us-east-1. |
| 3 | Configure kubectl | Configura o kubeconfig do EKS com as credenciais desse job; não herda a sessão do job anterior. |
| 4 | Render deployment manifest with immutable image | Fixa image_uri pela tag do commit; a política MUTABLE do ECR não fixa digest. Não injeta metadados de versão da credencial. |
| 5 | Apply Kubernetes manifests | Aplica MailHog e os recursos da API (Deployment, Service, HPA) com configuração renderizada. |
| 6 | Apply telemetry collection layer | Só com ENABLE_TELEMETRY_COLLECTION=true: verifica DD_API_KEY e aplica a coleta do Datadog Agent. |
| 7 | Wait rollout | Aguarda o rollout corrente do Deployment; indisponibilidade dentro do prazo reprova. O step não executa `rollout restart`. |

A imagem roda **somente a aplicação** (`CMD ["node", "--require", "./dist/src/otel.js", "dist/src/main"]` — o `--require` é o preload do OpenTelemetry, que precisa rodar antes de `express` e `pg` serem importados). A migração é um passo dedicado — o Job de `db-migrate` no cluster e o serviço one-shot `migrate` no `docker-compose.yml` localmente — nunca embutida no start do container. Isso evita corrida de migração entre réplicas (o HPA escala de 1 a 5 pods) e mantém o mesmo formato local e em produção.

A tag por commit facilita rastrear a origem do deploy, mas o ECR atual é `MUTABLE`: uma republicação pode alterar seu digest. A decisão e os trade-offs estão no [ADR 0004 de infra-k8s](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-k8s/blob/main/docs/adr/0004-ecr-scan-on-push-tags-mutaveis.md).

## Seed dos dados de referência

O seed **não** é um passo destrutivo. Como os seeds são idempotentes (`upsert`, sem duplicar; para usuários, a senha só é definida na criação e não é sobrescrita), ele roda junto com a migração no job `db-migrate` (`migrate deploy` + `db seed`) a cada deploy. Assim os dados de referência (incluindo os usuários Admin) são reafirmados sem apagar nada, e um ambiente cujo armazenamento tenha sido perdido se auto-recupera no próximo deploy, sem passo manual.

## 3) Workflow de SAST (`sast.yml`)

![Diagrama do workflow de SAST: job único sast, cujos steps (Checkout, Setup CI, Unit Tests com cobertura, SonarQube Scan) rodam em sequência e resultam no Quality Gate](../diagrams/sast-workflow.png)

> Este workflow tem **um único job (`sast`)**: no diagrama acima, cada caixa é um **step** (rodam em sequência no mesmo runner), não um job.

| # | Step | O que faz |
|---|---|---|
| 1 | Checkout | `actions/checkout` com `fetch-depth: 0` (histórico completo, exigido pelo Sonar) |
| 2 | Setup CI | composite `setup-ci`: Node 24 + cache npm, `npm ci`, `prisma generate` |
| 3 | Unit tests with coverage | `npm run test:cov` — gera o `lcov.info` consumido pelo Sonar |
| 4 | SonarQube Scan | `SonarSource/sonarqube-scan-action` (`projectBaseDir: app`, autenticado por `SONAR_TOKEN`) |
| → | *resultado — Quality Gate* | com `sonar.qualitygate.wait=true` o run fica **vermelho** se o gate reprovar (não é um step) |

Análise do SonarCloud num workflow dedicado. O plano do Sonar do projeto analisa apenas a **branch principal (`main`) e Pull Requests** — não branches de trabalho avulsas —, então o SAST **saiu do CI e do CD** e roda aqui:

- **`pull_request` → `main`**: análise em modo PR (detecção de _New Code_ + decoração do PR).
- **`push` → `main`**: análise da branch principal (relatório consolidado + o baseline que a análise de PR usa como referência).

Roda `test:cov` + Sonar Scan (`projectBaseDir: app`). Com `sonar.qualitygate.wait=true` (em `sonar-project.properties`), o run **fica vermelho se o quality gate reprovar**. Por ser um workflow **separado do CD**, uma análise vermelha na `main` **não bloqueia o deploy** (rodam em paralelo). A configuração do Sonar (chave do projeto, organização, exclusões, caminho do `lcov.info`) está em `sonar-project.properties`.

Como o `open-pr` abre o PR autenticado via **GitHub App** (`BOT_APP_ID` e `BOT_PRIVATE_KEY`) em vez do `GITHUB_TOKEN` nativo, a criação do PR dispara o `sast.yml` normalmente — então a análise/decoração aparece **desde o primeiro push** (tokens de GitHub Apps não sofrem a restrição de cascata do `GITHUB_TOKEN`).

O token é gerado dentro do job e existe somente durante o run. O GitHub App deve
estar instalado no repositório, com a variable `BOT_APP_ID` e o secret
`BOT_PRIVATE_KEY` disponíveis ao workflow. A chave privada não deve ser registrada
em arquivo, log ou variable sem proteção.

## 4) Workflow de DAST (`dast.yml`)

![Diagrama do workflow de DAST: job único zap-scan com geração de chave RS256 efêmera, stack Compose, autenticação interna, assinatura local do customer JWT, preparação do ZAP, scans e artifacts independentes dos dois perfis e teardown](../diagrams/dast-workflow.png)

> Este workflow tem **um único job (`zap-scan`)**: no diagrama acima, cada caixa é um **step**, não um job. O step *Start stack and wait healthy* sobe o Compose e consome o healthcheck do próprio serviço `api`. Os dois uploads e o teardown rodam com `if: always()` e aparecem tracejados; os scans interno e externo produzem resultados independentes.

| # | Step | O que faz |
|---|---|---|
| 1 | Checkout | `actions/checkout` |
| 2 | Generate an ephemeral RS256 key pair for the customer auth flow | `openssl genpkey`/`openssl rsa -pubout` — par de chaves descartável, gerado a cada run; a pública vira `CUSTOMER_JWT_PUBLIC_KEY` para a stack que sobe a seguir |
| 3 | Start the target stack and wait for it to become healthy | `docker compose -p dast up -d --build --wait --wait-timeout 180` — sobe a stack prod-like (Postgres + `migrate` + MailHog + API, esta última já com a chave pública efêmera do step anterior) e espera o **healthcheck do serviço `api`**; na expiração publica `compose ps --all` + `logs` e falha |
| 4 | Perform authentication for the internal scan pass | `POST /api/auth/login` com um admin do seed → JWT interno; injetado como `Authorization: Bearer` no _replacer_ do ZAP da passagem interna |
| 5 | Sign an ephemeral customer JWT for the external scan pass | Busca o `id` do usuário semeado `joao.silva@email.com` direto no Postgres da stack (`docker compose exec postgres psql`) e assina, com a chave privada do step 2, um `customer-jwt` RS256 (`iss`/`aud` batendo com os defaults do `docker-compose.yml`) — sem depender da Lambda externa, fora de escopo |
| 6 | Prepare the ZAP work directory | `mkdir zap-work`, copia `.zap/rules.tsv`, `chmod` |
| 7 | Run OWASP ZAP API scan — internal (Admin) auth | `zap-api-scan.py -t /api/docs-json -f openapi` — **scan ativo**, na rede `dast_default`, com o Bearer interno do step 4; gera `zap-report.{html,json}` |
| 8 | Upload the internal-auth ZAP report | `if: always()` — sobe o artifact `zap-report` mesmo se o job falhar |
| 9 | Run OWASP ZAP API scan — external (Customer) auth | Mesma imagem e alvo do step 7, mas com o Bearer `customer-jwt` do step 5 — cobre `/api/me/*` além do `401` que a passagem interna sempre recebe dessas rotas; gera `zap-report-customer.{html,json}` |
| 10 | Upload the external-auth ZAP report | `if: always()` — sobe o artifact `zap-report-customer`, separado do da passagem interna |
| 11 | Tear down the stack | `if: always()` — `docker compose down -v` |
| → | *resultado* | job fica **vermelho** se **qualquer uma das duas passagens** encontrar alerta ≠ `IGNORE` |

Teste dinâmico de segurança (**DAST**) com **OWASP ZAP**, num workflow dedicado — como o SAST, roda em paralelo ao CI/CD e não bloqueia nenhum deles. Diferente do SAST (separado por limitação do plano do Sonar), o DAST é separado por ter um **ciclo de gatilho próprio**:

- **`pull_request` → `main`**: escaneia o candidato a merge — o gate natural do DAST.
- **`workflow_dispatch`**: execução sob demanda.

Deliberadamente **não** roda em `push` de branch de trabalho (o CI já cobre o loop rápido; subir a stack inteira a cada push seria caro e redundante) nem em `push` → `main` (a `main` é protegida — só entra via PR —, então o scan do PR já cobriu aquele código).

O job sobe a **stack prod-like inteira** a partir do `app/docker-compose.yml` (`-p dast`: `postgres` + `migrate` = `prisma migrate deploy` + `db seed` + `mailhog` + `api` com `NODE_ENV=production`) e roda o `zap-api-scan.py` (`-f openapi`) **duas vezes** contra a mesma spec em `/api/docs-json`, uma por fluxo de autenticação da API: a primeira faz login em `POST /api/auth/login` com um admin do seed (JWT interno, `JwtAuthGuard`); a segunda assina, ela mesma, um `customer-jwt` RS256 para um usuário externo já semeado, com a chave privada de um par efêmero gerado no início do job (a pública correspondente substitui o `CUSTOMER_JWT_PUBLIC_KEY` da stack antes do `up`). Em ambas, o token é injetado em cada requisição via _replacer_ do ZAP (`ZAP_AUTH_HEADER*`) — sem isso o scan só veria `401`, e é exatamente esse ponto cego que a segunda passagem fecha para as rotas `/api/me/*`: elas exigem `customer-jwt`, não o JWT interno, então sem a segunda passagem nenhum parâmetro ou caminho pós-guard dessas rotas era exercitado.

**O portão de prontidão é o healthcheck do próprio serviço `api`**, declarado uma vez no `app/docker-compose.yml` (`wget` do BusyBox contra `/api/health/ready`) e consumido pelo `up --wait` — não um laço de espera mantido em paralelo no workflow, que divergiria do endpoint que o orquestrador de fato consulta.

- **O que o portão prova.** Que a aplicação **alcança o banco** — é o mesmo endpoint que o `readinessProbe` do k8s consulta, e é a mesma definição de "pronto" nos dois lugares.
- **O que o portão *não* prova.** Ele **não** garante que as migrations rodaram nem que o seed existe. Essa garantia vem do `depends_on: migrate: service_completed_successfully` do Compose, e as duas são **distintas**. Confundi-las convida a regressão em que a prontidão fica verde contra um schema vazio e as falhas do scan parecem achados em vez de artefato de ordem.

O `--wait` sai com código diferente de zero na expiração, e o step seguinte não rodaria — por isso o diagnóstico (`compose ps --all` e `logs`) é publicado de dentro do próprio step, e uma stack que nunca fica pronta falha rápido e de forma diagnosticável em vez de pendurar. O serviço `migrate`, que sai com código 0 sob `service_completed_successfully`, **não** invalida o `--wait`. Todos os steps invocam `docker compose` sem `-f`/`-p`: `COMPOSE_FILE` e `COMPOSE_PROJECT_NAME` estão no `env` do workflow e são lidos nativamente pela CLI.

O sink de e-mail é tratado do mesmo jeito: esperar a stack prova que o container do MailHog está rodando, não que a porta SMTP aceita conexões. Se o scan passar a depender de entrega de e-mail — e não apenas da ausência de recusa de conexão —, quem declara essa condição é o **próprio serviço MailHog**; a prontidão da API não é estendida para cobri-lo.

As duas rotas de saúde são públicas e aparecem no `/api/docs-json`, então **são escaneadas ativamente como qualquer outra**. Escondê-las da spec para evitar o scan não é opção: são superfície não autenticada, e é exatamente isso que o scan existe para exercitar.

O ZAP roda **na rede do compose** (`--network dast_default`, alvo `http://api:3000`) nas duas passagens: alcança a API pelo nome do serviço e escaneia a mesma imagem que o CD entrega — dá paridade com produção e evita o clássico problema de `localhost` resolver para o próprio container do ZAP. O `.zap/rules.tsv` (compartilhado pelas duas passagens) silencia alertas que não se aplicam a uma API stateless com Bearer JWT (ausência de token anti-CSRF, três flags de cookie de sessão) e o falso-positivo de XSS refletido em resposta JSON (`40014` — `Content-Type: application/json`, que o navegador nunca executa como HTML).

O job **falha se qualquer uma das duas passagens do ZAP encontrar problemas** — qualquer alerta não marcado como `IGNORE` faz o `zap-api-scan.py` sair com código diferente de zero e o job fica **vermelho**, como acontece com o SAST. Os relatórios (HTML + JSON, um por passagem) **não se perdem**: sobem como artifacts (`zap-report` e `zap-report-customer`) do run mesmo quando o job falha (upload com `if: always()`). O `.zap/rules.tsv` é a alavanca de calibração — os primeiros runs provavelmente ficam vermelhos até você marcar os falsos-positivos como `IGNORE` (se falhar em todo WARN for agressivo demais, dá para usar `-I` e marcar como `FAIL` só as regras que devem bloquear). As credenciais do admin do seed vêm de **secrets do repositório** (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`), nunca hardcoded, e são usadas só contra o banco descartável do job; a segunda passagem não usa senha nenhuma — o job assina o próprio `customer-jwt` com uma chave RS256 gerada e descartada a cada run, isolado da Lambda externa (fora de escopo, ver [testing.md](../testing.md#autenticação-externa-nos-testes-customer-jwt)) exatamente como os testes E2E fazem com `test/helpers/customer-jwt.helper.ts`. O `zap-api-scan.py` roda por padrão um **scan ativo** afinado para APIs (importa a spec OpenAPI e exercita os endpoints) — como o alvo é sempre a stack efêmera do job, nunca um ambiente real, eventuais escritas são inofensivas.

## Secrets e Variables

Para que os workflows e o provisionamento funcionem corretamente, é necessário configurar os secrets e variables do repositório no GitHub. A tabela abaixo é a referência prática de configuração, incluindo onde cada item é usado.

| Tipo | Nome | Usado em | Finalidade |
|---|---|---|---|
| Secret | `AWS_ACCESS_KEY_ID` | `cd.yml` | Credencial AWS (Academy) para publicar a imagem e acessar o cluster |
| Secret | `AWS_SECRET_ACCESS_KEY` | `cd.yml` | Segredo complementar da credencial AWS |
| Secret | `AWS_SESSION_TOKEN` | `cd.yml` | Token temporário de sessão (Academy) — expira e precisa ser renovado a cada lab |
| Secret | `SONAR_TOKEN` | `sast.yml` | Autenticação do SonarQube Scan (workflow de SAST: PR + `main`) |
| Secret | `SEED_ADMIN_EMAIL` | `dast.yml` | E-mail do admin do seed usado no login que autentica o scan ZAP (só contra o banco descartável do job) |
| Secret | `SEED_ADMIN_PASSWORD` | `dast.yml` | Senha do admin do seed para o mesmo login — secret para não expor no arquivo do workflow e mascarar nos logs |
| Variable | `BOT_APP_ID` | `ci.yml` | Identidade do GitHub App que o job `open-pr` usa para abrir o PR de modo que dispare o `sast.yml` (o `GITHUB_TOKEN` não dispara workflows) |
| Secret | `BOT_PRIVATE_KEY` | `ci.yml` | Chave privada do mesmo GitHub App |
| Secret | `JWT_SECRET` | `cd.yml` | Assinatura dos access tokens JWT |
| Secret | `JWT_REFRESH_SECRET` | `cd.yml` | Assinatura dos refresh tokens JWT |
| Secret | `CUSTOMER_JWT_PUBLIC_KEY` | `cd.yml` | Chave **pública** RS256 usada para verificar o token externo (`customer-jwt`) do Cliente da Oficina — a chave privada correspondente vive na função serverless externa, fora deste repositório. Pode ser cadastrada no formato PEM natural (multilinha); `prepare-deploy` cria o Secret via `kubectl create secret --from-literal`, que não exige convertê-la para uma linha só — ver [kubernetes.md](kubernetes.md#convenções-labels-e-wiring-de-configuração) |
| Secret | `DD_API_KEY` | `cd.yml` | Chave usada pelo Datadog Agent; obrigatória quando `ENABLE_TELEMETRY_COLLECTION == 'true'` |
| Variable | `RDS_INSTANCE_IDENTIFIER` | `cd.yml` | Identificador estável usado para descobrir endpoint, porta, banco, usuário e ARN; valor de produção: `rds-oficina-mecanica-work-order` |
| Variable | `ENABLE_TELEMETRY_COLLECTION` | `cd.yml` | Quando `true`, aplica o Secret, o DaemonSet e o Service do Datadog Agent |
| Variable | `OTEL_EXPORTER_OTLP_ENDPOINT` | `cd.yml` | Renderizada no ConfigMap da API; vazia desliga o SDK OpenTelemetry, e preenchida aponta traces e métricas para um coletor OTLP/HTTP |
| Variable | `PRISMA_GENERATE_DATABASE_URL` | `ci.yml`, `cd.yml`, `sast.yml` | URL fake usada apenas pelo `prisma generate` (só parseada, nunca conectada); há fallback embutido nos workflows |
| Variable | `ECR_REPOSITORY` | `cd.yml` | Nome do repositório ECR onde a imagem da aplicação é publicada |
| Variable | `EKS_CLUSTER_NAME` | `cd.yml` | Nome do cluster EKS usado para `aws eks update-kubeconfig` |
| Variable | `K8S_DEPLOYMENT_NAME` | `cd.yml` | Nome do Deployment usado no `kubectl rollout status` |
| Variable | `K8S_NAMESPACE` | `cd.yml` | Namespace onde a aplicação e os Jobs de banco são aplicados |
| Variable | `ENABLE_DEPLOY` | `cd.yml` | Habilita ou desabilita os quatro jobs de CD (`build-push-image`, `prepare-deploy`, `db-migrate`, `app-deploy`), salvo dispatch manual |

`ENABLE_TELEMETRY_COLLECTION` e `OTEL_EXPORTER_OTLP_ENDPOINT` são controles independentes: o primeiro aplica a camada do Agent e o segundo liga o SDK da aplicação. O workflow aplica o ConfigMap no job `prepare-deploy`; depois de migration/seed, `app-deploy` aplica o Deployment com imagem do commit e aguarda o rollout corrente. Não há um `rollout restart` explícito nem annotation de versão da credencial.

Os secrets ficam no nível do repositório ou organização porque são consumidos por mais de um contexto. Como as credenciais são de laboratório do AWS Academy, o `AWS_SESSION_TOKEN` expira quando o lab é reiniciado e precisa ser reconfigurado a cada sessão.

### Injeção de secrets da aplicação

- Antes das chamadas AWS/kubectl da preparação, `prepare-deploy` roda `Validate required secrets`: se `CUSTOMER_JWT_PUBLIC_KEY` não estiver cadastrado (string vazia) ou não contiver `BEGIN PUBLIC KEY`, o job falha imediatamente com `::error::` explicando a causa. Sem essa checagem, a falha só apareceria depois — no pod da API, como um `TypeError: JwtStrategy requires a secret or key` genérico do `passport-jwt`, já em `CrashLoopBackOff`. O build anterior já usa AWS/ECR, mas não aplica configuração ao cluster.
- A credencial do banco não existe nos settings do GitHub. O CD descobre os metadados pelo RDS, lê o ARN completo em `MasterUserSecret`, obtém `AWSCURRENT` e materializa a URL apenas no Secret Kubernetes `database-credentials`, por manifesto JSON via stdin.
- Senha, senha percent-encoded, URL e URL em base64 são mascaradas antes do `kubectl`; não são enviadas a argumentos de processo, outputs, artifacts ou arquivos renderizados. As máscaras protegem logs, não command lines, e base64 não é criptografia. A preparação não publica outputs de versão.
- Todas as stacks foram destruídas e o deploy será greenfield, com rotação automática desabilitada. Os novos Pods carregam o Secret recém-materializado, sem controle de versão no pod template. Se somente a credencial mudar em um ambiente com Pods existentes e a mesma imagem, atualizar o Secret não renova seu environment nem força novo rollout; esse cenário exige revisão do fluxo.
- O job cria `api-secret` separadamente com `kubectl create secret --from-literal`; `k8s/01-api-secret.yaml` permanece como referência segura para deploy manual (ver [kubernetes.md](kubernetes.md#deploy-em-kubernetes-manual)). Esse Secret contém somente:
  - `JWT_SECRET`
  - `JWT_REFRESH_SECRET`
  - `CUSTOMER_JWT_PUBLIC_KEY`

O comando imperativo aceita o PEM multilinha sem re-escapar quebras de linha. Renderizar essa chave crua em `stringData` com `envsubst` quebraria o YAML; por isso o manifesto de referência não é o mecanismo usado pelo CD. A credencial do banco tem transporte separado: manifesto JSON criado pelo trecho Node.js inline e aplicado por stdin, nunca `--from-literal=DATABASE_URL` ou `jq --arg` com a URL/base64. Não existe arquivo Node.js auxiliar de produção.

A decisão completa e as alternativas rejeitadas estão no [ADR 0017](../adr/0017-materializacao-da-credencial-do-banco-no-cd.md).
