# ADR 0014: Pipelines de CI, CD, SAST e DAST separados

## Status

Aceito — 2026-09-07. Revisado em 2026-11-16: o SAST e o DAST passaram a ser checks obrigatórios do ruleset da `main` e bloqueiam o merge (não o deploy), a branch principal passou de `master` para `main` e o Terraform saiu deste repositório para os repositórios de infraestrutura da solução.

## Contexto

O enunciado da Fase 2 exige uma "Pipeline de CI/CD: build, testes, imagem Docker, deploy no cluster e aplicação dos manifestos". Além do pipeline funcional, o projeto adotou análise estática de segurança e qualidade (SAST, no SonarQube Cloud, o serviço da SonarSource que analisa o código-fonte) e análise dinâmica (DAST, com o OWASP ZAP, que ataca a API em execução). Cada uma dessas quatro responsabilidades tem gatilho e duração diferentes: validar uma mudança antes do merge não é a mesma operação que entregá-la em produção, e um scan de segurança que sobe uma stack inteira e demora minutos não deveria ter a mesma cadência que testes unitários que rodam em segundos.

O SonarQube Cloud tem ainda uma restrição de plano: o plano gratuito analisa só a branch principal e os Pull Requests para ela, nunca uma branch de trabalho avulsa.

## Decisão

Dividir a automação em **quatro workflows do GitHub Actions**, um por responsabilidade:

| Workflow | Gatilho | Responsabilidade |
|---|---|---|
| **CI** | `push` em `feature/**`/`fix/**` | Validar a mudança (lint, testes unitários, E2E e BDD, build e validação do banco) e abrir o PR |
| **CD** | `push` em `main` (pós-merge) + `workflow_dispatch` (execução manual) | Entrega: build da imagem, migração do banco e deploy no cluster |
| **SAST** | `pull_request` → `main` + `push` em `main` | SonarQube Cloud com espera do quality gate, o conjunto de critérios que aprova ou reprova a análise |
| **DAST** | `pull_request` → `main` + `workflow_dispatch` | OWASP ZAP contra a API em execução |

**O SAST roda no PR e na `main`, não no CI.** O CI dispara no `push` de branch de trabalho, que o plano do SonarQube Cloud não analisa. No Pull Request, a análise aponta só os problemas que o PR introduz em relação à `main`; no `push` na `main`, atualiza a análise da branch principal, que é a referência dessa comparação. O PR é aberto pelo GitHub App do bot, e não pelo `GITHUB_TOKEN` do workflow, porque um PR criado com o `GITHUB_TOKEN` não dispara outros workflows: assim o SAST e o DAST rodam no PR desde o primeiro push.

**O DAST roda no PR.** Ele escaneia o candidato ao merge. Não roda no `push` de branch de trabalho, porque subir a stack inteira a cada commit seria caro e o CI já dá o retorno rápido, nem no `push` na `main`, porque a `main` só recebe código por PR e o scan do PR já cobriu esse código.

**SAST e DAST bloqueiam o merge, não o deploy.** A `main` é protegida por um ruleset, o conjunto de regras de proteção da branch no GitHub, sem bypass (ninguém está isento das regras): ela só recebe merge por PR, feito por uma pessoa, com os checks `Lint`, `Unit Tests`, `E2E Tests`, `BDD`, `Build`, `DB Validation`, `SAST` e `OWASP ZAP API Scan` verdes. O CD dispara no `push` na `main` sem esperar o SAST, então uma análise reprovada na `main` depois do merge não interrompe a entrega.

**A infraestrutura não é provisionada aqui.** Rede, cluster, banco, cache, filas e gateway vivem nos repositórios de Terraform da solução.

## Alternativas consideradas

### Um único workflow monolítico para tudo

Um só arquivo YAML rodando lint, testes, build, scans de segurança e deploy em sequência, sob um único gatilho. Descartado porque:

- Misturaria gatilhos incompatíveis: CI deveria rodar a cada push numa branch de trabalho; CD só deveria rodar após merge na `main`; DAST precisa de uma stack completa em execução, o que é caro para rodar a cada commit de uma feature branch ainda em desenvolvimento.
- Um scan de DAST ou SAST lento bloquearia (ou pelo menos atrasaria) o feedback rápido de lint/testes unitários que o desenvolvedor espera em segundos, não minutos.
- Num único job com tudo, uma falha não diria de saída se o problema foi de qualidade de código, de teste ou de vulnerabilidade.

