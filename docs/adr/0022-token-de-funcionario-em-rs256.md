# ADR 0022: Token de funcionário em RS256 com chave pública por configuração

## Status

Aceito — 2026-10-26

Substitui o [ADR 0013](0013-autenticacao-interna-jwt-stateless.md) no formato e na assinatura do token de funcionário. O que o 0013 decidiu sobre JWT stateless, par access/refresh, revalidação do usuário no banco e invalidação por `passwordChangedAt` continua valendo.

## Contexto

O token de funcionário era HS256, assinado com `JWT_SECRET` (o refresh com `JWT_REFRESH_SECRET`), sem `iss`, `aud` nem `kid`, e valia 15 minutos. Num algoritmo simétrico, quem valida precisa do mesmo segredo de quem assina. A solução passa a ter vários serviços (Inventory, Identity e Billing além deste), e todos aceitam o token de funcionário: com HS256, cada um teria de receber o segredo e, com ele, poderia emitir tokens válidos para todos os outros.

A regra de autenticação da arquitetura exige RS256: o emissor guarda a chave privada e os demais validam localmente, só com a chave pública e o `kid` recebidos por configuração. A troca acontece antes de qualquer serviço novo validar o token, ainda com este serviço como emissor, para que todos nasçam validando o formato final. Quando o login de funcionário mudar de dono, muda só quem guarda a chave privada.

## Decisão

**Perfil do token:**

| Token | Cabeçalho | `iss` | `aud` | Claims | Validade | Chave |
| --- | --- | --- | --- | --- | --- | --- |
| Access | `alg = RS256`, `kid` | `oficina-identity` | `oficina-services` | `sub`, `email`, `name`, `role`, `typ = access` | 10 min (`STAFF_JWT_EXPIRATION`) | `STAFF_JWT_PRIVATE_KEY` |
| Refresh | `alg = RS256`, sem `kid` | `oficina-identity` | `oficina-identity` | `sub`, `email`, `name`, `role`, `typ = refresh` | 7 dias (`STAFF_JWT_REFRESH_EXPIRATION`) | `STAFF_JWT_REFRESH_PRIVATE_KEY`, separada |

- **Emissão.** O `JwtTokenService` passa chave e claims explicitamente a cada assinatura; o `JwtModule` só registra o `JwtService`. O `@nestjs/jwt` mescla as opções do módulo em toda assinatura, e um `keyid` ali faria o refresh carregar o `kid` da chave de access. O emissor e a audiência do access vêm de `STAFF_JWT_ISSUER` e `STAFF_JWT_AUDIENCE`, no ConfigMap, como os do token de cliente; a audiência do refresh é o próprio emissor, o único que o consome. O emissor verifica o refresh com a própria chave privada de refresh, da qual o `jsonwebtoken` deriva a pública, sem variável extra.
- **Validação.** A `JwtStrategy` valida com `STAFF_JWT_PUBLIC_KEY`, `algorithms: ['RS256']` e o `issuer` e a `audience` configurados, e recusa `kid` diferente de `STAFF_JWT_KEY_ID` e `typ` diferente de `access`. Um refresh enviado como access falha na audiência e no `typ`; um access enviado a `POST /api/auth/refresh` falha na chave, na audiência e no `typ`. Como os usuários ainda estão neste serviço, ela continua relendo o usuário no banco a cada requisição.
- **Chaves.** As privadas são secrets do environment `production` do repositório e chegam ao pod pelo Secret `jwt-private-keys`, materializado pelo CD por stdin com o base64 mascarado. A pública e o `kid` são secrets da organização, que o CD acrescenta ao Secret `jwt-public-keys` e que os outros serviços leem. Os pares são gerados com `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048`; `*.pem` está no `.gitignore`. Testes, compose e DAST usam pares efêmeros.

## Alternativas consideradas

### Manter HS256 e distribuir o segredo aos serviços

Seria a menor mudança: mesma biblioteca, mesmas variáveis. Descartada porque o segredo que valida também assina. Qualquer serviço comprometido emitiria tokens aceitos por todos os outros, e a troca do segredo exigiria um deploy coordenado de todos ao mesmo tempo.

