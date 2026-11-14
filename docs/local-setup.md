# 💻 Como executar localmente

Setup local (API na máquina, infra no Docker), variáveis de ambiente e dados de seed. A API depende de dois outros serviços da solução, cada um com a própria stack local: o Inventory, dono do catálogo de serviços e peças e do estoque, e o Identity, dono dos usuários e das credenciais, onde se faz o login. Para subir tudo em containers com um comando, veja o Quick Start no [README](../README.md).

## Índice

- [Setup local](#setup-local)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Seed](#seed)

## Setup local

Neste modo a API roda diretamente na sua máquina com `npm run start:dev`, enquanto apenas a infraestrutura (PostgreSQL 18, Valkey e LocalStack) é provida via Docker. Pré-requisitos: **Node.js 24.9+** (24.15+ para os comandos de geração do CLI, como `nest generate`, mínimo do `@nestjs/schematics` 12) e Docker com Docker Compose.

### Valkey (cache)

O Valkey 9.1 do compose faz o papel do ElastiCache: guarda o detalhe das ordens de serviço (cache-aside, ver [Cache do detalhe da OS](architecture.md#cache-do-detalhe-da-os)). Ele exige a senha `valkey` e escuta em `127.0.0.1:6379`, o que o `CACHE_URL` do `.env.example` já reflete. Se o Valkey estiver parado, a API continua respondendo: a leitura cai para o banco e o log registra `cache.unavailable`.

### LocalStack (SNS e SQS)

O LocalStack 4.14.0 emula o SNS e o SQS em `http://localhost:4566`. Ao subir, o script `app/localstack/init-topology.sh` cria o tópico `oficina-events.fifo`, as filas FIFO de cada serviço com as DLQs (filas das mensagens que falharam; a mensagem vai para lá depois de cinco recebimentos, `maxReceiveCount` 5) e as assinaturas com as filter policies por `type`. O container só fica saudável depois que o script termina. O script é cópia do repositório de mensageria da oficina e não é editado aqui.

A API acha o LocalStack por `AWS_ENDPOINT_URL`, variável que o próprio SDK da AWS lê; `AWS_ACCESS_KEY_ID` e `AWS_SECRET_ACCESS_KEY` aceitam qualquer valor (`test`). No cluster, `AWS_ENDPOINT_URL` não existe e o SDK usa os endpoints reais da região.

### E-mails (fila `notification.fifo`)

A API não envia e-mail. Os e-mails ao cliente (orçamento enviado, link de pagamento e aviso de falta de estoque) saem como mensagens `notification.email.send`, publicadas no tópico SNS `oficina-events.fifo` e entregues à fila SQS `notification.fifo`, que no cluster alimenta a função serverless de notificação ([`oficina-mecanica-lambda-notification`](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-notification)), a responsável pelo envio. Localmente essa função não roda, e as mensagens ficam na `notification.fifo` do LocalStack. Para lê-las:

```bash
docker compose exec localstack sh -c 'awslocal sqs receive-message --max-number-of-messages 10 \
  --queue-url "$(awslocal sqs get-queue-url --queue-name notification.fifo --query QueueUrl --output text)"'
```

Cada mensagem traz no `payload` o destinatário (`to`), o assunto, o texto, o HTML e o `purpose` (`quote_sent`, `payment_link` ou `quote_approval_reverted`). Ler não apaga a mensagem: ela some por 30 s e volta; depois de cinco leituras, vai para a DLQ `notification-dlq.fifo`.

### Passo a passo

> Toda a aplicação vive em `app/` (não há `package.json` na raiz). Execute os comandos abaixo — e todos os `npm`/`prisma`/`docker compose` — a partir de `app/`.

```bash
# 1. Entrar na pasta da aplicação e instalar dependências
cd app
npm install

# 2. Copiar as variáveis de ambiente e a chave pública do token de funcionário do Identity local
#    (ver "Chave do token de funcionário" abaixo; ajuste o caminho do clone do Identity)
cp .env.example .env
grep '^STAFF_JWT_PUBLIC_KEY=' ../../oficina-mecanica-identity-service/app/.env >> .env

# 3. Subir a infraestrutura (PostgreSQL, Valkey e LocalStack), sem o container da API
docker compose up postgres valkey localstack -d --wait

# 4. Configurar banco (migrate + generate + seed)
npm run db:setup

# 5. Iniciar a aplicação em modo watch
npm run start:dev
```

> **Subiu a stack antes de o compose se chamar `work-order`?** A stack antiga pertence ao projeto `app`, ocupa as mesmas portas e guarda os dados no volume `app_postgres_data`; a nova cria o volume `work-order_postgres_data`, vazio. Antes do passo 3, remova a antiga com `docker compose -p app down -v`, que **apaga os dados locais dela** (inclusive os de outro serviço que também tenha subido como projeto `app`), e rode o passo 4 de novo.

Após a inicialização:

- **API:** `http://localhost:3000`
- **Swagger:** `http://localhost:3000/api/docs`
- **LocalStack (SNS/SQS):** `http://localhost:4566`

Para executar chamadas à API, use o Swagger em `/api/docs` ou importe a collection e o environment do Postman (`collections/oficina-collection.json` e `collections/oficina-environment.json`) — o passo a passo está em [Testes › Postman / Newman](testing.md#postman--newman).

## Variáveis de Ambiente

Veja `.env.example` para todas as variáveis disponíveis.

```env
# Aplicação
PORT=3000
NODE_ENV=development
TZ=America/Sao_Paulo

# Banco de dados
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/work_order?schema=public

# Validação do token de funcionário, emitido pelo Identity (RS256; só a chave pública,
# copiada do .env do Identity no passo 2)
STAFF_JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
STAFF_JWT_KEY_ID=staff-local
STAFF_JWT_ISSUER=oficina-identity
STAFF_JWT_AUDIENCE=oficina-services

# Autenticação do Cliente (via função serverless externa)
CUSTOMER_JWT_PUBLIC_KEY=your-rs256-public-key-pem
CUSTOMER_JWT_ISSUER=oficina-customer-auth
CUSTOMER_JWT_AUDIENCE=oficina-api

# CORS — separar múltiplas origens por vírgula
ALLOWED_ORIGINS=http://localhost:3000

# Mensageria (SNS/SQS FIFO). Localmente, o LocalStack do compose cria o tópico e
# as filas; AWS_ENDPOINT_URL é lido pelo próprio SDK e não existe no cluster.
AWS_REGION=us-east-1
AWS_ENDPOINT_URL=http://localhost:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
WORK_ORDER_QUEUE_NAME=work-order.fifo
MESSAGING_TOPIC_ARN=arn:aws:sns:us-east-1:000000000000:oficina-events.fifo

# Cache (Valkey). redis:// local; rediss:// com senha no cluster.
CACHE_URL=redis://:valkey@localhost:6379
# Validade de cada entrada em segundos: inteiro maior que zero (vazio = 43200, 12 h).
# Outro valor impede a API de subir.
CACHE_TTL_SECONDS=43200

# Rotas internas do Inventory (porta publicada pela stack local dele)
INVENTORY_SERVICE_URL=http://localhost:3003

# Rotas internas do Billing (porta publicada pela stack local dele)
BILLING_SERVICE_URL=http://localhost:3002

# Rotas internas do Identity (porta publicada pela stack local dele)
IDENTITY_SERVICE_URL=http://localhost:3001

# Observabilidade — todas opcionais; nenhuma variável ausente ou inválida impede o boot
# Níveis aceitos: fatal | error | warn | info | debug | trace | silent (default: info)
LOG_LEVEL=info
OTEL_SERVICE_NAME=oficina-mecanica-work-order-service
OTEL_SERVICE_NAMESPACE=oficina-mecanica
# Lista separada por vírgula (ex.: 10.0.0.0/8,loopback). Ausente ou inválida =
# nenhum proxy confiável e cabeçalhos X-Forwarded-For ignorados (falha fechada).
# TRUSTED_PROXY_CIDRS=

# Telemetria (traces e métricas). VAZIO = desligada por completo: nenhuma
# instrumentação registrada, nenhum exportador, nenhuma conexão de saída.
# Não existe variável de habilitação — a ausência do endereço é o interruptor.
OTEL_EXPORTER_OTLP_ENDPOINT=
OTEL_LOGS_EXPORTER=none
OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta
```

`SERVICE_VERSION` **não** é configurada por env em desenvolvimento: ela é assada na imagem (`ARG SERVICE_VERSION` no `Dockerfile`, alimentado pelo `github.sha` no `cd.yml`) e cai para `dev` fora do contêiner. `deployment.environment.name` reaproveita o `NODE_ENV` já existente — não há variável nova para ambiente.

`WORK_ORDER_QUEUE_NAME`, `MESSAGING_TOPIC_ARN`, `CACHE_URL`, `INVENTORY_SERVICE_URL`, `BILLING_SERVICE_URL` e `IDENTITY_SERVICE_URL` são obrigatórias: sem elas a API não sobe. `CACHE_TTL_SECONDS` é opcional, mas um valor que não seja inteiro maior que zero também impede o boot, porque faria toda gravação no cache falhar. No cluster, o CD monta o ARN do tópico com a conta da AWS e o `CACHE_URL` usa `rediss://` com a senha do ElastiCache.

### Inventory local

`INVENTORY_SERVICE_URL` é o endereço das rotas `/internal` do Inventory, o serviço da solução dono do catálogo de serviços e peças e do estoque ([`oficina-mecanica-inventory-service`](https://github.com/FIAP-15SOAT/oficina-mecanica-inventory-service)). A API o chama para mostrar nome e descrição dos itens da OS e montar as métricas por serviço. Localmente, suba a stack do Inventory pelo `docker compose` do repositório dele, que publica a API na porta `3003` do host.

- **API na máquina** (`npm run start:dev`): `http://localhost:3003`, o valor do `.env.example`.
- **API no compose** (Quick Start): o `docker-compose.yml` sobrescreve o valor com `http://host.docker.internal:3003`. O nome `host.docker.internal` aponta, de dentro do container, para a máquina que roda o Docker; o `extra_hosts` (`host.docker.internal:host-gateway`) o declara também no Linux, onde o Docker não o cria sozinho.

Sem o Inventory de pé, a API sobe normalmente, mas as rotas que mostram ou gravam itens respondem 503. No cluster, o ConfigMap usa o endereço interno do Inventory, `http://inventory-service.inventory.svc.cluster.local:3000`.

### Billing local

`BILLING_SERVICE_URL` é o endereço das rotas `/internal` do Billing, o serviço da solução dono dos orçamentos e dos pagamentos ([`oficina-mecanica-billing-service`](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service)). A API o chama para criar o orçamento inicial na abertura de uma OS com itens (e apagá-lo se a gravação da OS falhar), para ler e decidir os orçamentos na área do Cliente da Oficina, para ler o orçamento aprovado quando o Inventory confirma a reserva do estoque, para conferir o saldo antes de entregar uma OS e para listar as cobranças na área do cliente. Localmente, suba a stack do Billing pelo `docker compose` do repositório dele, que publica a API na porta `3002` do host.

- **API na máquina** (`npm run start:dev`): `http://localhost:3002`, o valor do `.env.example`.
- **API no compose** (Quick Start): o `docker-compose.yml` sobrescreve o valor com `http://host.docker.internal:3002`, pelo mesmo `host.docker.internal` do Inventory.

Sem o Billing de pé, a API sobe normalmente, mas a abertura de OS com itens, a entrega e as rotas de orçamento e de cobrança de `/api/me` respondem 503, e uma mensagem `inventory.stock.reserved` volta à fila até o Billing responder. No cluster, o ConfigMap usa o endereço interno do Billing, `http://billing-service.billing.svc.cluster.local:3000`.

### Identity local

`IDENTITY_SERVICE_URL` é o endereço das rotas `/internal` do Identity, o serviço da solução dono dos usuários e das credenciais ([`oficina-mecanica-identity-service`](https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service)). É nele que o funcionário faz login, e a API o chama para mostrar o mecânico atribuído e os autores do histórico das OS, conferir o mecânico antes de abrir ou editar uma OS, criar o usuário de acesso de um cliente, listar os usuários vinculados e achar os usuários vinculados que recebem os e-mails de orçamento enviado, de cobrança e de falta de estoque. O Identity, por sua vez, chama `GET /internal/users/:userId/customers` desta API para montar o perfil de `GET /api/me`. Localmente, suba a stack do Identity pelo `docker compose` do repositório dele, que publica a API na porta `3001` do host.

- **API na máquina** (`npm run start:dev`): `http://localhost:3001`, o valor do `.env.example`.
- **API no compose** (Quick Start): o `docker-compose.yml` sobrescreve o valor com `http://host.docker.internal:3001`, pelo mesmo `extra_hosts` do Inventory.

Sem o Identity de pé, a API sobe normalmente, mas o login não existe, as rotas que mostram ou conferem usuários respondem 503 (ver [Usuários lidos no Identity](api.md#usuários-lidos-no-identity)) e as mensagens `billing.quote.sent`, `billing.payment.requested` e `billing.quote.approval_reverted` (esta só quando a reversão é por falta de estoque) voltam à fila até o Identity responder. No cluster, o ConfigMap usa o endereço interno do Identity, `http://identity-service.identity.svc.cluster.local:3000`.

### Chave do token de funcionário

O token de funcionário é assinado pelo Identity; esta API só o valida, com a chave pública `STAFF_JWT_PUBLIC_KEY`. Por isso a chave daqui tem de ser a metade pública do mesmo par cuja privada o Identity local usa: o passo 2 copia a linha `STAFF_JWT_PUBLIC_KEY=` do `app/.env` do Identity, gerada pelos comandos do `docs/local-setup.md` dele, para o `.env` desta API. O `STAFF_JWT_KEY_ID=staff-local` do `.env.example` é o mesmo nos dois serviços. Sem essa variável, a API não sobe e o `docker compose` para com a mensagem `Gere as chaves RS256 de funcionário conforme docs/local-setup.md`; com uma chave de outro par, toda rota de funcionário responde 401. Se o Identity gerar um par novo, copie a linha de novo.

Depois, faça login no Identity e use o `accessToken` nesta API:

```bash
curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"guilhermedarochasalvador@gmail.com","password":"Tech@2026"}'
```

> **Atenção**: em produção, a chave não vem do `.env`: a pública e o `kid` vêm de secrets da organização (ver [Segurança › Chaves dos tokens](security.md#chaves-dos-tokens)). O `CUSTOMER_JWT_PUBLIC_KEY` padrão do `docker-compose.yml` é só um placeholder.

### `CUSTOMER_JWT_PUBLIC_KEY` é metade de um par

A chave pública configurada aqui precisa corresponder à chave **privada** carregada pela [`oficina-mecanica-lambda-customer-auth`](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth) — são as duas metades do mesmo par RS256, geradas juntas:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out customer-auth-private.pem
openssl rsa -pubout -in customer-auth-private.pem -out customer-auth-public.pem
```

A pública (`customer-auth-public.pem`) vai em `CUSTOMER_JWT_PUBLIC_KEY` aqui; a privada (`customer-auth-private.pem`) vai em `CUSTOMER_JWT_PRIVATE_KEY` na lambda — **nunca** o inverso, e a privada nunca entra neste repositório. Como o `.env` não transporta quebra de linha, registre a chave com `\n` escapado no lugar das quebras reais (é o único formato que funciona; `CustomerJwtStrategy` já espera isso e desfaz o escape em runtime):

```bash
awk 'NF {sub(/\r/, ""); printf "%s\\n", $0}' customer-auth-public.pem
```

> **Se o login funcionar do lado da lambda e a API devolver 401 em `/api/me/*` mesmo assim, confira o par de chaves primeiro.** A API falha fechada por design: uma chave pública que não corresponde à privada da lambda (ou um `CUSTOMER_JWT_ISSUER`/`CUSTOMER_JWT_AUDIENCE` divergente) produz exatamente o mesmo sintoma — `401` indistinguível de uma credencial recusada — mesmo com a API saudável e respondendo normalmente. Não é um bug, mas custa tempo de depuração se você não souber que é o primeiro lugar a olhar.

O passo a passo completo de rodar os dois repositórios juntos (API + lambda) está documentado do lado da lambda, em `docs/local-setup.md` › **Os dois repositórios juntos**.

### Telemetria controlada pelo endpoint

`OTEL_EXPORTER_OTLP_ENDPOINT` é o interruptor da telemetria. Em desenvolvimento ela fica **inativa por padrão** porque a variável começa vazia; nesse estado, o preload retorna cedo e o SDK não registra instrumentação alguma. Os logs, os health checks e todo o restante do comportamento seguem idênticos, e nenhuma conexão de saída é tentada. Em produção, o workflow de CD renderiza no ConfigMap o valor da variável homônima configurada no GitHub Actions.

Para exercitar a telemetria localmente, aponte a variável para um coletor OTLP/HTTP (por exemplo `http://localhost:4318`) e use `npm run start:prod`, que carrega o preload como a imagem de produção faz. O `npm run start:dev` **não** carrega o preload: em modo watch o objetivo é a iteração rápida, e a instrumentação de verdade é verificada na stack do compose (ver [testes](./testing.md#telemetria-o-que-o-jest-não-instrumenta)).

⚠️ `OTEL_RESOURCE_ATTRIBUTES` **não** deve declarar `service.name`, `service.namespace`, `service.version`, `service.instance.id` nem `deployment.environment.name`: o detector de ambiente vence o resource montado em código e o caminho de log ignora essa variável — trace e log passariam a reportar valores diferentes, em silêncio.

### Logs legíveis em desenvolvimento

O processo **sempre** emite JSON em stdout — o formato nunca varia por ambiente (ver [ADR 0002](./adr/0002-logging-estruturado.md)). A saída legível vem de um pipe já embutido no `start:dev`:

```
"start:dev": "nest start --watch | pino-pretty --timestampKey timestamp --messageKey message"
```

As duas flags são **obrigatórias**: o envelope renomeia `time` → `timestamp` e `msg` → `message`, então um pipe sem elas não renderiza nem o horário nem a mensagem. (`pino-pretty` já lida com rótulos textuais de nível, então `level` não precisa de flag.) `pino-pretty` é `devDependency` e **nunca** deve ser importado de `src/` nem declarado como `transport` no código.

Para silenciar completamente a saída em uma execução local, use `LOG_LEVEL=silent`.

## Seed

O seed desta API não cria usuários: os usuários e as senhas são do Identity, e o seed dele cria os 4 usuários Admin com senha padrão `Tech@2026`, com os ids canônicos de [Ids canônicos do seed](seed-ids.md):

| Nome | E-mail | Senha |
|------|--------|-------|
| Guilherme da Rocha Salvador | `guilhermedarochasalvador@gmail.com` | `Tech@2026` |
| Lucas Almeida da Silva | `lucas.almeida-silva@hotmail.com` | `Tech@2026` |
| Ramoon Lincoln Barros Camacho | `ramooncamacho@hotmail.com` | `Tech@2026` |
| Renan Santana Camacho | `camacho.renan@gmail.com` | `Tech@2026` |

Use qualquer um desses e-mails com a senha `Tech@2026` em `POST /api/auth/login` do Identity (`http://localhost:3001` localmente) para obter o token de funcionário que esta API aceita.

O seed do Identity também cria dois usuários de cliente (`role: null`, com CPF), e o seed desta API cria os vínculos deles com clientes ativos, pelo id canônico de cada usuário — para testar `/api/me/*` sem cadastrar nada:

| Usuário | Id do usuário | Cliente vinculado |
|---|---|---|
| `joao.silva@email.com` | `212ca9d7-fa8f-4111-9746-d431da68b063` | João da Silva — pessoa física (INDIVIDUAL, CPF `12345678909`) |
| `maria.souza@email.com` | `6aa85b42-72dd-4ca2-bc94-a1080cfc5a3b` | Oficina Parceira LTDA — empresa (COMPANY, CNPJ `12345678000195`) |

Para chamar `/api/me/*` localmente, assine um token de cliente com o `sub` de um desses usuários, como em [Token de cliente local](https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service/blob/main/docs/local-setup.md#token-de-cliente-local) do Identity, com a privada do par cuja pública está em `CUSTOMER_JWT_PUBLIC_KEY` aqui. A [`oficina-mecanica-lambda-customer-auth`](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth), a função Lambda de login do cliente, confere o CPF e a senha no Identity e lê os vínculos em `GET /internal/users/:userId/customers` desta API; para usá-la localmente, aponte-a para o Identity e para esta API.

Os scripts de seed em `prisma/seeds/` são executados em ordem pelo entrypoint `prisma/seed.ts`: `work-order-status-info.seed.ts` (tabela de referência da prioridade de cada status de OS, de `RECEIVED` 1 a `CANCELLED` 10, com `AWAITING_PAYMENT` em 6, entre `APPROVED` e `IN_PROGRESS`; a migration `add_awaiting_payment_priority` grava os mesmos valores num banco que já existia), depois `customer.seed.ts`, `user-customer.seed.ts` (os vínculos da tabela acima), `vehicle.seed.ts` e `work-order.seed.ts`. Eles populam dados de referência para acelerar o onboarding e os testes manuais. Todos são idempotentes (`upsert`), então podem rodar a cada deploy sem duplicar registros.

Clientes e veículos nascem com **UUIDs fixos**, os mesmos em todos os serviços da oficina, para que as referências entre serviços casem desde o primeiro deploy; os vínculos usam os ids fixos dos usuários do Identity. Serviços e peças são semeados pelo Inventory, com os ids da mesma lista; as OS do seed usam esses ids nos itens. A lista canônica está em [Ids canônicos do seed](seed-ids.md).
