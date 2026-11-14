# ADR 0004: Autenticação externa de clientes por CPF via função serverless

## Status

Aceita

Emendada pelo [ADR 0026](0026-usuarios-lidos-no-identity-sem-replica.md): o `User` (a identidade, com a senha) passou a ser do Identity, o serviço da solução dono dos usuários, que também cria o usuário de acesso de um cliente pelo CPF; este serviço guarda só o id do usuário no vínculo `UserCustomer`. `GET /api/me`, `PATCH /api/me/password` e o `AnyAuthGuard` saíram deste serviço, e a `CustomerJwtStrategy` deixou de reler o usuário: ela confere só o vínculo com cliente ativo, e a troca de senha e a desativação do usuário valem quando o token de cliente expira. A separação entre identidade e parte comercial, a senha além do CPF, a função serverless e a autorização por vínculo a cada requisição continuam valendo.

## Contexto

O sistema precisa permitir que o Cliente da Oficina (pessoa física, dona do
veículo ou representante de uma pessoa jurídica atendida) aprove ou rejeite
orçamentos autenticando-se, substituindo o `GET` público com token na query
string usado até então. O enunciado do desafio descreve o fluxo como "CPF,
consulta de existência e emissão do token" — sem mencionar senha
explicitamente.

## Decisão

- **Identidade (`User`) e parte comercial (`Customer`) permanecem entidades
  diferentes.** Uma pessoa física pode ser cliente de si mesma e representar
  várias empresas; uma empresa nunca tem credenciais.
- **A role interna (`User.role`) torna-se opcional.** Não é criado um valor
  `CUSTOMER` no enum `UserRole`: esse enum descreve permissão *dentro* da
  oficina, e um cliente externo não possui nenhuma.
- **Conceder acesso reaproveita um `User` existente quando o CPF bate; nunca
  quando só o e-mail bate.** `User.cpf` é `@unique` global e, para um cliente
  INDIVIDUAL, vem de `Customer.document` — já único e validado por
  `DocumentValidator`. CPF batendo é garantidamente a mesma pessoa física, então
  a operação apenas cria o vínculo `UserCustomer` sobre o `User` já existente
  (sem tocar em nome, e-mail, senha ou role — nada da conta é alterado). Já o
  e-mail não é identidade: muda, se repete em contexto familiar, e para
  INDIVIDUAL é digitado à mão no cadastro do `Customer` — colidir com o e-mail
  de **outra** pessoa (achado só por e-mail, com CPF diferente ou ausente) é o
  cenário original que motivou o bloqueio total desta ADR, e continua sendo
  conflito real (409): a operação nunca associa um CPF a uma conta encontrada
  só pelo e-mail. Isso é o que a estrutura do PR já pedia — `UserCustomer` é
  N:N, `GET /api/me` devolve `customers` como array, `AnyAuthGuard` serve os
  dois fluxos na mesma rota, e a `role` é opcional — e habilita os casos que a
  versão anterior desta decisão negava: a mesma pessoa física sendo cliente de
  mais de um `Customer` (inclusive representando mais de uma empresa), e um
  funcionário que também é cliente de si mesmo. Limitação aceita: um
  funcionário com `cpf = null` não vira cliente por este caminho — não há rota
  para preencher o CPF de um `User` existente (`assignCpf()` seguirá sem
  chamador de produção), e criar uma abriria a lacuna que motivou o bloqueio
  original: um atendente carimbando um CPF arbitrário numa conta existente sem
  verificação de identidade. Resolve-se depois, com uma operação administrativa
  dedicada.
- **Não existe `accessType` no vínculo `UserCustomer`.** A semântica do
  vínculo (acesso próprio vs. representação de empresa) deriva de
  `Customer.type`, evitando um campo redundante e potencialmente
  inconsistente.
- **Dois fluxos de autenticação totalmente isolados**, com duas estratégias
  Passport distintas (`jwt` HS256 interno, `customer-jwt` RS256 externo).
  Nunca um único verificador que aceite os dois algoritmos — isso eliminaria,
  por construção, a classe de ataque de confusão de algoritmo.
- **A autenticação externa exige senha, além do CPF.** CPF é identificador
  público, não segredo — usá-lo sozinho como credencial permitiria
  autenticação por qualquer pessoa que conheça o CPF de outra. A leitura
  adotada é que "autenticação por CPF" significa CPF como identificador, à
  semelhança de qualquer banco brasileiro, não como credencial isolada. Este é
  o único ponto do desenho cuja validação dependeu de confirmação externa ao
  time.