### SAST no CI, nas branches de trabalho

Analisar o código a cada `push` em `feature/**` e `fix/**`, junto dos outros jobs do CI. Descartado porque o plano gratuito do SonarQube Cloud só analisa a branch principal e os Pull Requests para ela: a análise de uma branch de trabalho não teria resultado acessível. Rever se o plano mudar para um que analise qualquer branch (Team ou Enterprise).

### SAST e DAST informativos, sem bloquear o merge

Era a decisão original deste ADR: os dois rodavam em paralelo e só publicavam o relatório. Descartado porque um achado real podia ser mesclado se ninguém lesse o relatório. Os dois motivos da escolha original passaram a ser custos aceitos: uma indisponibilidade do SonarQube Cloud ou um falso positivo do ZAP param o merge até alguém reexecutar o check ou tratar o achado, e o DAST atrasa o merge em alguns minutos, sem atrasar o retorno do CI, que roda antes de o PR existir. Rever se a indisponibilidade ou o limite do plano passarem a travar PRs sem achado real.

### SAST e DAST também como gates do deploy

O CD esperaria o resultado dos dois na `main` antes de entregar. Descartado porque o código só chega à `main` depois de passar pelos dois no PR, e o DAST não roda na `main`: esperar a análise do SAST da `main` atrasaria toda entrega para pegar só o que a análise do PR não pegou.

### CD acoplado ao CI via `workflow_run`

O CD seria disparado pelo evento de conclusão do CI, em vez de por push direto na `main`. Descartado em favor de gatilho direto por `push`/`workflow_dispatch`, com a ordem interna de jobs do CD garantida por `needs:` — evita a complexidade adicional (e a depuração mais difícil) de acoplar dois workflows por evento de conclusão, quando o próprio fluxo de branch protegida (`main` só recebe merge via PR com CI verde) já garante que todo push em `main` passou pelo CI antes.

## Consequências

### Positivas

- **Feedback rápido não espera os scans**: o CI responde no push da branch; SAST e DAST rodam depois, no PR, em paralelo entre si.
- **Cada workflow tem gatilho e escopo únicos, mais fáceis de raciocinar isoladamente**: um problema de deploy é depurado no CD; um achado de segurança, no SAST/DAST — sem misturar logs de responsabilidades diferentes num único job gigante.
- **Nenhum achado do SAST ou do DAST entra na `main` sem ser tratado**: o PR só é mesclado depois de o problema ser corrigido, marcado como falso positivo no SonarQube Cloud ou registrado no `.zap/rules.tsv` com o motivo de o alerta não se aplicar.

### Negativas / Trade-offs

- **Indisponibilidade ou falso positivo param o merge**: SonarQube Cloud fora do ar, limite do plano ou alerta do ZAP que não se aplica deixam o PR bloqueado até alguém reexecutar o check ou tratar o achado.
- **O DAST alonga o PR**: sobe a stack inteira e faz um scan ativo de minutos antes do merge.
- **Uma análise reprovada na `main` não para o deploy**: o SAST da `main` roda em paralelo ao CD.
- **Quatro arquivos de workflow para manter em vez de um**: mudanças que afetam mais de uma responsabilidade (ex.: uma nova env var usada tanto no CI quanto no CD) precisam ser replicadas em mais de um lugar.
- **Sem coordenação nativa entre os quatro**: um DAST rodando contra uma versão do código diferente da que o CD acabou de implantar é possível (gatilhos independentes) — mitigado por DAST rodar contra o PR (candidato ao merge), não contra produção.

### Riscos mitigados

- **Vulnerabilidade mesclada sem ninguém ler o relatório**: mitigado por SAST e DAST como checks obrigatórios do ruleset da `main`.
- **Ciclo de desenvolvimento lento por scans de segurança**: mitigado por rodá-los no PR, depois do CI, e não a cada push.

## Referências

- [`docs/infra/ci-cd.md`](../infra/ci-cd.md) — os quatro workflows, gatilhos, jobs e secrets.
- [SonarQube Cloud — planos](https://docs.sonarsource.com/sonarqube-cloud/administering-sonarcloud/managing-subscription/subscription-plans) — análise de branch e de Pull Request em cada plano.
