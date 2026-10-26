# Diagramas de Sequência

Três fluxos centrais da aplicação, em notação UML: login interno, abertura de Ordem de Serviço, e autenticação externa do Cliente da Oficina por CPF. Gerados via draw.io a partir de Mermaid, com XML editável embutido nos PNGs.

Em todos os três, existe uma camada de **Controller** duas vezes: o `Controller` do NestJS (em `infrastructure/http/controllers/`, borda HTTP — decorators de rota, DTOs, Swagger) delega para o `Controller` da Clean Architecture (em `interface-adapters/`, sem nenhuma dependência de framework), que por sua vez chama o caso de uso. Ver [ADR 0009](adr/0009-clean-architecture-ddd-em-camadas.md).

## Login interno

<p align="center"><img src="diagrams/login-sequence.png" alt="Diagrama de sequência UML do login interno (POST /api/auth/login): AuthController (NestJS), AuthController (Clean Architecture), AuthenticateUserUseCase, IUserRepository, IHashService e ITokenService, com os quatro caminhos de falha (usuário inexistente, inativo, senha incorreta, sem role interna) convergindo para a mesma mensagem genérica 401, e o caminho feliz emitindo o par de tokens" width="100%"></p>

`POST /api/auth/login {email, password}` — os quatro caminhos de falha (usuário inexistente, inativo, senha incorreta, sem role interna) lançam a mesma exceção genérica (401 "Credenciais inválidas"); só o evento de log distingue a causa, para não virar oráculo de enumeração de contas. O `accessToken` emitido no fim é o mesmo usado como `Authorization: Bearer` no diagrama seguinte.

## Abertura de Ordem de Serviço

<p align="center"><img src="diagrams/work-order-creation-sequence.png" alt="Diagrama de sequência UML da abertura de uma Ordem de Serviço (POST /api/work-orders): WorkOrderController (NestJS), JwtAuthGuard, JwtStrategy, RolesGuard, WorkOrderController (Clean Architecture) e a transação do CreateWorkOrderUseCase — validação de cliente, veículo e mecânico atribuído, geração do número sequencial, criação da OS, histórico de status e orçamento inicial opcional" width="100%"></p>

`POST /api/work-orders`, a partir do `accessToken` obtido no login — passa por `JwtAuthGuard`/`JwtStrategy` (incluindo a checagem de `passwordChangedAt`) e `RolesGuard`, depois pela transação do `CreateWorkOrderUseCase` com todos os ramos de erro (404/409/422) até o commit.

## Autenticação externa do Cliente da Oficina (CPF)

<p align="center"><img src="diagrams/customer-cpf-login-sequence.png" alt="Diagrama de sequência UML da autenticação externa por CPF: a função serverless (fora deste repositório) consulta o banco diretamente, assina um customer-jwt RS256 e o devolve ao Cliente da Oficina; a primeira chamada autenticada (GET /api/me) passa pelo AnyAuthGuard, que tenta a estratégia jwt interna (falha) e depois a CustomerJwtStrategy externa, validando assinatura RS256, isActive, iat contra passwordChangedAt e a existência de vínculo ativo com algum cliente" width="100%"></p>

A função serverless (`POST /customer-auth/login`, documentada na [ADR 0004](adr/0004-autenticacao-de-clientes.md), fora deste repositório) autentica por CPF + senha consultando o banco diretamente — nunca um proxy do login interno — e assina o `customer-jwt` com sua chave privada. A primeira chamada autenticada mostra o `AnyAuthGuard` tentando as duas estratégias Passport em sequência, e todos os ramos de rejeição da `CustomerJwtStrategy` (token sem `exp`, usuário inativo, `iat` anterior à última troca de senha, nenhum vínculo ativo) — todos convergindo para 401.

Ver [Identidade externa, autenticação e autorização por vínculo](architecture.md#identidade-externa-autenticação-e-autorização-por-vínculo) para o raciocínio completo sobre por que a autorização é resolvida a cada requisição, nunca embutida no JWT.

## Referências

- [ADR 0004 — Autenticação externa de clientes por CPF](adr/0004-autenticacao-de-clientes.md)
- [ADR 0009 — Clean Architecture e DDD em camadas](adr/0009-clean-architecture-ddd-em-camadas.md)
- [ADR 0013 — Autenticação interna via JWT stateless](adr/0013-autenticacao-interna-jwt-stateless.md) *(substituído pelo 0022)*
- [ADR 0022 — Token de funcionário em RS256](adr/0022-token-de-funcionario-em-rs256.md)
