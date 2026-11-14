# ADR 0026: Usuários lidos no Identity, sem réplica

## Status

Aceito — 2026-11-10

Emenda o [ADR 0004](0004-autenticacao-de-clientes.md) (o usuário de acesso do cliente passa a ser do Identity) e o [ADR 0022](0022-token-de-funcionario-em-rs256.md) (o emissor do token de funcionário passa a ser o Identity, e a validação deixa de reler o usuário). Segue o caminho do [ADR 0023](0023-catalogo-e-estoque-no-inventory-com-reserva-pela-saga.md): um gateway de leitura sobre o cliente HTTP interno do [ADR 0020](0020-chamadas-internas-e-rotas-negadas-por-padrao.md).

## Contexto

Os usuários passaram a ter um dono só, o Identity, o serviço da solução que guarda funcionários e usuários de acesso dos clientes, as senhas, os códigos de redefinição de senha e as chaves que assinam o token de funcionário. Nenhum serviço lê o banco de outro. O work-order continua dono das ordens de serviço (OS), do histórico de status, dos clientes e dos vínculos que autorizam um usuário a agir em nome de um cliente, e esses dados apontam para usuários em três lugares:

- o mecânico atribuído à OS (`work_orders.assigned_user_id`), que precisa ser um `MECHANIC` ativo e aparece com nome, e-mail e papel no detalhe e na lista de OS;
- o autor de cada entrada do histórico (`status_history.changed_by_id`), que aparece da mesma forma;
- o usuário de um vínculo de acesso (`user_customers.user_id`), listado com nome, e-mail, papel e status nos usuários de um cliente.

Além disso, o token de funcionário era validado relendo o usuário no banco do work-order a cada requisição, para recusar na hora um usuário desativado ou que trocou a senha. Sem a tabela de usuários, duas perguntas precisavam de resposta:

1. **Como o work-order mostra e confere os usuários** sem tê-los no próprio banco.
2. **Como o token é validado** sem reler o usuário localmente.

## Decisão

### 1. Usuários lidos no Identity a cada resposta

O work-order guarda só o id do usuário, sem chave estrangeira, e lê o resto por uma porta de saída, `IIdentityUsersGateway` (`application/ports/output/gateways/identity/`), implementada pelo `HttpIdentityUsersGateway` (`infrastructure/gateways/identity/`) com o endereço de `IDENTITY_SERVICE_URL`:

- **Leitura** — `GET /internal/users/:id` do Identity devolve `{ id, name, email, role, isActive }`. Para uma lista, os ids distintos são lidos em paralelo, e um `404` vira usuário ausente: o mecânico ou o autor aparece como `null`, e o vínculo fica fora da lista de usuários de um cliente.
- **Mecânico conferido antes da escrita** — a `MechanicAssignmentPolicy` lê o usuário antes da transação, na abertura e na edição da OS: usuário desconhecido responde 404, e quem não é `MECHANIC` ativo, 409, com as mesmas mensagens de antes. A OS guarda só o id.
- **Usuário de acesso criado pelo Identity** — a concessão de acesso a um cliente chama `POST /internal/customer-users`, que encontra o usuário pelo CPF ou o cria e envia a senha inicial, e só depois grava o vínculo com o id devolvido. A chamada é idempotente pelo CPF, então repetir uma concessão que falhou depois de criar o usuário reaproveita o mesmo usuário, sem Saga. O `409` e o `422` do Identity chegam ao chamador com a mensagem dele.
- **Destinatários dos e-mails** — os e-mails ao cliente (orçamento enviado, link de pagamento e falta de estoque) vão aos usuários ativos vinculados a ele, lidos no Identity antes da transação, ou, sem nenhum, ao e-mail do cliente; o work-order não envia e-mail, e sim grava cada um no outbox como a mensagem `notification.email.send`, que a função Lambda de notificação da solução envia.
- **Falhas** — Identity sem resposta em 2 segundos, com erro 5xx ou com um 4xx fora do contrato responde 503 (`Serviço de destino indisponível`). As rotas que gravam leem o Identity antes de gravar, então o 503 sai sem nada gravado.
- **Cache** — o snapshot da OS no cache guarda só o id do mecânico; o usuário é lido no Identity a cada leitura, com ou sem acerto no cache.
- **Contrato público** — o mecânico e o autor do histórico mantêm o formato `{ id, name, email, role }`. O usuário com acesso a um cliente passa ao formato do Identity, `{ id, name, email, role, isActive }`, sem `createdAt` e `updatedAt`.
- **Rota oferecida ao Identity** — o work-order serve `GET /internal/users/:userId/customers`, os clientes ativos vinculados a um usuário, que o Identity lê para montar o perfil de `GET /api/me`.

O work-order perde o login, o refresh, a redefinição de senha, o cadastro de usuários, `GET /api/me` e `PATCH /api/me/password`, que são do Identity. As três chaves estrangeiras para `users` saem numa migration; as tabelas `users` e `password_reset_codes` ficam no schema, sem uso, até uma migration seguinte, para que a versão anterior volte a subir se este deploy for desfeito.

### 2. Token validado só pelas claims