### Access de 15 minutos (o valor anterior)

Não exigiria mudança de comportamento para os usuários. Descartada porque os serviços novos não revalidam o usuário no banco: desativação e troca de senha passam a valer só quando o token expira. Com 10 minutos, essa janela fica menor que a anterior.

### Access de 5 minutos, com mais refreshes

Reduziria ainda mais a janela de um token vazado ou de um usuário recém-desativado. Descartada porque dobraria as chamadas de refresh sem ganho proporcional: 10 minutos já fecham a janela abaixo da anterior.

### Mesma chave para access e refresh

Uma variável a menos. Descartada pelo mesmo motivo do ADR 0013: duas chaves limitam o dano de um vazamento a um tipo de token e permitem trocar uma sem a outra. Com chaves separadas, um refresh também não passa na verificação de assinatura de quem valida access.

### JWKS publicado pelo emissor

Permitiria rotacionar chaves sem atualizar a configuração de cada serviço. Descartada nesta etapa: com uma chave por emissor, a distribuição por configuração basta e evita que toda validação dependa de um endpoint do emissor estar no ar.

### Emissor e audiência como variables da organização

Garantiriam que o emissor e todos os validadores leiam o mesmo valor. Descartada porque são valores fixos do contrato, sem troca periódica como a do par de chaves e do `kid`: o ConfigMap de cada serviço basta, no mesmo padrão de `CUSTOMER_JWT_ISSUER` e `CUSTOMER_JWT_AUDIENCE`. Mudar um deles continua exigindo o deploy de todos os serviços.

### Emissor e audiência como constantes no código

Uma configuração a menos em cada serviço. Descartada para manter o mesmo padrão do token de cliente e permitir a troca sem alterar código.

### Chave pública de refresh numa variável própria

Deixaria a configuração igual à da chave de access. Descartada porque só o emissor verifica o refresh, e uma pública cadastrada à parte poderia divergir da privada e recusar todo refresh.

## Consequências

### Positivas

- **Nenhum segredo de assinatura compartilhado.** Quem valida só tem a chave pública, que não emite token.
- **Validação idêntica em todo serviço.** `algorithms`, `iss`, `aud`, `kid` e `typ` vêm de um perfil fixo, copiado no template dos serviços.
- **Confusão de algoritmo fechada.** Token HS256 (inclusive um forjado com a chave pública como segredo) ou sem assinatura é recusado antes de qualquer outra checagem.

### Negativas / Trade-offs

- **Tokens emitidos antes do deploy deixam de valer.** O ambiente é recriado a cada sessão, então basta um login novo.
- **Trocar o par é um passo manual.** Secrets e variables precisam ser atualizados juntos, com um `kid` novo, e cada serviço só adota a chave nova no próprio deploy (passo documentado em `docs/security.md`).
- **Rodar localmente exige gerar as chaves** com `openssl` antes de subir a API (comandos em `docs/local-setup.md`).

### Riscos mitigados

- **Chave privada vazando por log ou artifact**: o CD codifica e mascara o base64 das privadas e aplica por stdin, sem arquivo renderizado; os testes e o DAST geram pares descartáveis.
- **Refresh usado como access, e o contrário**: audiência, chave e `typ` diferentes, conferidos nos dois lados.

### Revisar se

- Houver mais de uma chave ativa por emissor ou rotação programada: publicar JWKS no emissor e validar pelo `kid`.

## Referências

- [ADR 0013 — Autenticação interna via JWT stateless (access + refresh)](0013-autenticacao-interna-jwt-stateless.md)
- [ADR 0004 — Autenticação externa de clientes por CPF via função serverless](0004-autenticacao-de-clientes.md)
- [`docs/security.md` › Chaves do token de funcionário](../security.md#chaves-do-token-de-funcionário)
- [`docs/infra/ci-cd.md` › Injeção de secrets da aplicação](../infra/ci-cd.md#injeção-de-secrets-da-aplicação)
