# 💻 Como executar localmente

Setup local (API na máquina, infra no Docker), variáveis de ambiente e dados de seed. Para subir tudo em containers com um comando, veja o Quick Start no [README](../README.md).

## Índice

- [Setup local](#setup-local)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Seed](#seed)

## Setup local

Neste modo a API roda diretamente na sua máquina com `npm run start:dev`, enquanto apenas a infraestrutura (PostgreSQL e MailHog) é provida via Docker.

### MailHog

O MailHog é um servidor SMTP de desenvolvimento que captura todos os e-mails enviados pela aplicação (ex.: links de aprovação de orçamentos) sem entregá-los de verdade. Acesse a caixa de entrada em `http://localhost:8025` após subir os serviços de infraestrutura.

As variáveis de ambiente necessárias para integração com o MailHog já estão pré-configuradas no `.env.example`:

```env
MAIL_HOST=localhost
MAIL_PORT=1025
MAIL_FROM="Oficina Mecânica <noreply@oficina.local>"
```

### Passo a passo

> Toda a aplicação vive em `app/` (não há `package.json` na raiz). Execute os comandos abaixo — e todos os `npm`/`prisma`/`docker compose` — a partir de `app/`.

```bash
# 1. Entrar na pasta da aplicação e instalar dependências
cd app
npm install

# 2. Copiar e ajustar variáveis de ambiente
cp .env.example .env

# 3. Subir apenas PostgreSQL e MailHog (sem o container da API)
docker compose up postgres mailhog -d

# 4. Configurar banco (migrate + generate + seed)
npm run db:setup

# 5. Iniciar a aplicação em modo watch
npm run start:dev
```

Após a inicialização:

- **API:** `http://localhost:3000`
- **Swagger:** `http://localhost:3000/api/docs`
- **MailHog (interface web):** `http://localhost:8025`

Para executar chamadas à API, use o Swagger em `/api/docs` ou importe a collection e o environment do Postman (`collections/oficina-collection.json` e `collections/oficina-environment.json`) — o passo a passo está em [Testes › Postman / Newman](testing.md#postman--newman).

## Variáveis de Ambiente

Veja `.env.example` para todas as variáveis disponíveis.

```env
# Aplicação
PORT=3000
NODE_ENV=development
TZ=America/Sao_Paulo

# Banco de dados
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/techchallenge?schema=public

# Autenticação
JWT_SECRET=your-secret-key
JWT_EXPIRATION=15m
JWT_REFRESH_SECRET=your-refresh-secret-key
JWT_REFRESH_EXPIRATION=7d
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

> **Atenção**: em produção, gere segredos fortes para `JWT_SECRET`, `JWT_REFRESH_SECRET` e `CUSTOMER_JWT_PUBLIC_KEY`. Os valores padrão do `docker-compose.yml` são apenas placeholders.

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