A `JwtStrategy` confere a assinatura com a chave pública, o emissor, a audiência, a expiração, o `kid`, o `typ = access` e as claims `sub` (um UUID), `email` e `role`, e monta o principal com elas, sem ler o usuário no banco nem no Identity. A `CustomerJwtStrategy` deixa de reler o usuário e mantém só a conferência do `sub` como UUID e a conferência local do vínculo com cliente ativo. O work-order não guarda chave privada nenhuma.

A consequência é uma janela de revogação: um funcionário desativado ou que trocou a senha continua com o access que já tem até ele expirar, em até 10 minutos, e o Identity recusa o refresh na hora; um usuário de cliente nas mesmas condições continua com o token de cliente até ele expirar, em até 60 minutos. A revogação de um vínculo e a desativação de um cliente continuam valendo na hora, porque são dados do work-order.

## Alternativas consideradas

### Copiar nome, e-mail e papel do usuário na OS

A OS e o histórico guardariam, além do id, os dados que mostram, gravados na atribuição e na mudança de status. Descartada porque a cópia fica velha sem aviso (o nome ou o e-mail mudam no Identity e a OS segue mostrando o antigo), não confere se o mecânico ainda está ativo e põe dado pessoal de outro serviço no banco do work-order.

### Réplica `UserView` mantida por mensagens

O work-order manteria uma tabela com os usuários, atualizada pelos eventos do Identity, e leria tudo localmente, sem depender do Identity no ar. Descartada porque replica uma entidade de outro serviço, exige eventos de usuário, consumidor, idempotência e uma carga inicial, e ainda assim ficaria atrasada em relação ao dono, justamente na conferência do mecânico e do status, que precisa do dado atual. A disponibilidade que ela compraria não é necessária: o Identity está no mesmo cluster, e um 503 sem nada gravado é aceitável.

### Listar a OS só com o id do mecânico

As respostas trariam `assignedUserId` e `changedById` e deixariam o cliente da API buscar o usuário no Identity. Descartada porque muda o contrato público da OS e do histórico, que hoje traz nome, e-mail e papel, e empurra para cada cliente a chamada que o work-order faz uma vez.

### Revalidar o token no Identity a cada requisição

A `JwtStrategy` chamaria o Identity para conferir se o usuário segue ativo e sem troca de senha depois do `iat`, e a revogação valeria na hora. Descartada porque acrescenta uma chamada de rede a toda requisição autenticada de todos os serviços que validam o token e torna o Identity um ponto único de falha da solução inteira: com ele fora, nenhuma rota de funcionário responderia, nem as que não usam usuário. A janela de até 10 minutos é aceita pela solução.

### Revalidar o token só no work-order

O work-order continuaria relendo o usuário a cada requisição, numa cópia local ou na tabela antiga. Descartada porque exige manter os usuários no banco do work-order (a réplica descartada acima) e dá ao work-order uma regra de revogação diferente da dos outros serviços, que validam só pelas claims: o mesmo token valeria num serviço e seria recusado no outro.

## Consequências

### Positivas

- **Um dono para os usuários**: nome, e-mail, papel, status e senha mudam num lugar só e aparecem atualizados em toda resposta do work-order.
- **Sem chave privada nem senha no work-order**: o serviço só valida tokens, com chaves públicas, e não lê nem grava senha.
- **Validação do token sem rede**: o token de funcionário é validado do mesmo jeito em todos os serviços, sem depender do Identity no ar.
- **Concessão de acesso repetível**: a idempotência pelo CPF no Identity resolve a falha entre criar o usuário e gravar o vínculo, sem Saga.

### Negativas e riscos aceitos

- **Identity fora do ar**: as rotas que mostram ou conferem usuários (OS, histórico, usuários de um cliente, atribuição de mecânico e concessão de acesso) respondem 503. O token já emitido continua valendo, e as rotas que não tocam usuários seguem respondendo.
- **Janela de revogação**: até 10 minutos para o token de funcionário e até 60 minutos para o de cliente depois de desativar o usuário ou trocar a senha (ver [Segurança](../security.md#janelas-de-revogação-aceitas)).
- **Uma chamada por usuário distinto em cada resposta**: a lista de OS lê no Identity cada mecânico distinto da página, em paralelo. Aceito porque as páginas são pequenas (até 100 itens) e o Identity guarda o usuário em cache.
- **Mudança no contrato dos usuários de um cliente**: `GET /api/customers/:customerId/users` e a resposta da concessão de acesso perdem `createdAt` e `updatedAt`.
- **Tabelas legadas no schema**: `users` e `password_reset_codes` ficam sem uso até uma migration seguinte as remover.

### Revisar se

- O Identity ficar fora do ar com frequência a ponto de os 503 pesarem na operação da oficina (aí, rever a réplica `UserView`).
- A janela de revogação deixar de ser aceitável (aí, revogação imediata por lista de bloqueio ou introspecção, valendo para todos os serviços que validam o token).
- As páginas de OS crescerem a ponto de a leitura de um usuário por chamada pesar na latência (aí, uma rota de leitura em lote no Identity).
