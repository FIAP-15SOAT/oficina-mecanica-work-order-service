# 🔌 Referência da API

> A fonte viva do contrato é o **Swagger** em `http://localhost:3000/api/docs` (spec em `/api/docs-json`). Esta página é o resumo legível dos endpoints.

## Índice

- [Endpoints disponíveis](#endpoints-disponíveis)
  - [Rotas no Identity](#rotas-no-identity)
- [Rotas internas (`/internal`)](#rotas-internas-internal)
- [Dados de exibição dos itens](#dados-de-exibição-dos-itens)
- [Usuários lidos no Identity](#usuários-lidos-no-identity)
- [Formato de resposta](#formato-de-resposta)
  - [Exceção: as rotas de saúde](#exceção-as-rotas-de-saúde)

Após iniciar a aplicação:

- **Swagger:** `http://localhost:3000/api/docs`
- **Base URL:** `http://localhost:3000/api`

Toda rota exige o header `Authorization: Bearer <token>` (access token), salvo as marcadas como públicas. A autenticação é negada por padrão: um guard global exige o token de funcionário em toda rota sem marcação, `@Public()` dispensa o token e `@CustomerArea()` troca o token exigido pelo do Cliente da Oficina (ver [Perfis de usuário (RBAC)](architecture.md#perfis-de-usuário-rbac)). Um token de cliente numa rota de funcionário responde **401**.

Os tokens de funcionário são emitidos pelo Identity, o serviço da solução dono dos usuários e das credenciais, em `POST /api/auth/login` e renovados em `POST /api/auth/refresh` (ver [Rotas no Identity](#rotas-no-identity)). Este serviço só valida o access token, com a chave pública: um JWT **RS256** com `kid` no cabeçalho e as claims `sub`, `email`, `name`, `role`, `typ = access`, `iss = oficina-identity`, `aud = oficina-services`, `iat` e `exp`, válido por **10 minutos**. Uma rota de funcionário responde **401** com `Token de autenticação inválido ou ausente` a um token HS256 ou sem assinatura, sem `kid` ou com outro `kid`, assinado por outra chave, com `iss` ou `aud` diferentes (como o token de cliente), com `typ` diferente de `access` (como o refresh), expirado ou sem `exp`, ou sem um `sub` UUID, um `email` ou um `role` conhecido. O usuário não é relido: o token de um funcionário desativado ou que trocou a senha continua aceito até expirar (ver [Segurança](security.md#janelas-de-revogação-aceitas)).

## Endpoints disponíveis

---

### Rotas no Identity

O login, o refresh, a redefinição de senha, o cadastro de usuários, o perfil e a troca da própria senha são do Identity, o serviço da solução dono dos usuários e das credenciais ([`oficina-mecanica-identity-service`](https://github.com/FIAP-15SOAT/oficina-mecanica-identity-service), que documenta o contrato delas). Pelo API Gateway, essas rotas chegam ao Identity; este serviço não as tem.

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/login` | Login do funcionário: devolve o access token, o refresh token e o usuário |
| POST | `/api/auth/refresh` | Troca um refresh token válido por um par novo |
| POST | `/api/auth/password-reset-confirmations` | Confirma o código de redefinição de senha e grava a senha nova |
| POST, GET, PUT, PATCH, DELETE | `/api/users`, `/api/users/:id` | Cadastro, consulta, edição, ativação e exclusão de funcionários, só pelo `ADMIN` |
| POST | `/api/users/:userId/password-resets` | Gera um código de redefinição de senha e o envia por e-mail |
| GET | `/api/me` | Perfil do usuário do token (funcionário ou cliente), com as empresas que ele representa, lidas aqui em `GET /internal/users/:userId/customers` |
| PATCH | `/api/me/password` | Troca a própria senha (funcionário ou cliente) |

`GET /api/users/:userId/customers` continua neste serviço (ver **Acesso Externo de Clientes** abaixo), porque os vínculos são daqui.

---

**Métricas de Serviços** (`/api/services/:id/metrics`, `/api/services-metrics`) — *ADMIN*

| Método | Rota | Descrição | Perfis |
|---|---|---|---|
| GET | `/api/services/:id/metrics` | Métricas de um serviço: execuções concluídas e tempo médio em minutos. `404` quando o Inventory não conhece o serviço | ADMIN |
| GET | `/api/services-metrics` | Métricas dos serviços já executados (paginado), ordenadas pelo nome | ADMIN |

> As métricas contam os itens de OS concluídos, com início e fim registrados (`work_order_services` com status `COMPLETED`), e o nome do serviço (`serviceName`) é lido no Inventory a cada requisição. A lista traz só os serviços já executados; um serviço que o Inventory não acha mais aparece com `serviceName` nulo, no fim da lista. Na rota de um serviço, `averageTimeMinutes` sai `0`, não nulo, quando ele ainda não tem execução concluída. Com o Inventory fora do ar, as duas rotas respondem **503**.

> **Catálogo e estoque ficam no Inventory.** O cadastro de serviços (`/api/services`), de peças e insumos (`/api/parts-supplies`) e as consultas de estoque (`/api/stock-movements`, `/api/stock-reservations`) são do Inventory, o serviço da solução dono do catálogo e do estoque ([`oficina-mecanica-inventory-service`](https://github.com/FIAP-15SOAT/oficina-mecanica-inventory-service)). Pelo API Gateway, essas rotas chegam ao Inventory; só as duas rotas de métricas acima chegam a este serviço. As OS guardam de cada item só o id, a quantidade e o preço, e leem os dados de exibição no Inventory a cada leitura (ver [Dados de exibição dos itens](#dados-de-exibição-dos-itens)).

---

**Clientes** (`/api/customers`) — *ADMIN, ATTENDANT*

| Método | Rota | Descrição | Perfis |
|---|---|---|---|
| POST | `/` | Cadastrar cliente (CPF ou CNPJ, endereço obrigatório). Aceita `createAccess?: boolean` — concede acesso externo automaticamente reaproveitando o caso de uso de `POST /customers/:id/users`. Default: `true` para `INDIVIDUAL`, sempre `false` para `COMPANY` (`createAccess: true` com `COMPANY` é rejeitado com **409**). Com o acesso, o usuário é pedido ao Identity antes de gravar o cliente: a recusa do Identity (**409** ou **422**) chega com a mensagem dele, e o Identity fora do ar responde **503**, sem cliente gravado | ADMIN, ATTENDANT |
| GET | `/` | Listar (paginado; filtros: `name`, `type`, `document`) | ADMIN, ATTENDANT |
| GET | `/:id` | Buscar por ID | ADMIN, ATTENDANT |
| GET | `/:id/vehicles` | Listar veículos do cliente | ADMIN, ATTENDANT |
| PUT | `/:id` | Atualizar dados (incluindo endereço) | ADMIN, ATTENDANT |
| DELETE | `/:id` | Remover (bloqueado se houver veículos vinculados) | ADMIN, ATTENDANT |

---

**Acesso Externo de Clientes** (`/api/customers/:customerId/users`, `/api/users/:userId/customers`) — *ADMIN, ATTENDANT*

| Método | Rota | Descrição | Perfis |
|---|---|---|---|
| POST | `/customers/:customerId/users` | Conceder acesso externo a um cliente. Para `Customer.type = INDIVIDUAL`, vincula o próprio cliente (usa nome, CPF e e-mail do cadastro); para `COMPANY`, exige `name` + `email` + `cpf` do operador que vai representar a empresa. O usuário de acesso fica no Identity: este serviço pede a ele o usuário pelo CPF, que **reaproveita** a conta que já existe (mesma pessoa física, sem senha inicial e sem alterar nome, e-mail ou papel) ou cria uma nova e envia a senha inicial por e-mail, e só então grava o vínculo. A resposta `201` traz `{ user, customer, initialPasswordSent }` (ver [Usuários lidos no Identity](#usuários-lidos-no-identity)) | ADMIN, ATTENDANT |
| GET | `/customers/:customerId/users` | Listar os usuários com acesso a um cliente, cada um como `{ id, name, email, role, isActive }`. Um usuário vinculado que o Identity não conhece mais fica fora da lista | ADMIN, ATTENDANT |
| DELETE | `/customers/:customerId/users/:userId` | Revogar o vínculo de um usuário com um cliente — efeito imediato, sem lista de revogação de token | ADMIN, ATTENDANT |
| PATCH | `/customers/:customerId` | Ativar (`isActive: true`) ou desativar (`isActive: false`) um cliente. Cliente inativo perde acesso a `/api/me/*` imediatamente | ADMIN, ATTENDANT |
| GET | `/users/:userId/customers` | Listar os clientes vinculados a um usuário, cada um como `{ id, name, type, isActive }`. Usuário que o Identity não conhece responde **404** com `Usuário não encontrado(a) com identificador: <id>` | ADMIN, ATTENDANT |

> **Respostas da concessão de acesso.** Cliente inexistente responde **404**; cliente inativo, **409** `Cliente inativo não pode receber novos acessos`; `COMPANY` sem os três dados do operador, **409** `Nome, e-mail e CPF são obrigatórios para conceder acesso a um cliente do tipo COMPANY`; vínculo que já existe, **409** `Usuário já possui acesso a este cliente`. Quando o Identity recusa o usuário, a resposta traz o status e a mensagem dele: **409** `O e-mail informado já pertence a outro usuário. Verifique o cadastro do cliente` quando o e-mail é de outra pessoa, ou **422** `CPF inválido`; nada é gravado, e a concessão pode ser repetida depois de corrigir o cadastro. Com o Identity fora do ar, **503** `Serviço de destino indisponível`, sem nada gravado. Se o Identity criou o usuário e a gravação do vínculo falhou, repetir a concessão reaproveita o mesmo usuário pelo CPF.
>
> Ver [Identidade externa, autenticação e autorização por vínculo](architecture.md#identidade-externa-autenticação-e-autorização-por-vínculo) para o modelo de usuário, `Customer` e `UserCustomer`.

---

**Veículos** (`/api/vehicles`) — *ADMIN, ATTENDANT*

| Método | Rota | Descrição | Perfis |
|---|---|---|---|
| POST | `/` | Cadastrar veículo (placa `ABC-1234` ou Mercosul `ABC1D23`) | ADMIN, ATTENDANT |
| GET | `/` | Listar (paginado; filtros: `plate`, `brand`, `customerId`) | ADMIN, ATTENDANT |
| GET | `/:id` | Buscar por ID (retorna cliente aninhado) | ADMIN, ATTENDANT |
| PUT | `/:id` | Atualizar dados (placa normalizada para maiúsculas e sem hífen) | ADMIN, ATTENDANT |
| DELETE | `/:id` | Remover (bloqueado se houver ordens de serviço vinculadas) | ADMIN, ATTENDANT |

---

**Ordens de Serviço** (`/api/work-orders`) — *ADMIN, MECHANIC, ATTENDANT*

| Método | Rota | Descrição | Perfis |
|---|---|---|---|
| POST | `/` | Criar nova OS (`userId` extraído do JWT, número gerado por sequence). Aceita opcionalmente `services` e `partsSupplies`: com algum item, o orçamento inicial `PENDING` é criado no Billing antes de gravar a OS (ver [Abertura da OS com orçamento inicial](#abertura-da-os-com-orçamento-inicial)) | ADMIN, ATTENDANT |
| GET | `/` | Listar (paginado; filtros: `number`, `status`, `customerId`, `vehicleId`, `assignedUserId`; ordenação: `sort`). **Por padrão, ordens em `COMPLETED`, `DELIVERED` e `CANCELLED` são omitidas**; use `?status=X` para recuperá-las. | ADMIN, MECHANIC, ATTENDANT |
| GET | `/:id` | Buscar por ID (retorna serviços e peças/insumos da OS, com os dados de exibição lidos no Inventory) | ADMIN, MECHANIC, ATTENDANT |
| PUT | `/:id` | Atualizar OS (apenas em `RECEIVED` / `IN_DIAGNOSIS`; `userId` extraído do JWT) | ADMIN, MECHANIC, ATTENDANT |
| PATCH | `/:id` | Atualizar status da OS (apenas `IN_DIAGNOSIS`, `CANCELLED`, `DELIVERED`; qualquer outro status, `AWAITING_PAYMENT` inclusive, responde **400** na validação). O cancelamento responde **409** enquanto a aprovação de um orçamento está em andamento (ver [Como o orçamento muda a OS](#como-o-orçamento-muda-a-os)); a entrega exige saldo zero no Billing (ver [Entrega com saldo zero](#entrega-com-saldo-zero)); com a OS em `AWAITING_PAYMENT`, entrega e cancelamento respondem **409** (ver [Como a cobrança muda a OS](#como-a-cobrança-muda-a-os)) | ADMIN, MECHANIC, ATTENDANT |
| PATCH | `/:workOrderId/services/:serviceId` | Atualizar status de um serviço da OS (`IN_PROGRESS` / `COMPLETED`). O primeiro serviço iniciado leva a OS a `IN_PROGRESS` e, se ela tem peças, pede ao Inventory a baixa do estoque reservado. Com a OS em `AWAITING_PAYMENT`, iniciar e concluir serviço respondem **409** | ADMIN, MECHANIC, ATTENDANT |
| GET | `/:id/status-history` | Histórico de mudanças de status | ADMIN, MECHANIC, ATTENDANT |

> Demais transições (`AWAITING_APPROVAL`, `APPROVED`, `REJECTED`, `AWAITING_PAYMENT`, `IN_PROGRESS`, `COMPLETED`) são derivadas automaticamente das mensagens de orçamento e de cobrança publicadas pelo Billing e dos status de serviço — veja [Ciclo de vida da Ordem de Serviço](./architecture.md#ciclo-de-vida-da-ordem-de-serviço).

> **Ordenação (`sort`)**: critérios no formato `campo:direção` separados por vírgula (ex.: `?sort=status:desc,createdAt:asc`). Campos permitidos: `status` e `createdAt`; direção `asc` ou `desc`. Padrão: `status:desc,createdAt:asc`. Ao ordenar por `status`, usa-se a **prioridade de negócio** da tabela `WorkOrderStatusInfo`, não a ordem alfabética: `RECEIVED` 1, `IN_DIAGNOSIS` 2, `AWAITING_APPROVAL` 3, `REJECTED` 4, `APPROVED` 5, `AWAITING_PAYMENT` 6, `IN_PROGRESS` 7, `COMPLETED` 8, `DELIVERED` 9 e `CANCELLED` 10. A listagem padrão (sem `status`) mostra, nessa ordem, `IN_PROGRESS`, `AWAITING_PAYMENT`, `APPROVED`, `REJECTED`, `AWAITING_APPROVAL`, `IN_DIAGNOSIS` e `RECEIVED`.

---

**Orçamentos** — no Billing

Os orçamentos são do **Billing**, o serviço da solução dono dos orçamentos e dos pagamentos ([`oficina-mecanica-billing-service`](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service)). Este serviço não guarda orçamento: pelo API Gateway, `/api/quotes` (criação, itens, envio, aprovação e rejeição pelo funcionário) e `GET /api/work-orders/:id/quotes` (orçamentos de uma OS) chegam ao Billing, e a referência dessas rotas está na [API do Billing](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/api.md). Este serviço abre a OS com o orçamento inicial, serve a área do cliente (ver **Minha Conta** abaixo) e reage às mensagens que o Billing publica quando um orçamento muda de status.

#### Abertura da OS com orçamento inicial

Com algum item em `services` ou `partsSupplies`, `POST /api/work-orders` valida cliente, veículo e mecânico, cria o orçamento inicial no Billing (`POST /internal/quotes`) e só então grava a OS. O Billing valida e precifica os itens no Inventory, e a recusa dele volta como está, sem nada gravado aqui e sem consumir número de OS:

| Situação | Resposta |
|---|---|
| Peças sem nenhum serviço, ou item repetido | **409** do Billing |
| Id de serviço ou peça que o Inventory não conhece | **404** do Billing |
| Billing ou Inventory fora do ar, ou sem resposta em 5 s | **503** |
| Falha ao gravar a OS depois de o orçamento ser criado | O orçamento é apagado no Billing (`DELETE /internal/quotes/:id`) e o erro da gravação volta ao chamador; se a exclusão também falhar, o orçamento sem OS fica só registrado no log (`work_order.opening.compensation_failed`) |

Sem itens, a OS é aberta sem orçamento e sem chamar o Billing.

#### Como o orçamento muda a OS

| O que acontece no Billing | Efeito na OS |
|---|---|
| Orçamento enviado ao cliente | A OS vai de `IN_DIAGNOSIS` ou `REJECTED` a `AWAITING_APPROVAL` (se já aguarda, fica) e o cliente recebe o e-mail com os itens e o total. A rota de envio no Billing não espera o e-mail: uma falha no envio do e-mail não desfaz o envio do orçamento nem responde 503. Uma OS cancelada antes de a mensagem chegar não muda, e nenhum e-mail sai |
| Orçamento rejeitado | A OS vai a `REJECTED` só quando nenhum outro orçamento dela continua enviado; havendo, ela segue em `AWAITING_APPROVAL` |
| Orçamento aprovado | Começa a aprovação descrita abaixo |

**Aprovação e reserva de estoque.** A aprovação (pelo funcionário, no Billing, ou pela decisão do cliente em `POST /me/quotes/:quoteId/decisions`) responde **200** com o orçamento `APPROVED`, e a OS muda segundos depois, quando chega a mensagem do Billing. Sem peças, a OS vai a `APPROVED` com os itens do orçamento. Com peças, a OS continua `AWAITING_APPROVAL` até o Inventory confirmar a reserva do estoque; confirmada a reserva, a OS vai a `APPROVED` com os itens e o total do orçamento. Se falta estoque, a aprovação é desfeita no Billing: o orçamento volta a `SENT`, os orçamentos rejeitados por ela voltam ao status anterior, o histórico da OS registra `Aprovação do orçamento <id> desfeita por falta de estoque` e o cliente recebe um e-mail avisando que o orçamento voltou a aguardar aprovação e pode ser aprovado de novo quando o estoque for reposto. Se a OS foi cancelada entre a aprovação e a chegada da mensagem, o orçamento vai a `REJECTED` e o histórico registra `Aprovação do orçamento <id> desfeita: a Ordem de Serviço não aguardava aprovação`, sem e-mail.

Enquanto a aprovação está em andamento (reserva do estoque ou reversão no Billing), cancelar a OS e decidir um orçamento pela área do cliente respondem **409** `Ordem de serviço com aprovação de orçamento em andamento: aguarde a conclusão e tente novamente`. Criar, enviar ou aprovar outro orçamento da mesma OS é recusado pelo Billing (**409**), porque a OS já tem um orçamento aprovado. O fluxo completo está em [Fluxo do orçamento, do envio à aprovação](architecture.md#fluxo-do-orçamento-do-envio-à-aprovação).

---

**Cobranças** — no Billing

As cobranças também são do Billing: pelo API Gateway, `/api/payments` (criação de uma cobrança de uma OS em `APPROVED` ou `COMPLETED`, consulta e cancelamento pelo funcionário) chega a ele, e a referência dessas rotas está na [API do Billing](https://github.com/FIAP-15SOAT/oficina-mecanica-billing-service/blob/main/docs/api.md). O Billing cria a ordem de pagamento no Mercado Pago, o provedor de pagamento da solução, e avisa este serviço por mensagem.

#### Como a cobrança muda a OS

| O que acontece no Billing | Efeito na OS |
|---|---|
| Cobrança criada com a OS em `APPROVED` (sinal) ou `COMPLETED` (restante) | A OS vai a `AWAITING_PAYMENT` segundos depois, o histórico registra `Aguardando o pagamento da cobrança <id>` e o cliente recebe o e-mail `Pagamento da Ordem de Serviço <número>`, com o valor, o link de pagamento e a validade. Uma falha no e-mail não desfaz o bloqueio |
| Cobrança criada, mas a OS mudou antes de a mensagem chegar (o mecânico iniciou a execução, por exemplo) | A OS não muda, nenhum e-mail sai e este serviço pede ao Billing o cancelamento da cobrança |
| Cobrança paga | A OS volta ao status de antes (`APPROVED` ou `COMPLETED`), com as datas da aprovação e da conclusão preservadas, e o histórico registra `Cobrança <id> paga` |
| Cobrança expirada, recusada pelo Mercado Pago ou cancelada pelo funcionário | A OS volta ao status de antes, e o histórico registra `Cobrança <id> expirada`, `recusada` ou `cancelada` |

Enquanto a OS está em `AWAITING_PAYMENT`, iniciar serviço, entregar e cancelar respondem **409** `Ordem de serviço aguardando pagamento: execução, entrega e cancelamento voltam a valer quando a cobrança for paga, expirar ou for cancelada`; concluir serviço responde o **409** do item, que não está em execução. Para liberar uma OS presa nesse status, o funcionário cancela a cobrança no Billing (`POST /api/payments/:id/cancellations`). O fluxo completo está em [Saga de cobrança](architecture.md#saga-de-cobrança).

#### Entrega com saldo zero

`PATCH /api/work-orders/:id` com `DELIVERED` consulta o saldo da OS no Billing (`GET /internal/work-orders/:workOrderId/balance`) só quando a OS está em `COMPLETED`:

| Situação | Resposta |
|---|---|
| Saldo maior que zero | **409** `Ordem de serviço com saldo a pagar de R$ <saldo>: a entrega é liberada depois que o saldo for quitado`; a OS segue em `COMPLETED` |
| Saldo zero ou negativo (pago a mais) | **200**, com a OS em `DELIVERED` |
| Billing fora do ar, sem resposta em 2 s ou com um saldo que não é número (nulo, ausente ou vazio) | **503** `Serviço de destino indisponível`, sem entregar |
| OS fora de `COMPLETED` | **409** da transição recusada, sem consultar o Billing |

---

**Health** (`/api/health`)

| Método | Rota | Descrição | Acesso |
|---|---|---|---|
| GET | `/live` | Vivacidade — não executa I/O algum. Alvo do `startupProbe` e do `livenessProbe` | Público |
| GET | `/ready` | Prontidão — verifica o PostgreSQL (`SELECT 1`, com prazo próprio) e o estado de encerramento. Alvo do `readinessProbe` | Público |

> **Estas duas rotas não usam o envelope `{ data }`** — é a única divergência deliberada do formato descrito abaixo. Ver [Formato de resposta › Exceção](#exceção-as-rotas-de-saúde).
>
> A decisão é comunicada pelo **status HTTP**: `200` saudável, `503` indisponível. O corpo é mínimo e **idêntico para toda causa de falha** — `{"status":"ok"}` ou `{"status":"unavailable"}` —, e ambos respondem com `Cache-Control: no-store`. Um consumidor decide lendo apenas o status; ignorar o corpo não altera o resultado.
>
> São **públicas por requisito**: um orquestrador não porta credencial de aplicação, e condicionar as probes a um token tornaria a saúde indisponível justamente quando a autenticação estiver comprometida. O Service é `NodePort`, sem Ingress público, e o único caminho externo é API Gateway → VPC Link → NLB interno → NodePort. Como o Gateway publica `ANY /api/{proxy+}`, a proteção dessas rotas é o corpo mínimo e sem detalhes operacionais, não uma credencial. Detalhes da postura em [Segurança](security.md#endpoints-de-saúde-públicos-e-não-autenticados).
>
> `/live` **não tem** o desfecho `503`: ele não verifica dependência alguma. Com o banco fora, `/live` continua `200` e só `/ready` responde `503` — a instância está viva, apenas não consegue atender. Como o PostgreSQL é **compartilhado por todas as réplicas**, uma indisponibilidade dele deixa o Service sem endpoints em vez de desviar tráfego; isso é comportamento esperado, não defeito. O valor da readiness está na falha **por-réplica** (pool travado numa instância) e no encerramento gracioso.

---

**Minha Conta** (`/api/me`) — Cliente da Oficina (usuário externo)

| Método | Rota | Descrição | Acesso |
|---|---|---|---|
| GET | `/work-orders` | Listar ordens de serviço dos clientes vinculados ao usuário autenticado (paginado; filtro opcional `customerId`). Cada item traz `customer: { id, name, type }` — necessário para quem representa mais de uma empresa distinguir a qual cliente cada ordem pertence | `customer-jwt` |
| GET | `/work-orders/:workOrderId` | Detalhe de uma ordem de serviço vinculada, incluindo `customer: { id, name, type }` | `customer-jwt` |
| GET | `/work-orders/:workOrderId/quotes` | Orçamentos de uma ordem de serviço vinculada, sem itens, lidos no Billing | `customer-jwt` |
| GET | `/quotes/:quoteId` | Orçamento e itens de uma ordem vinculada, lidos no Billing | `customer-jwt` |
| POST | `/quotes/:quoteId/decisions` | Aprovar (`{ "action": "approve" }`) ou rejeitar (`{ "action": "reject", "reason": "..." }`) um orçamento vinculado; a decisão é repassada ao Billing | `customer-jwt` |
| GET | `/work-orders/:workOrderId/payments` | Cobranças de uma ordem de serviço vinculada, lidas no Billing: `id`, `amount`, `status` (`PENDING`, `APPROVED`, `EXPIRED`, `CANCELLED` ou `REJECTED`), `checkoutUrl` (o link de pagamento), `expiresAt`, `createdAt` e `updatedAt`, no envelope `{ data: [...] }` | `customer-jwt` |

> O perfil (`GET /api/me`) e a troca da própria senha (`PATCH /api/me/password`) ficam no Identity (ver [Rotas no Identity](#rotas-no-identity)); aqui ficam as rotas de ordens e orçamentos do cliente.

> O token `customer-jwt` (RS256) é emitido por uma **função serverless externa** a esta aplicação, após autenticar o Cliente da Oficina por CPF + senha — a API só verifica a assinatura com `CUSTOMER_JWT_PUBLIC_KEY`. Toda rota `/api/me/*` que aponta a um recurso específico (`workOrderId`/`quoteId`) resolve a autorização **por vínculo** a cada requisição, consultando `UserCustomer` no banco — o token nunca carrega `customerId`. Um recurso inexistente e um recurso de um cliente não vinculado respondem igualmente **404** (nunca 403), para não virar oráculo de enumeração. Ver [Identidade externa, autenticação e autorização por vínculo](architecture.md#identidade-externa-autenticação-e-autorização-por-vínculo).

> **Orçamentos na área do cliente.** Os orçamentos vêm do Billing, e o corpo é o que ele devolve, no envelope `{ data }`. A listagem confere o vínculo com a OS antes de ler o Billing. O detalhe e a decisão partem do `quoteId`, e só o Billing sabe a qual OS o orçamento pertence, então o orçamento é lido no Billing antes; sem vínculo com a OS dele, a resposta é **404** e nada do orçamento é devolvido nem repassado. Antes de repassar a decisão ao Billing, a rota confere ainda:
>
> | Situação | Resposta |
> |---|---|
> | OS fora de `AWAITING_APPROVAL` | **409** `Orçamento só pode ser decidido com a Ordem de Serviço aguardando aprovação. Status atual: "<status>"` |
> | Aprovação de outro orçamento da OS em andamento | **409** `Ordem de serviço com aprovação de orçamento em andamento: aguarde a conclusão e tente novamente` |
> | Orçamento que deixou de estar `SENT` (decisão concorrente, por exemplo) | **409** do Billing, com a mensagem dele |
> | Billing ou Inventory fora do ar, ou sem resposta (5 s no detalhe e na decisão, 2 s na listagem) | **503**; numa decisão, nada é gravado no work-order. Se o Billing gravou a decisão e respondeu depois do prazo, uma nova tentativa recebe **409** |

> **Cobranças na área do cliente.** A rota confere o vínculo com a OS antes de ler o Billing: sem vínculo, a resposta é **404** e o Billing não é consultado. Com o Billing fora do ar ou sem resposta em 2 s, a resposta é **503**.

---

## Rotas internas (`/internal`)

Rotas para os outros serviços da oficina, pela rede do cluster. Ficam **fora do prefixo `/api`** (base `http://localhost:3000/internal`), não passam pelo API Gateway, não pedem token e não aparecem no Swagger.

| Método | Rota | Descrição | Acesso |
|---|---|---|---|
| GET | `/internal/work-orders/:id` | Detalhe da OS, com o mesmo corpo de `GET /api/work-orders/:id`. `400` para id que não é UUID e `404` para OS inexistente | Rede do cluster |
| GET | `/internal/users/:userId/customers` | Diz ao Identity quais clientes o usuário acessa, para o perfil de `GET /api/me`: `200 { data: [{ id, name, type, document, isActive }] }`, só os clientes ativos com vínculo. Usuário sem vínculo responde lista vazia, nunca `404`. `400` para id que não é UUID | Rede do cluster |

O Billing chama a rota da OS para conferir a OS antes de criar, enviar e aprovar um orçamento e antes de criar uma cobrança. O corpo segue o mesmo envelope das rotas públicas. Os contratos ficam em fixtures versionadas em `app/test/contracts/` (`internal-work-order.json` e `internal-user-customers.json`), conferidas pelo e2e (ver [Contrato das rotas `/internal`](testing.md#contrato-das-rotas-internal)); detalhes do cliente HTTP das chamadas entre serviços em [Chamadas internas](architecture.md#chamadas-internas).

---

## Dados de exibição dos itens

Os itens da OS guardam o id do serviço ou da peça, a quantidade e o preço. Os dados de exibição (nome e descrição do serviço; nome, descrição, SKU, número de peça, categoria e unidade da peça) são lidos no Inventory a cada resposta que mostra itens: o detalhe da OS (e as rotas que o devolvem: criação, edição, mudança de status e `GET /internal/work-orders/:id`) e o item da rota de execução de serviço. A lista de OS mostra só o resumo e não consulta o Inventory. Os itens dos orçamentos em `/api/me` chegam do Billing já com os dados de exibição, que ele lê no Inventory.

- Um item que o Inventory não acha mais aparece com id, quantidade e preço e os campos de exibição nulos.
- Com o Inventory fora do ar, essas rotas respondem **503**. As que gravam e mostram itens (mudança de status e execução de serviço) leem o catálogo antes de gravar, então o 503 sai sem nada gravado.

---

## Usuários lidos no Identity

A OS, o histórico e os vínculos guardam só o id do usuário. O nome, o e-mail e o papel são lidos no Identity, por `GET /internal/users/:id`, a cada resposta que os mostra: o mecânico atribuído (`assignedUser`) no detalhe e na lista de OS, nas rotas que devolvem a OS, o autor de cada entrada do histórico (`changedBy`) e os usuários com acesso a um cliente. O formato do mecânico e do autor é o mesmo de antes, `{ id, name, email, role }`.

- Um usuário que o Identity não conhece mais aparece como `null` (`assignedUser` e `changedBy`) ou fica fora da lista de usuários de um cliente.
- O usuário com acesso a um cliente, em `GET /api/customers/:customerId/users` e na resposta de `POST /api/customers/:customerId/users`, sai no formato que o Identity devolve, `{ id, name, email, role, isActive }`, **sem `createdAt` e `updatedAt`**, que essas duas rotas traziam quando o usuário era deste serviço. `role` é `null` para o usuário de acesso de um cliente.
- Com o Identity fora do ar, sem resposta em 2 segundos, com erro 5xx ou com uma resposta fora do contrato, essas rotas respondem **503** com `Serviço de destino indisponível`. As que gravam (abrir e editar a OS com mecânico, mudar o status da OS e conceder acesso) leem o Identity antes de gravar, então o 503 sai sem nada gravado.
- Abrir ou editar uma OS com `assignedUserId` confere o usuário no Identity: usuário desconhecido responde **404** `Usuário não encontrado(a) com identificador: <id>`, e usuário que não é `MECHANIC` ou está desativado responde **409** `Apenas mecânicos ativos podem ser atribuídos a uma ordem de serviço`.
- Os e-mails do orçamento enviado e do link de pagamento vão aos usuários ativos vinculados ao cliente, lidos no Identity quando chega a mensagem do Billing (`billing.quote.sent` ou `billing.payment.requested`); sem usuário ativo vinculado, vão ao e-mail do cadastro do cliente. Com o Identity fora do ar, a mensagem falha sem nada gravado e volta à fila, até ir para a DLQ (a fila de mensagens mortas) na quinta entrega.

---

## Formato de resposta

Recurso único — envolto em `{ data: ... }`:

```json
{ "data": { "id": "...", "name": "..." } }
```

Lista paginada — envolto em `{ data: [...], pagination: { ... } }`:

```json
{
  "data": [{ "id": "...", "name": "..." }],
  "pagination": {
    "totalRecords": 42,
    "totalPages": 5,
    "page": 1,
    "limit": 10
  }
}
```

`page` (default `1`, mínimo `1`) e `limit` (default `10`, mínimo `1`, máximo `100`) são padronizados no `PaginationDto` e aplicáveis a todos os endpoints paginados.

### Exceção: as rotas de saúde

`GET /api/health/live` e `GET /api/health/ready` **não** usam o envelope acima. O corpo é fixo e mínimo:

```json
{ "status": "ok" }
```

```json
{ "status": "unavailable" }
```

O motivo é a postura de segurança de um endpoint público: o corpo não pode divulgar host, porta, cadeia de conexão, mensagem ou código do driver, stack trace, versão nem identificação da instância — e precisa ser **indistinguível** entre causas de falha, senão vira canal de reconhecimento. Um envelope `{ data }` acrescentaria estrutura sem acrescentar informação, e a decisão do orquestrador se toma pelo status. O diagnóstico da causa vive no log, que já é redigido e limitado: a categoria (`timeout | connection | pool | authentication | query | unknown`) sai no evento de transição `health.degraded`.

A divergência é declarada aqui de propósito, para que o contrato universal desta seção não passe a ser contrariado em silêncio.

Erros seguem o padrão NestJS com mensagens em português:

```json
{ "statusCode": 404, "error": "Not Found", "message": "Recurso não encontrado" }
```

Conflitos de concorrência otimista retornam **409 Conflict** com mensagem orientando nova tentativa:

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "Ordem de serviço foi modificada por outra operação. Tente novamente."
}
```

Todas as datas são serializadas em ISO 8601 com fuso horário via `DateSerializerInterceptor` (global).
