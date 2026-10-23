# ADR 0017: Materialização da credencial do banco no CD

## Status

Aceito — 2026-09-13

## Contexto

A master password do PostgreSQL passou a ser gerada e mantida pelo Amazon RDS.
A API, porém, executa migrations e roda em Pods do EKS que recebem a conexão pelo
contrato único `DATABASE_URL` do Prisma. O ARN, o endpoint e a senha não devem ser
copiados para GitHub Secrets/Variables nem lidos diretamente pelos workloads.

O CD já autentica na AWS, configura o `kubectl` e ordena migration/seed antes do
Deployment. Isso o torna a fronteira existente com contexto suficiente para
traduzir os metadados AWS no formato esperado pelo Kubernetes e pelo Prisma.

## Decisão

O job `prepare-deploy` do CD atua como intermediário e, antes das migrations:

1. recebe somente os identificadores não sensíveis
   `vars.RDS_INSTANCE_IDENTIFIER` e `vars.K8S_NAMESPACE`;
2. consulta `DescribeDBInstances` de forma limitada até
   `DBInstanceStatus=available` e `MasterUserSecret.SecretStatus=active`;
3. descobre endpoint, porta, `DBName`, `MasterUsername` e o ARN completo de
   `MasterUserSecret`, verificando campos obrigatórios/porta sem regex
   redundantes sobre os formatos produzidos pela AWS;
4. lê explicitamente o estágio `AWSCURRENT` com `GetSecretValue` e aceita campos
   adicionais no JSON, exigindo `username` e `password`;
5. monta a URL PostgreSQL em um trecho Node.js **inline no `cd.yml`**, aplicando `encodeURIComponent`
   separadamente ao usuário e à senha e preservando
   `schema=public&sslmode=require&uselibpqcompat=true`;
6. mascara senha, senha percent-encoded, URL e URL em base64 antes do uso e envia por stdin um manifesto JSON do
   Secret Kubernetes `database-credentials`, contendo somente `DATABASE_URL`;
7. aplica `api-secret` e o ConfigMap em um step separado, sem publicar outputs
   de credenciais ou versão.

O job `db-migrate` depende de build e preparação e executa somente o Job único
de `prisma migrate deploy` seguido do seed, aguardando sucesso/falha.
`app-deploy` depende dos três jobs anteriores, renderiza a imagem recebida do
build e aguarda o rollout. A migration não precisa recuperar nem repassar
metadados de credenciais.

Reexecutar o CD sem mudar a credencial continua idempotente. Atualizar somente o Secret em um ambiente com Pods existentes e a mesma imagem não atualiza seu environment nem força sua substituição; esse cenário exige revisão do fluxo antes de ser adotado.

A lógica permanece no próprio workflow: não existe arquivo Node.js auxiliar de produção. O trecho inline faz parse/encoding, constrói o manifesto JSON e chama `kubectl` com o manifesto em stdin. As verificações mínimas rejeitam campos obrigatórios ausentes, porta inválida e username diferente do master do RDS; não revalidam por regex host, banco, username ou ARN autoritativos.
Nenhuma representação sensível é gravada em argumento de processo,
arquivo renderizado, artifact, output de job ou log. `api-secret` continua
contendo apenas os JWTs e a chave pública do token de cliente.

As máscaras são uma defesa contra exposição acidental nos logs, pois a senha
obtida da AWS não é um GitHub Secret cadastrado. Elas não ocultam argumentos de
processo: por isso nem `--from-literal=DATABASE_URL` nem `jq --arg` com URL/base64
são usados. Base64 não é criptografia.

Os manifests do Job e do Deployment consomem a mesma chave `DATABASE_URL` de
`database-credentials`. `prisma.config.ts`, seed e runtime da aplicação não
mudam. CI, SAST e build continuam usando apenas a URL fictícia de geração do
Prisma Client e não chamam RDS ou Secrets Manager.

## Alternativas consideradas

| Alternativa | Decisão | Motivo |
| --- | --- | --- |
| Copiar senha/host/ARN para GitHub Secrets ou Variables | Rejeitada | Duplica a origem de verdade e exige sincronização manual. |
| External Secrets Operator | Rejeitada | Introduz controller, CRDs e IAM de workload sem necessidade nesta entrega. |
| Secrets Store CSI Driver com ASCP | Rejeitada | Introduz driver/provider e muda o contrato de montagem/refresh dos Pods. |
| Pods ou Job lendo AWS diretamente | Rejeitada | Exigiria credenciais/IRSA/Pod Identity e permissão Secrets Manager no runtime. |
| Terraform da API lendo `SecretString` | Rejeitada | Levaria a credencial ao Terraform e ao State. |
| URL montada fora do CD e armazenada no GitHub | Rejeitada | Mantém uma credencial derivada de longa duração fora da AWS. |
| Arquivo Node.js auxiliar dedicado | Rejeitada | Acrescentaria um arquivo para uma operação linear já contida no workflow. |
| Rotação automática nesta change | Rejeitada | Exige lifecycle de refresh/retry coordenado; a rotação permanece explicitamente desabilitada. |

## Consequências

### Positivas

- RDS/Secrets Manager permanecem a única origem da master password.
- Nenhum ARN, endpoint ou valor de senha precisa ser sincronizado no GitHub.
- Migration, seed e aplicação recebem exatamente a mesma conexão com TLS.
- O deploy greenfield não precisa transportar versão da credencial entre jobs
  nem manter uma annotation adicional no Deployment.

### Negativas e limites

- O CD depende das APIs RDS e Secrets Manager e falha antes da migration se
  qualquer metadado estiver indisponível.
- O valor é materializado como Secret Kubernetes e fica sujeito às proteções do
  cluster. Esta decisão não adiciona criptografia KMS do etcd.
- A estratégia não dá menor privilégio de banco por consumidor e não habilita
  rotação automática. Ambas exigem nova change.
- Não há renovação automática de Pods por mudança isolada da credencial com a
  mesma imagem; o escopo é greenfield e reexecução com credencial inalterada.
- A Lambda de autenticação continua lendo o mesmo Secret diretamente por ARN;
  seu refresh, retry e pool não são alterados.

## Referências

- [AWS — `DescribeDBInstances`](https://docs.aws.amazon.com/cli/latest/reference/rds/describe-db-instances.html)
- [AWS — `GetSecretValue`](https://docs.aws.amazon.com/cli/latest/reference/secretsmanager/get-secret-value.html)
- [Kubernetes — Secrets](https://kubernetes.io/docs/concepts/configuration/secret/)
- [Kubernetes — Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Prisma 7 — Connection URLs](https://www.prisma.io/docs/orm/v7/reference/connection-urls)
- [Database ADR 0003 — Master password gerenciada pelo RDS](https://github.com/FIAP-15SOAT/oficina-mecanica-infra-database-work-order/blob/main/docs/adr/0003-master-password-gerenciada-pelo-rds.md)
