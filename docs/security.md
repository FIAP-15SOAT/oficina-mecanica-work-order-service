# 🔒 Segurança

Mitigações aplicadas no código e índice de relatórios de segurança.

## Índice

- [Relatórios](#relatórios)
- [Mitigações aplicadas no código](#mitigações-aplicadas-no-código)
- [Endpoints de saúde públicos e não autenticados](#endpoints-de-saúde-públicos-e-não-autenticados)
- [Riscos residuais aceitos](#riscos-residuais-aceitos)
- [Proteção de dados nos logs](#proteção-de-dados-nos-logs)

## Relatórios

Relatórios de segurança da aplicação ficam versionados em [`reports/`](../reports). Na raiz de cada ferramenta fica o relatório mais recente, enquanto o histórico é organizado por data no formato `YYYY-MM-DD`.

- **DAST (OWASP ZAP)** — relatórios em [`reports/zap/`](../reports/zap) (HTML e PDF).
- **Qualidade e cobertura (SonarQube)** — relatórios em [`reports/sonarqube/`](../reports/sonarqube) (PDF).
- **Resumo executivo consolidado** — histórico em [`reports/others/`](../reports/others).

## Mitigações aplicadas no código

- Helmet (cabeçalhos de segurança HTTP)
- CORS com lista branca via `ALLOWED_ORIGINS`
- `SanitizeStringsPipe` global (sanitização de inputs em DTOs antes do `ValidationPipe`)
- `ValidationPipe` global com `whitelist: true`, `forbidNonWhitelisted: true` e `transform: true`
- Senhas com bcrypt (`BCRYPT_SALT_ROUNDS`) e regra de força aplicada tanto no DTO quanto no domínio (`User.validatePasswordStrength`)
- JWT com access + refresh token e segredos separados (`JWT_SECRET` / `JWT_REFRESH_SECRET`)
- **Dois verificadores JWT totalmente isolados, nunca um único aceitando os dois algoritmos.** A estratégia interna (`jwt`, HS256, `JWT_SECRET`) autentica funcionários (`ADMIN`/`MECHANIC`/`ATTENDANT`); a estratégia externa (`customer-jwt`, RS256, `CUSTOMER_JWT_PUBLIC_KEY`) autentica o Cliente da Oficina, com token emitido por uma função serverless fora desta aplicação — a API guarda apenas a chave **pública** de verificação, nunca a privada. Um único verificador que aceitasse os dois algoritmos eliminaria por construção a defesa contra confusão de algoritmo (ex.: um atacante forjar um HS256 usando a chave pública RS256 como segredo); mantê-los como duas estratégias Passport distintas torna essa classe de ataque estruturalmente impossível, não apenas mitigada por validação. O token externo não carrega `customerId` nem `role` — apenas `sub` (o `userId`) — e cada rota `/api/me/*` resolve a autorização por vínculo (`UserCustomer`) a cada requisição, o que faz uma revogação de acesso valer imediatamente sem lista de revogação de token. Ver [ADR 0004](./adr/0004-autenticacao-de-clientes.md).
- Concorrência otimista em agregados sensíveis (`WorkOrder`, `Quote`, `PartSupply`) para evitar lost updates
- Filtros de exceção que nunca expõem stack traces ou detalhes do banco para o cliente
- Registro de exceção decidido pelo **status resolvido**, não pelo tipo: um `401` não gera linha de erro nem stack trace, e portanto um scanner não vira tempestade de alertas
- Mensagem de falha unificada em `POST /api/auth/refresh` (`'Refresh token inválido ou expirado'` para token inválido, usuário inexistente e usuário desativado) e em `POST /api/auth/password-reset-confirmations` (`'Código de redefinição inválido ou expirado'` para as cinco causas de falha), eliminando o oráculo de enumeração de usuários
- Falha de envio de e-mail responde sem o endereço do destinatário
- Código de redefinição de senha numérico (6 dígitos), com escopo curto: expira em **10 minutos** e é bloqueado após **5 tentativas** incorretas, emitido apenas por um Admin (`POST /users/:userId/password-resets`) — nunca autoatendido
- **Trocar ou resetar a senha invalida imediatamente todos os access e refresh tokens emitidos antes da troca, sem lista de revogação.** `User.passwordChangedAt` é atualizado no único ponto por onde a senha muda (`User.changePassword()` — usado tanto por `PATCH /api/me/password` quanto pelo reset por código); as três verificações (`JwtStrategy`, `CustomerJwtStrategy`, `RefreshTokenUseCase`) comparam o `iat` do token com esse campo, recarregado do banco a cada requisição, e recusam qualquer token anterior. Nenhuma consulta extra: o `User` já é carregado nos três pontos por outro motivo (checar `isActive`/vínculos).

## Credencial do banco em produção

- A master password pertence ao RDS/Secrets Manager e não é armazenada em GitHub Secret, Variable ou Terraform State corrente.
- `prepare-deploy` do CD lê `AWSCURRENT`, mascara senha, senha percent-encoded, URL e URL em base64 e aplica por stdin um manifesto do Secret `database-credentials`; nenhuma representação sensível segue para argumento de processo, output, artifact ou arquivo renderizado. Máscaras protegem logs, não command lines; base64 não é criptografia.
- `cache-credentials` recebe `CACHE_URL` (`rediss://` com o auth token do ElastiCache) pelo mesmo transporte: token lido do Secrets Manager, URL mascarada e aplicada por stdin.
- `api-secret` contém somente `JWT_SECRET` e `JWT_REFRESH_SECRET`, e `jwt-public-keys` somente `CUSTOMER_JWT_PUBLIC_KEY`, evitando misturar lifecycles.
- O Deployment recebe `DATABASE_URL` e `CACHE_URL` pelos Secrets e o Job só `DATABASE_URL`. SNS e SQS são chamados com o papel do nó. Não há credencial AWS, IRSA, Pod Identity, ESO, CSI/ASCP ou chamada ao Secrets Manager nesses workloads.

O desenho e as alternativas estão no [ADR 0017](./adr/0017-materializacao-da-credencial-do-banco-no-cd.md).

## Riscos residuais aceitos

- **Não há limitação de frequência de requisições** no login interno (`POST /api/auth/login`) nesta entrega — risco preexistente, não introduzido pela autenticação externa de clientes.
- **A força bruta do código de redefinição de senha é limitada, não eliminada**: o espaço de busca é de 6 dígitos numéricos (10⁶ combinações), mas o teto de **5 tentativas em uma janela de 10 minutos**, combinado com a emissão sendo **exclusiva de um Admin** (o cliente nunca autoatende um reset), reduz a superfície a um evento raro e auditável, não a um endpoint público de tentativa livre.
- **Janela entre autorizar e efetivar a decisão de orçamento (`DecideMyQuoteUseCase`).** `CustomerAccessPolicy.assertCustomerAuthorized` roda num `SELECT` que fecha antes de `UpdateQuoteStatusUseCase` abrir sua própria transação para efetivar a aprovação/rejeição — existem alguns milissegundos entre as duas em que nada está bloqueado no banco. Se, exatamente nessa janela, um admin revogar o vínculo (`DELETE /customers/:id/access-users/:userId`) ou desativar o cliente (`PATCH /customers/:id/status`) e essa transação commitar antes, a decisão segue em frente usando uma autorização já revogada — e no caso de aprovação, isso reserva estoque, copia itens para a OS e rejeita os orçamentos irmãos. Aceito porque exige duas ações na mesma janela de milissegundos sobre o mesmo cliente, o vínculo era válido um instante antes (não é acesso indevido, é uma revogação que chegou tarde), fica auditado (o histórico registra quem decidiu), e a correção — `ApproveQuoteUseCase`/`RejectQuoteUseCase` verificarem o vínculo dentro da própria transação — exigiria um parâmetro de autorização opcional atravessando dois casos de uso compartilhados com a rota interna (`PATCH /api/quotes/:id`, de ADMIN/ATTENDANT/MECHANIC, onde não existe vínculo nenhum a verificar), e o Prisma não aninha transações interativas, então não dá para resolver aninhando a checagem na transação já aberta pelo `execute()` de fora. Se um dia virar problema real, o caminho é redesenhar approve/reject para aceitar essa pré-condição opcional — decisão de arquitetura, não conserto de bug.

## Endpoints de saúde públicos e não autenticados

`GET /api/health/live` e `GET /api/health/ready` respondem **sem credencial**, por requisito: um orquestrador não porta credencial de aplicação, e condicionar as probes a um token tornaria a saúde indisponível justamente quando a autenticação estiver comprometida — no momento em que ela é mais necessária. Pelo mesmo motivo, **não existe configuração que desligue os endpoints**: um endpoint de saúde desligável é um endpoint em que o orquestrador não pode confiar.

**A rota é pública também no endpoint externo da solução.** O Service da API é `NodePort`, mas não há Ingress nem balanceador público no cluster: o caminho externo único é API Gateway → VPC Link → NLB interno → NodePort. O Gateway encaminha `ANY /api/{proxy+}`, portanto os health checks não dependem de uma barreira de rede exclusiva. A superfície é limitada pelo corpo invariável, sem detalhes operacionais, por `Cache-Control: no-store` e pela limitação de frequência aplicada no Gateway. `kubectl port-forward` permanece apenas como acesso de diagnóstico.

**O que o corpo deliberadamente não revela.** A resposta é `{"status":"ok"}` ou `{"status":"unavailable"}`, e mais nada. Sem host, porta, cadeia de conexão, credencial, mensagem ou código de erro do driver, stack trace, versão da aplicação ou de biblioteca, ambiente de execução ou identificação da instância. O padrão que a maioria das bibliotecas de health check adota — um corpo detalhado por indicator — vaza exatamente isso: a mensagem de erro do driver PostgreSQL nomeia host e porta (`Can't reach database server at …:5432`), numa rota que responde a qualquer um.

**O corpo é idêntico para toda causa de falha**, e essa uniformidade é a propriedade de segurança: duas indisponibilidades por motivos diferentes produzem respostas indistinguíveis para o chamador, de modo que a rota não vira canal de reconhecimento sobre a topologia interna.

**A causa não se perde — ela muda de lugar.** O diagnóstico vai para o log, que já é redigido e limitado pela cadeia descrita abaixo. O evento de transição `health.degraded` carrega a categoria da falha (`timeout | connection | pool | authentication | query | unknown`), derivada da **forma** do erro — um SQLSTATE ou um código do `libuv`. Para as poucas falhas que o driver entrega sem código, a categoria é escolhida por igualdade exata contra uma allowlist fechada de mensagens constantes; o texto é **chave de consulta**, nunca conteúdo do registro. Em qualquer caminho o resultado é um conjunto fechado, de cardinalidade fixa, e nenhum campo do erro original — host, porta, mensagem — chega ao log.

**A resposta declara `Cache-Control: no-store` nos dois status.** Uma resposta de saúde servida de um cache intermediário informa sobre um estado passado, que é precisamente o estado que a decisão não pode usar.

*Consequência aceita, documentada para não ser diagnosticada como defeito:* como o PostgreSQL é compartilhado por todas as réplicas, uma indisponibilidade dele faz **todas** saírem do balanceamento e o Service ficar sem endpoints, em vez de desviar tráfego. O ganho da readiness está na falha por-réplica e no encerramento gracioso — ver [ADR 0003](./adr/0003-health-checks.md).

## Proteção de dados nos logs

Os logs saem em JSON no stdout e são ingeridos por uma plataforma de terceiros (ver [ADR 0002](./adr/0002-logging-estruturado.md)). Tudo que é registrado passa antes por uma cadeia de sanitização em `infrastructure/logging/redaction/`.

```
valor ─→ classificação da chave (por sequência de tokens)
             ├── SEGREDO → removido por completo
             ├── PESSOAL → máscara que preserva a forma
             └── LIVRE   → mantido ─→ varredura por padrão no texto ─→ emitido
```

### Classificação por sequência de tokens, nunca por substring

Nomes de campo e regras passam pelo **mesmo** tokenizador antes da comparação: normalização Unicode NFKC, caixa baixa e separação nas fronteiras de camelCase, de acrônimo e em **todo** delimitador não alfanumérico — incluindo `_`, `-` e `.`.

O NFKC fecha as variantes de **compatibilidade** — sem ele, `ｐａｓｓｗｏｒｄ` em largura total não casaria com `password`. Ele **não** fecha homóglifo em geral: `password` com `а` cirílico (U+0430) continua sem casar, porque confusáveis não são equivalências de compatibilidade. É resíduo aceito, porque o nome do campo é escolhido por quem envia o payload — o valor exposto é o dele.

```
SEGREDO (sequência contígua, em qualquer posição do nome):
  [password] [token] [secret] [authorization] [credential]
  [api, key] [connection, string]

PESSOAL (sequência que encerra o nome):
  [document] [cpf] [cnpj] [email] [phone] [zip, code] [cep]
  [street] [address] [plate] [name]
```

A correspondência é **assimétrica, de propósito**: uma sequência de segredo casa em qualquer posição (falha fechada); uma sequência de dado pessoal precisa encerrar o nome, para que um objeto com prefixo sensível não varra todo campo abaixo dele. **Segredo tem precedência sobre pessoal.**

**Qualificadores neutros no fim são removidos antes do teste de sufixo** — hoje `number`, `value` e `str`. Sem isso a regra de sufixo terminal caía justamente nos nomes mais prováveis: `phoneNumber`, que é o nome canônico do campo em inglês, tokeniza em `['phone','number']` e o terminal vira `number`, deixando o telefone em claro; o mesmo valia para `documentNumber`, `plateNumber` e `zipCodeValue`. A remoção é só no fim e nunca esvazia a lista, então `partNumber` continua `['part']` — que não é regra de PII — e um campo chamado apenas `number` continua sem classificação.

**Acima do teto de nome de campo a classificação falha fechada.** O tokenizador corta em `MAX_FIELD_NAME_LENGTH` para manter o custo do `ACRONYM_BOUNDARY` limitado, mas cortar antes de comparar falhava **aberto**: um nome com 130 caracteres antes de `Password` perdia o token e o valor saía em claro. Nome maior que o teto agora é tratado como segredo — o pior caso vira excesso de remoção, nunca vazamento.

Por que sequências e não nomes compostos literais: com correspondência por segmento contra literais compostos, `apiKey` tokeniza em `api`+`key` e `connectionString` em `connection`+`string`, e **nenhum dos dois casaria com nada** — falhando aberto exatamente nos dois segredos que a política exige remover. Pelo mesmo motivo não existe regra atômica `[key]`, `[string]`, `[code]` ou `[pass]`: é isso que mantém `monkey` e `passenger` como tokens únicos não classificados. `api.key`, `api_key` e `apiKey` casam todos com `[api, key]`.

Uma classificação **pessoal em um contêiner é herdada por todo descendente escalar**. O caso que força isso é real: `address: { street, city, state, zipCode }`, em que `city` e `state` não casam com regra nenhuma sozinhos — classificar só as folhas vazaria metade do endereço. As chaves e a estrutura são preservadas, cada escalar é mascarado, e um descendente classificado como segredo continua sendo **removido**, porque a precedência de segredo supera a herança.

### Mascaramento é redução de exposição, não anonimização

As máscaras são determinísticas e preservam a forma — `Maria Silva` → `Ma***va`, `123.456.789-09` → `***.***.789-09` — mantendo as duas propriedades que o troubleshooting realmente precisa: *o valor chegou?* e *é o mesmo valor daquela outra requisição?*

**O quanto é revelado depende do tamanho.** A partir de 7 caracteres aparecem as duas pontas (`Ma***va`); entre 4 e 6, só o caractere inicial (`Lucas` → `L***`); abaixo de 4, nada (`SP` → `***`). O degrau existe porque revelar duas pontas de um valor curto deixa de ser mascaramento: em 6 caracteres, `12**56` expõe 4 de 6 e o resto se reconstrói por tentativa. Valor vazio permanece vazio — devolver `***` sugeriria um conteúdo que não existe.

**Campo de evento de negócio é mascarado por declaração, não por chamada.** Cada campo lógico tem uma `sensitivity` em `infrastructure/logging/field-registry.ts`, e é o adaptador que aplica a máscara. Por isso `subjectName`/`subjectEmail` saem mascarados sem uma linha de código no caso de uso, e por isso `partSupplyName`/`workOrderServiceName` — nome de peça e de serviço, não de pessoa — saem em claro: alguém declarou `clear` explicitamente. Mascarar no ponto de chamada é o que se deve evitar, porque é o que se esquece.

Isso **não** torna o registro impessoal. Uma máscara determinística que preserva a forma revela parte do valor e permite ligar ocorrências; portanto **conteúdo mascarado continua sendo dado pessoal** para fins de retenção e de controle de acesso. Pseudonimização com chave (HMAC) foi considerada e rejeitada como desproporcional aqui — adiciona provisionamento de chave, rotação e um caminho de fallback, e torna os valores ilegíveis justamente para quem está investigando.

### `name` é pessoal por padrão, com isenção explícita e posicional

A intuição é que `customer.name` é dado pessoal enquanto `service.name` não é. **Esse caminho não existe no payload:** `POST /api/customers`, `POST /api/users`, `POST /api/services` e `POST /api/parts-supplies` recebem todos o campo em `body.name`. Redação por caminho também não os distingue — só rota + caminho distingue.

A decisão: `name` é **pessoal por padrão**, com uma isenção CLEAR pequena, explícita e revisável para os recursos de catálogo `services` e `parts-supplies`, derivada do segmento de URL.

**A isenção é posicional.** Ela vale apenas para `name` na **raiz** do corpo ou da query daquele recurso; não alcança nenhum `name` aninhado. Sem essa restrição, um payload rejeitado numa rota isentada poderia expor `supplier.name` ou qualquer `foo.name` arbitrário sem máscara — uma isenção por rota inteira seria uma isenção escolhida pelo atacante. **A direção da falha é segura:** um recurso novo que exponha um `name` nasce mascarado até que alguém declare a isenção deliberadamente. O custo de errar é excesso de máscara, nunca vazamento.

### Varredura por forma, como segunda camada

Texto livre (descrições, observações, notas) permanece CLEAR por ser o conteúdo de maior valor operacional, mas passa por uma varredura baseada na **forma** do conteúdo, independente do nome do campo: CPF/CNPJ, e-mail e telefone são **mascarados**; token assinado em três partes, credencial de `Authorization` e string de conexão com credenciais são **removidos**. A mesma varredura se aplica a mensagens de erro, stack traces, causas encadeadas, valores de cabeçalho e `url.path`.

Todo texto é **truncado ao limite máximo antes de qualquer passagem de regex, em todos os pontos de entrada** — `url.path`, cabeçalhos, mensagens e stacks chegam ao scrubber diretamente, não pela caminhada do payload, então limitar só dentro da caminhada os deixaria ilimitados.

**O teto é por atributo, não um número único.** 2048 em tudo era generoso demais para campos que na prática são curtos, e como o access log também sai em `401`, qualquer cliente não autenticado inflava a linha de ~665 bytes para ~7 KB só alongando path, user-agent e `accept-language`. Hoje: `url.path` 512, `url.query` 1024 (cortado na fronteira entre parâmetros, para não deixar escape pela metade), `user_agent.original` 512, valor de cabeçalho 256. 2048 continua valendo para texto livre de payload, onde o conteúdo é o valor operacional, e 8192 para stack trace, onde o corte perde o quadro que interessa.

**A mensagem do log também passa pelo scrubber.** `message` era a única chave presente em toda linha fora da cadeia: `formatters.log` só recebe o objeto, e o pino serializa a mensagem por um caminho separado. O caso concreto não é hipotético — o bridge do `nestjs-pino` converte o contrato `error(message, stack)` do Nest em `{ err }` sem mensagem, e então o pino levanta `err.message` **crua** para o envelope, produzindo linhas com `exception.message` redigida ao lado de um `message` com a connection string inteira. Um `serializers.message` fecha isso, e roda **depois** dessa derivação.

**Truncar limita o tamanho varrido; não limita o custo.** Quatro padrões eram quadráticos e o limite não os continha: `jwt`, `email` e `url-credentials` no scrubber, e o `ACRONYM_BOUNDARY` do tokenizador — este último rodando em **toda** chave do payload. Um corpo de ~98 KB sem autenticação, resolvendo para `401`, bloqueava o event loop por **2 s** pelos valores e **349 ms** pelas chaves.

Duas correções posteriores fecharam o que sobrou. No `url-credentials`, o grupo atômico limitava só o prefixo do esquema: o quantificador da senha continuava varrendo até o fim do texto atrás de um `@` que não vinha, e `a://b:` repetido custava 12,6 ms em 8 KB. Excluir `/`, `?` e `#` da senha — que a RFC 3986 exige percent-encoded ali — faz o `://` do trecho seguinte encerrar a varredura do anterior: 0,15 ms, e agora plano. No tokenizador, o corte de 128 caracteres era aplicado **antes** da NFKC, que expande: 128 vezes `Ⅷ` viram 512 maiúsculas e o custo quadrático voltava por inteiro. Hoje o limite é verificado depois da normalização, e um nome que só estoura ao normalizar é classificado como **segredo** — cortar a forma expandida sozinho perderia um `...Password` no fim do nome.

A correção nos padrões é a forma `(?<!classe)(?=(classe+))\1` — fronteira à esquerda para a busca não recomeçar dentro de um trecho já visitado, mais grupo atômico emulado para o motor não retroceder para dentro dele; casa exatamente o mesmo texto. No tokenizador é um teto de nome de campo, aplicado dentro do próprio `tokenize` para que nenhum caminho futuro o contorne. Cada padrão tem um teste de custo com o **quase-match específico dele** — uma entrada única para todos não serve, porque uma sequência só de maiúsculas tem uma única fronteira de palavra e nem exercita alguns deles.

### Cabeçalhos por lista de permissão, URL nunca em forma bruta

Só três cabeçalhos de requisição são registrados: `content-type`, `content-length` e `accept-language`. `Authorization` e `Cookie` não são registrados, nem mascarados, nem enumerados. A representação padrão do objeto de requisição da biblioteca de logging (que carrega **todos** os cabeçalhos) é neutralizada por configuração — `quietReqLogger`/`quietResLogger`, serializers anulados e um filtro final contra o dicionário de campos.

**A URL nunca é registrada em forma bruta.** Qualquer query string passa pela mesma classificação do corpo: um campo `token` é classificado como SEGREDO e removido antes da emissão de `url.query`. A decisão de orçamento usa `POST /api/me/quotes/:id/decisions`, com o Cliente da Oficina autenticado (ver [ADR 0004](./adr/0004-autenticacao-de-clientes.md)); a rota pública `POST /api/auth/password-reset-confirmations` também não transporta segredo na URL.

O caminho é **canonicalizado antes da varredura** (`url-attributes.ts`), nesta ordem: trunca, decodifica até estabilizar, varre. Sem decodificar, `maria.silva%40gmail.com` não tem a forma de um e-mail e um token com `%2E` no lugar do ponto não tem a forma de um JWT — o percent-encoding driblaria o scrubber inteiro. A decodificação se repete sob um teto declarado (`MAX_DECODE_PASSES`) porque `%2540` decodifica para `%40`, que ainda não tem forma de arroba: com uma passagem só, um e-mail duplamente codificado atravessava a redação inteira. A varredura roda uma vez, sobre a forma já estável.

**E falha fechada no teto.** Devolver a forma **parcial** ao esgotar os passes reabria o furo por outro lado: `%40` fica a uma decodificação de virar `@`, então `/users/alice%25252540example.com` saía como `/users/alice%40example.com` e o e-mail voltava inteiro com um `decodeURIComponent`. Se um passe a mais ainda mudaria o valor, o resíduo percentual é substituído por `[ENCODED]`. Nenhum cliente legítimo codifica quatro vezes — o que chega assim é evasão.

**A mesma canonicalização vale para a query, e não só para o caminho.** O Express decodifica **uma vez**, então um valor duplamente codificado chega ao classificador ainda sem forma reconhecível — `aaa%252Ebbb%252Eccc` não tem forma de JWT — e o `encodeURIComponent` da saída o reintroduz no log, de onde duas decodificações recuperam o original. Uma política de URL só, para os dois.

**A decodificação é por bytes, e não-fatal.** `decodeURIComponent` lança em conteúdo inválido, e as duas primeiras versões devolviam texto **cru** no `catch` — falhando aberto exatamente onde a proteção existe. A primeira devolvia o caminho inteiro, então um `%ZZ` em qualquer posição desligava a canonicalização de todas as outras sequências. A segunda passou a decodificar trecho a trecho, o que fechou o `%ZZ` mas não o caso seguinte: `%C3%28` é sintaticamente válido e inválido em UTF-8, e como o trecho é agrupado (para que `%C3%A9` vire um caractere só), **um** par de bytes ruim preservava todo o resto do trecho — `/api/x/%C3%28` seguido de um e-mail ou de um JWT percent-encoded chegava íntegro e trivialmente reversível ao log.

Hoje o trecho é convertido em bytes e decodificado com `TextDecoder` em modo não-fatal: o multibyte válido continua virando um caractere, só o byte inválido vira U+FFFD, e o sufixo sensível continua sendo reconhecido. É o mesmo comportamento do parser de query string do Express — e é por isso que `url.query` nunca teve esse problema.

**O 404 gerado pelo framework é reescrito.** O Nest monta a mensagem do 404 automático como `Cannot ${método} ${originalUrl}`, query inclusa, e ela chegaria inteira em `oficina.error.message` — reintroduzindo a URL bruta que `url.query` existe para não registrar. O ramo é reconhecido por **igualdade exata** contra essa mesma construção aplicada à requisição em curso: não é parsing de texto livre, é comparar a mensagem com o template do próprio framework. Uma mensagem de negócio (`'Orçamento não encontrado(a)'`) não tem como coincidir, então um `NotFoundException` lançado por um handler real passa intocado.

A igualdade exata é escolhida por não depender de interno do framework, e não porque o estado da requisição não sirva: o `setNotFoundHandler` do adaptador Express registra o handler com `use()`, ou seja, **middleware e não rota**, e o Express 5 só preenche `request.route` em rota casada. É por isso que o access log de um caminho inexistente omite `http.route`, como o E2E da fronteira de cobertura afirma. Comparar a mensagem com o template do próprio framework continua sendo o discriminador certo — só que pelo motivo de não amarrar a redação a um detalhe de registro de rota que pode mudar entre versões.

### Corpo apenas em falha, limitado e de tipo estável

O corpo é registrado **apenas** nos status em que ele explica a falha — `400`, `409`, `422` e qualquer `5xx` —, apenas para métodos que alteram estado, apenas para `application/json` e `application/*+json`, e apenas quando a requisição foi concluída normalmente. É uma lista de permissão, e não a faixa `4xx` inteira: num `401`/`403`/`404`/`405`/`429` a causa é a credencial ou a rota, e o payload não responde à pergunta — e como são justamente os status alcançáveis **sem autenticação**, a faixa aberta dava a um chamador anônimo um canal de escrita de 4 KB por requisição no armazenamento de logs. Ele é emitido como **um único valor textual** em `oficina.http.request.body_json`, limitado a **4096 bytes UTF-8 medidos sobre a string final já sanitizada** — o indicador de truncagem (`oficina.http.request.body_truncated`) e o envelope do log ficam fora desse orçamento. Uma estrutura aninhada significaria mapear chaves arbitrárias controladas pelo chamador (explosão de campos) com um tipo que varia conforme o que foi postado; uma string é de tipo estável.

Num `200`, o corpo não diz nada que o banco não diga; numa falha de validação, é exatamente o que se precisa.

**O indicador de truncagem cobre todos os limites, não só o de bytes.** Profundidade, tamanho de array, orçamento de entradas e corte de string também descartam conteúdo, e o corte de string é o único que não deixa nem marcador em banda — sem o indicador, um campo de 9 KB virava 2048 caracteres e o log afirmava, por omissão, estar completo. Qualquer limite aplicado durante a caminhada marca um estado compartilhado que o `serializeBody` consolida.

**O nome da propriedade também é conteúdo.** A classificação lê a chave para decidir o tratamento do valor, mas a chave em si é texto controlado pelo cliente: um payload em forma de mapa (`{ "maria.silva@gmail.com": … }`, `{ "123.456.789-09": … }`) atravessaria a redação inteira. Por isso a chave é classificada pelo nome **original** e depois passa pelo mesmo scrubber por forma, com teto de comprimento próprio. A varredura é no-op para nome de campo normal — `nome`, `e_mail` e `documento` não casam com padrão nenhum e saem intactos —, então o que se perde é a identidade do caso patológico, nunca o diagnóstico de "o cliente mandou a chave errada", que é o motivo de capturar o corpo. Truncar e mascarar podem colapsar duas chaves na mesma string; a colisão vira sufixo determinístico em vez de sobrescrita silenciosa. O sufixo vem de um **contador por chave-base**: reiniciar a busca em `~2` a cada colisão custava O(n²) — mil e-mails distintos que mascaram para a mesma string davam ~500 mil consultas e 186 ms de event loop por requisição, contra 12,6 ms sem colisão, e o vetor é alcançável sem autenticação em `POST /api/auth/login`. Com o contador, 9,5 ms e curva plana.

### Chaves de telemetria não são caminhos de payload

A camada de aplicação **não tem como fornecer uma chave física**. Os métodos por nível do `ILogger` aceitam apenas a mensagem — não existe parâmetro de contexto livre —, e `event()` recebe **nomes lógicos** (`quoteId`) declarados na entrada tipada do catálogo, que o adaptador traduz para a chave física (`oficina.quote.id`). Isso torna `oficina.foo: { password: … }` inalcançável por construção, e não por filtro.

A restrição de campos por evento é de **compilação**: a assinatura de `event()` rejeita campo não declarado inclusive quando o objeto é montado numa variável antes da chamada, caso em que a checagem de excesso do TypeScript sozinha não valeria. Em runtime o adaptador ainda valida contra o vocabulário lógico completo e descarta o que não reconhece, com uma linha de diagnóstico em stderr.

Fechando o esquema do outro lado, o normalizador descarta toda chave que o dicionário de campos não declara — inclusive as que as bibliotecas emitem por padrão. `user.*` é deliberadamente **não** reservado, porque carrega dados de identidade controlados pela aplicação e precisa continuar classificável.

### Identificador de correlação validado, e origem do cliente só por proxy autorizado

O `x-request-id`/`x-correlation-id` recebido é **validado** antes de ser reaproveitado, registrado ou devolvido, em duas etapas: charset restrito com comprimento máximo, e depois a exigência de **sobreviver intacto ao próprio scrubber** — se `sanitizeText(recebido) !== recebido`, o valor é descartado. Em qualquer descarte entra um UUID v4, e o identificador efetivamente usado sempre volta no cabeçalho de resposta.

**Por que a segunda etapa existe.** O charset aceita ponto, hífen e underscore, ou seja, o alfabeto de um JWT: o overhead mínimo de um HS256 é 36 caracteres de header + 43 de assinatura + 2 pontos, deixando 47 para o payload dentro do teto de 128 — um token assinado curto **cabia**. Nenhum token que esta aplicação emite cabe (o de decisão de orçamento passa de 250 caracteres), mas um gateway ou cliente mal configurado copiando credencial de outro sistema para o cabeçalho de correlação escreveria uma credencial viva em toda linha da requisição. A comparação por igualdade preserva a junção para identificadores legítimos — `pedido-12345-retry-2` atravessa o scrubber inalterado — e descarta só o que o próprio sanitizador reconheceria como sensível.

**O que continua fora do alcance**, aceito explicitamente: **cardinalidade**. O chamador pode gerar um identificador válido e distinto por requisição — e o próprio UUID de fallback já é único por natureza. Exigir formato fechado (UUID/ULID) foi descartado: `pedido-12345-retry-2` é um identificador de correlação legítimo e recusá-lo quebraria a junção para quem o enviou.

O endereço de origem vem do `req.ip` do Express com `trust proxy` alimentado por `TRUSTED_PROXY_CIDRS`. O Express avalia a cadeia `X-Forwarded-For` da direita para a esquerda até o primeiro salto não confiável. Na ausência de configuração válida, **nenhum proxy é confiável** e os cabeçalhos encaminhados são ignorados — falha fechada. Uma configuração inválida sinaliza a substituição e **nunca impede o boot**.

**O que o Express resolve é texto, não um IP.** `client.address` e `url.scheme` são os dois únicos valores do access log derivados de cabeçalho encaminhado, e nenhum dos dois passa pelo scrubber. Com um proxy confiável ativo, o Express devolve o primeiro salto não confiável **como está** — sem exigir que seja um IP — e o `X-Forwarded-Proto` cru até a primeira vírgula: medido, um `client.address` de `maria.silva@gmail.com` e um `url.scheme` de `Bearer abcdef1234567890` entravam inteiros. Por isso o endereço é validado com `net.isIP()` e omitido quando não é um IP, e o esquema é restrito a `http`/`https` com fallback para o esquema da conexão real. Com `TRUSTED_PROXY_CIDRS` vazio — a configuração entregue — o canal não existe; a validação é o que impede que ligar um proxy o abra em silêncio.

### Risco residual, dito e não maquiado

Um segredo colocado sob um nome de campo inocente, em um formato que nenhum detector reconhece, ainda chega ao log. A proteção é "os detectores declarados", não "nenhum dado sensível jamais". Se a API passar a carregar dados genuinamente regulados, endurecer isso para uma lista de permissão de campos logáveis é uma mudança de especificação, não um redesenho — a fronteira do sanitizador já é o único lugar onde isso seria aplicado.