- **A função de autenticação é serverless e autônoma**, consultando o banco
  diretamente — nunca um proxy do `POST /api/auth/login` interno. Ela assina
  um JWT assimétrico (RS256); a API principal possui apenas a chave pública
  de verificação.
- **O `GET /api/quotes/:id/decisions?token=...` público é removido.** Um
  `GET` que altera estado é executável por prefetch de cliente de e-mail ou
  scanner de segurança antes que a pessoa leia a mensagem, e o token na URL
  contornaria a autenticação por CPF e senha.
- **Autorização dinâmica por vínculo, nunca embutida no token.** O JWT
  externo não carrega `customerId`: cada operação sensível consulta
  `UserCustomer` no banco, fazendo remoções de vínculo e desativações de
  cliente valerem imediatamente, sem lista de revogação.
- **Trocar ou resetar a senha invalida imediatamente todos os tokens emitidos
  antes da troca, sem lista de revogação de JWT.** `User.passwordChangedAt` é
  atualizado no único ponto por onde a senha muda (`User.changePassword()`) e
  as duas estratégias Passport, mais o refresh, comparam o `iat` do token com
  esse campo — recarregado do banco a cada requisição, junto de `isActive` e
  do vínculo. Sem essa checagem, "troquei a senha porque desconfio que ela
  vazou" não fechava a janela pela qual o atacante entrou: o access token
  continuava válido por até 15 minutos, e o refresh por até 7 dias, renovando
  à vontade.

## Alternativas consideradas

### `User` com FK opcional para `Customer`

Proposta inicial de um colega, ao revisar a feature de documento (CPF/CNPJ) no
`User`: a tabela `User` continuaria sendo a única fonte de login, e um cliente
que precisasse logar ganharia uma linha em `User` vinculada ao seu `Customer`
via `customerId`. Descartada porque:

- `User.role` (`ADMIN`/`MECHANIC`/`ATTENDANT`) é um modelo de permissão
  interno da equipe da oficina — misturar clientes ali exigiria um 4º valor de
  role ou depender de `customerId` não-nulo como discriminador implícito, um
  cheiro de "campo nulo que só faz sentido em um branch do enum".
- Resolve apenas o caso "operador de empresa PJ" — todo cliente pessoa física
  que precisasse logar também exigiria uma linha-sombra em `User`.
- Compartilhar guard/verificador entre funcionário e cliente aumenta o raio de
  dano de um bug de RBAC: um cliente poderia acidentalmente passar por um
  guard `@Roles(ADMIN)` só por estar na mesma tabela.

### `UserRole.CUSTOMER` como valor do enum interno

Chegou a ser implementada numa iteração paralela deste desenho (branch
`feature/customer-login`, divergente da que resultou nesta entrega).
Descartada pelo mesmo motivo do item anterior: `UserRole` descreve permissão
*dentro* da oficina, e um cliente externo não possui nenhuma — um valor
`CUSTOMER` no mesmo enum confundiria dois domínios de autorização que esta
ADR mantém deliberadamente isolados (ver "Dois fluxos de autenticação
totalmente isolados", acima).

### `Customer` com login e senha próprios

Direção adotada numa discussão anterior a esta ADR: `Customer` ganharia seu
próprio `passwordHash`, paralelo a `User`, evitando misturar cliente e
funcionário na mesma tabela. Superada pelo desenho final quando o requisito
evoluiu para cobrir a pessoa física que representa **mais de uma** empresa —
um `Customer` com login próprio duplicaria a identidade dessa pessoa em dois
registros de `Customer`, um por empresa representada, em vez de reconhecer
que é a mesma pessoa física em ambos os vínculos. Mantida a decisão de
`Customer` nunca ter credencial própria; a identidade de login ficou em
`User`, com `Customer` permanecendo só a parte comercial.

## Riscos aceitos

- Senha inicial e código de reset trafegam por e-mail (mitigado por geração
  aleatória forte, armazenamento somente como hash, e reset administrativo
  disponível).
- Não há limitação de frequência de requisições nesta entrega (risco
  preexistente no login interno, não introduzido por esta mudança).

## Consequências

- Toda rota `/api/me/*` precisa resolver o conjunto de clientes vinculados a
  cada requisição — não há atalho de cache no payload do JWT.
- A função serverless (fora desta entrega) herda um contrato de claims e
  algoritmo já fechado, restando apenas trabalho de implementação e
  infraestrutura (decisões de biblioteca, empacotamento e IaC ficam
  registradas como dívida explícita, não como redecisão).
