# ADR 0013: Autenticação interna via JWT stateless (access + refresh)

## Status

Substituído pelo [ADR 0022](0022-token-de-funcionario-em-rs256.md) em 2026-10-26 (aceito em 2026-09-07). O token de funcionário passou a RS256, com `iss`, `aud`, `kid` e access de 10 minutos; o par access/refresh, a revalidação no banco e a invalidação por `passwordChangedAt` descritos aqui continuam valendo.

## Contexto

O enunciado do desafio exige "Autenticação JWT" desde a Fase 1. O sistema tem três papéis internos (`ADMIN`, `MECHANIC`, `ATTENDANT`) que autenticam por e-mail e senha e precisam de sessões que durem o suficiente para uma jornada de trabalho, sem exigir reautenticação constante, mas que possam ser encerradas (por troca de senha, desativação de conta) sem depender de um armazenamento de sessão compartilhado entre réplicas — a API já escala horizontalmente por HPA (ver [ADR 0008](0008-autoscaling-via-hpa.md)), então qualquer estado de sessão teria que ser compartilhado entre pods.

Esta ADR trata especificamente do fluxo **interno** (funcionários da oficina); o fluxo externo (Cliente da Oficina, autenticado por CPF via função serverless) é uma decisão isolada e documentada à parte na [ADR 0004](0004-autenticacao-de-clientes.md) — os dois nunca compartilham verificador, por desenho.

## Decisão

Autenticar via **JWT stateless**, emitido por `POST /api/auth/login` após validar e-mail e senha (hash bcrypt):

- **Access token**: HS256, `JWT_SECRET`, expiração curta (15 minutos) — carrega `sub` (userId), `email` e `role`.
- **Refresh token**: HS256, segredo **separado** (`JWT_REFRESH_SECRET`), expiração longa (7 dias) — trocado por um novo par via `POST /api/auth/refresh`, sem exigir senha novamente.
- Verificação via `passport-jwt` (`JwtStrategy`), que recarrega o `User` do banco a cada requisição (não confia apenas no payload assinado) para checar `isActive`, presença de `role` interna, e que o `iat` do token não seja anterior ao `passwordChangedAt` do usuário (ver [ADR 0004](0004-autenticacao-de-clientes.md), que introduziu esse campo para as duas estratégias).
- Autorização por papel via `RolesGuard` + decorator `@Roles(...)`, aplicado por controller.

Nenhum estado de sessão é mantido no servidor — toda a informação necessária para validar uma requisição está no próprio token (mais a consulta ao `User` atual, que já aconteceria de qualquer forma para checar `isActive`).

## Alternativas consideradas

### Sessões com cookie + armazenamento server-side (Redis, banco)

Exigiria um armazenamento de sessão compartilhado entre todas as réplicas da API (Redis, ou uma tabela de sessões no Postgres), para que qualquer pod pudesse validar a sessão de qualquer requisição — o HPA escala pods sem afinidade de sessão (ver ADR 0008). Descartada porque:

- Introduziria uma dependência de infraestrutura adicional (Redis) só para autenticação, sem necessidade — o requisito do desafio já pede JWT explicitamente.
- Sessões com cookie exigem cuidado extra com CSRF que tokens Bearer em `Authorization` não têm (o mesmo motivo, aliás, que torna o `.zap/rules.tsv` do DAST silenciar alertas de ausência de token anti-CSRF, ver `docs/security.md`).

### Um único segredo para access e refresh token

Simplificaria a configuração (uma variável de ambiente a menos). Descartada porque um único segredo comprometido invalidaria os dois tipos de token simultaneamente — segredos separados (`JWT_SECRET` / `JWT_REFRESH_SECRET`) permitem rotacionar um sem o outro, e limitam o raio de dano de um vazamento a um único tipo de token.

### Refresh token de vida curta igual ao access token

Eliminaria a necessidade de um endpoint de refresh, exigindo apenas reautenticação frequente. Descartada porque forçaria o usuário a reinserir e-mail e senha a cada 15 minutos durante uma jornada de trabalho — o par access/refresh existe precisamente para balancear janela de exposição curta (access token) com conveniência de sessão longa (refresh token) sem reautenticação manual constante.

### Blacklist de tokens revogados (Redis ou tabela)

Permitiria invalidar um token específico antes de sua expiração natural, sem depender de comparação de timestamp. Descartada em favor da checagem de `passwordChangedAt` (ver [ADR 0004](0004-autenticacao-de-clientes.md)): o caso de uso real que motivaria uma blacklist — revogar sessões após suspeita de comprometimento — já é coberto pela troca de senha invalidando todos os tokens anteriores, sem exigir armazenamento de estado adicional nem lista de revogação.

## Consequências

### Positivas

- **Sem estado de sessão compartilhado**: qualquer réplica da API valida qualquer token de forma independente, compatível com o autoscaling por HPA sem afinidade de pod.
- **Janela de exposição limitada do access token**: 15 minutos de validade reduz o dano de um token vazado, sem exigir reautenticação constante do usuário (o refresh cobre a conveniência).
- **Revogação efetiva sem blacklist**: a checagem de `iat` contra `passwordChangedAt` recarregado do banco a cada requisição faz uma troca de senha invalidar imediatamente todos os tokens anteriores — o mesmo mecanismo que a ADR 0004 já registra para o fluxo externo.

### Negativas / Trade-offs

- **Não há revogação individual instantânea de um único token específico**: só é possível invalidar "todos os tokens emitidos antes de X" (trocando a senha), não um token específico ainda dentro de sua janela de validade, sem afetar os demais.
- **Uma consulta ao banco por requisição autenticada**: o `JwtStrategy` sempre recarrega o `User` (para checar `isActive`/`passwordChangedAt`) — o JWT sozinho nunca é suficiente para autorizar, o que renuncia a um dos ganhos clássicos de JWT (validação sem tocar o banco) em troca de poder revogar acesso de forma efetiva.
- **Sem limitação de frequência de requisições no login** nesta entrega — risco preexistente, já registrado como aceito na [ADR 0004](0004-autenticacao-de-clientes.md) e em `docs/security.md`.

### Riscos mitigados

- **Sessão continuando válida após desativação de conta**: mitigado por `isActive` ser checado a cada requisição, não apenas no momento da emissão do token.
- **Token vazado permanecendo útil indefinidamente após suspeita de comprometimento**: mitigado pela invalidação em massa via `passwordChangedAt` ao trocar a senha.

## Referências

- [`docs/architecture.md` › Perfis de usuário (RBAC)](../architecture.md#perfis-de-usuário-rbac)
- [`docs/architecture.md` › Identidade externa, autenticação e autorização por vínculo](../architecture.md#identidade-externa-autenticação-e-autorização-por-vínculo)
- [ADR 0004 — Autenticação externa de clientes por CPF via função serverless](0004-autenticacao-de-clientes.md)
- `docs/security.md` — mitigações aplicadas e riscos residuais aceitos.
