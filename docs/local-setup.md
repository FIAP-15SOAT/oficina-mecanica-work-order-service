# 💻 Como executar localmente

Setup local (API na máquina, infra no Docker), variáveis de ambiente e dados de seed. Para subir tudo em containers com um comando, veja o Quick Start no [README](../README.md).

## Índice

- [Setup local](#setup-local)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Seed](#seed)

## Setup local

Neste modo a API roda diretamente na sua máquina com `npm run start:dev`, enquanto apenas a infraestrutura (PostgreSQL 18, MailHog, Valkey e LocalStack) é provida via Docker. Pré-requisitos: **Node.js 24.9+** (24.15+ para os comandos de geração do CLI, como `nest generate`, mínimo do `@nestjs/schematics` 12) e Docker com Docker Compose.

### MailHog

O MailHog é um servidor SMTP de desenvolvimento que captura todos os e-mails enviados pela aplicação (ex.: links de aprovação de orçamentos) sem entregá-los de verdade. Acesse a caixa de entrada em `http://localhost:8025` após subir os serviços de infraestrutura.

As variáveis de ambiente necessárias para integração com o MailHog já estão pré-configuradas no `.env.example`:

```env
MAIL_HOST=localhost
MAIL_PORT=1025
MAIL_FROM="Oficina Mecânica <noreply@oficina.local>"
```

### Valkey (cache)

O Valkey 9.1 do compose faz o papel do ElastiCache: guarda o detalhe das ordens de serviço (cache-aside, ver [Cache do detalhe da OS](architecture.md#cache-do-detalhe-da-os)). Ele exige a senha `valkey` e escuta em `127.0.0.1:6379`, o que o `CACHE_URL` do `.env.example` já reflete. Se o Valkey estiver parado, a API continua respondendo: a leitura cai para o banco e o log registra `cache.unavailable`.

### LocalStack (SNS e SQS)

O LocalStack 4.14.0 emula o SNS e o SQS em `http://localhost:4566`. Ao subir, o script `app/localstack/init-topology.sh` cria o tópico `oficina-events.fifo`, as filas FIFO de cada serviço com as DLQs (`maxReceiveCount` 5) e as assinaturas com as filter policies por `type`. O container só fica saudável depois que o script termina. O script é cópia do repositório de mensageria da oficina e não é editado aqui.

A API acha o LocalStack por `AWS_ENDPOINT_URL`, variável que o próprio SDK da AWS lê; `AWS_ACCESS_KEY_ID` e `AWS_SECRET_ACCESS_KEY` aceitam qualquer valor (`test`). No cluster, `AWS_ENDPOINT_URL` não existe e o SDK usa os endpoints reais da região.

### Passo a passo

> Toda a aplicação vive em `app/` (não há `package.json` na raiz). Execute os comandos abaixo — e todos os `npm`/`prisma`/`docker compose` — a partir de `app/`.

```bash
# 1. Entrar na pasta da aplicação e instalar dependências
cd app
npm install

# 2. Copiar as variáveis de ambiente e gerar as chaves RS256 de teste do token de funcionário
cp .env.example .env
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out staff.pem
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out staff-refresh.pem
openssl pkey -in staff.pem -pubout -out staff.pub.pem
node -e "const pem = (f) => JSON.stringify(require('node:fs').readFileSync(f, 'utf8')); console.log(['STAFF_JWT_PRIVATE_KEY=' + pem('staff.pem'), 'STAFF_JWT_REFRESH_PRIVATE_KEY=' + pem('staff-refresh.pem'), 'STAFF_JWT_PUBLIC_KEY=' + pem('staff.pub.pem')].join('\n'))" >> .env
rm staff.pem staff-refresh.pem staff.pub.pem

# 3. Subir a infraestrutura (PostgreSQL, MailHog, Valkey e LocalStack), sem o container da API
docker compose up postgres mailhog valkey localstack -d --wait

# 4. Configurar banco (migrate + generate + seed)
npm run db:setup

# 5. Iniciar a aplicação em modo watch
npm run start:dev
```

> **Subiu a stack antes de o compose se chamar `work-order`?** A stack antiga pertence ao projeto `app`, ocupa as mesmas portas e guarda os dados no volume `app_postgres_data`; a nova cria o volume `work-order_postgres_data`, vazio. Antes do passo 3, remova a antiga com `docker compose -p app down -v`, que **apaga os dados locais dela** (inclusive os de outro serviço que também tenha subido como projeto `app`), e rode o passo 4 de novo.

Após a inicialização:

- **API:** `http://localhost:3000`
- **Swagger:** `http://localhost:3000/api/docs`
- **MailHog (interface web):** `http://localhost:8025`
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

# Autenticação de funcionário (RS256; as três chaves vêm dos comandos do passo 2)
STAFF_JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
STAFF_JWT_REFRESH_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
STAFF_JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
STAFF_JWT_KEY_ID=staff-local
STAFF_JWT_ISSUER=oficina-identity
STAFF_JWT_AUDIENCE=oficina-services
STAFF_JWT_EXPIRATION=10m
STAFF_JWT_REFRESH_EXPIRATION=7d
BCRYPT_SALT_ROUNDS=12

# Autenticação do Cliente (via função serverless externa)
CUSTOMER_JWT_PUBLIC_KEY=your-rs256-public-key-pem
CUSTOMER_JWT_ISSUER=oficina-customer-auth
CUSTOMER_JWT_AUDIENCE=oficina-api

# CORS — separar múltiplas origens por vírgula
ALLOWED_ORIGINS=http://localhost:3000

# E-mail (MailHog em desenvolvimento)
MAIL_HOST=localhost
MAIL_PORT=1025
MAIL_FROM="Oficina Mecânica <noreply@oficina.local>"

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

`WORK_ORDER_QUEUE_NAME`, `MESSAGING_TOPIC_ARN` e `CACHE_URL` são obrigatórias: sem elas a API não sobe. `CACHE_TTL_SECONDS` é opcional, mas um valor que não seja inteiro maior que zero também impede o boot, porque faria toda gravação no cache falhar. No cluster, o CD monta o ARN do tópico com a conta da AWS e o `CACHE_URL` usa `rediss://` com a senha do ElastiCache.

### Chaves do token de funcionário

Os comandos do passo 2 geram dois pares RSA de 2048 bits com `openssl` (um para o access, outro para o refresh) e acrescentam ao `.env` `STAFF_JWT_PRIVATE_KEY`, `STAFF_JWT_REFRESH_PRIVATE_KEY` e `STAFF_JWT_PUBLIC_KEY`, cada PEM numa linha só, entre aspas e com `\n` literal; o `STAFF_JWT_KEY_ID=staff-local` já vem do `.env.example`. Os arquivos `.pem` são apagados no fim e o `.gitignore` ignora `*.pem` e o `.env`. Para trocar as chaves, apague as três linhas do `.env` e rode os comandos de novo; os tokens emitidos antes deixam de valer. Sem essas variáveis, a API não sobe e o `docker compose` para com a mensagem `Gere as chaves RS256 de funcionário conforme docs/local-setup.md`.

> **Atenção**: em produção, as chaves não vêm do `.env`: as privadas vêm de secrets do environment `production` e a pública e o `kid`, de secrets da organização (ver [Segurança › Chaves do token de funcionário](security.md#chaves-do-token-de-funcionário)). O `CUSTOMER_JWT_PUBLIC_KEY` padrão do `docker-compose.yml` é só um placeholder.

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

O seed cria 4 usuários Admin com senha padrão `Tech@2026`:

| Nome | E-mail | Senha |
|------|--------|-------|
| Guilherme da Rocha Salvador | `guilhermedarochasalvador@gmail.com` | `Tech@2026` |
| Lucas Almeida da Silva | `lucas.almeida-silva@hotmail.com` | `Tech@2026` |
| Ramoon Lincoln Barros Camacho | `ramooncamacho@hotmail.com` | `Tech@2026` |
| Renan Santana Camacho | `camacho.renan@gmail.com` | `Tech@2026` |

Use qualquer um desses e-mails com a senha `Tech@2026` no endpoint `POST /api/auth/login` para autenticar e obter o token JWT.

O seed também cria dois usuários do fluxo **externo** (Cliente da Oficina, `role: null`, com CPF) e já vincula cada um a um cliente ativo — para testar `/api/me/*` sem precisar cadastrar nada manualmente:

| CPF | Usuário | Cliente vinculado |
|---|---|---|
| `12345678909` | `joao.silva@email.com` | João da Silva — pessoa física (INDIVIDUAL) |
| `98765432100` | `maria.souza@email.com` | Oficina Parceira LTDA — empresa (COMPANY) |

Ambos com senha `Tech@2026`. Esse CPF + senha é o que se informa na [`oficina-mecanica-lambda-customer-auth`](https://github.com/FIAP-15SOAT/oficina-mecanica-lambda-customer-auth) para obter um `customer-jwt` válido contra este seed.

Os scripts de seed em `prisma/seeds/` são executados em ordem pelo entrypoint `prisma/seed.ts`: `work-order-status-info.seed.ts` (tabela de referência de prioridade dos status de OS), depois `user.seed.ts`, `part-supply.seed.ts`, `service.seed.ts`, `customer.seed.ts`, `user-customer.seed.ts` (os vínculos da tabela acima), `vehicle.seed.ts` e `work-order.seed.ts`. Eles populam dados de referência para acelerar o onboarding e os testes manuais. Todos são idempotentes (`upsert`), então podem rodar a cada deploy sem duplicar registros.

Usuários, clientes, veículos, serviços e peças nascem com **UUIDs fixos**, os mesmos em todos os serviços da oficina, para que as referências entre serviços casem desde o primeiro deploy. A lista canônica está em [Ids canônicos do seed](seed-ids.md).
