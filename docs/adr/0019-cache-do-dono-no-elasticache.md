# ADR 0019: Cache do dono no ElastiCache

## Status

Aceito — 2026-10-25

## Contexto

Com a divisão em serviços, o detalhe da ordem de serviço passa a ser lido também por outros serviços, pela rota interna `GET /internal/work-orders/:id`, além das telas da oficina. A leitura do detalhe carrega a OS com cliente, veículo, serviços, peças e orçamentos: várias junções a cada chamada.

Cada serviço é o único cliente do próprio banco e do próprio cache. Um dado só fica certo em cache se quem o guarda souber quando ele muda, e só o dono da entidade sabe disso.

O cache não pode virar dependência dura: com ele fora do ar, a API precisa continuar respondendo pelo banco.

## Decisão

**Cache-aside no ElastiCache for Valkey do próprio serviço, só no dono, com invalidação no caso de uso depois do commit.**

1. **Porta e adaptador.** A porta `ICache` (`get`, `set` com TTL, `delete(keys[])`) fica em `application/ports/output/`; o `ValkeyCacheAdapter` usa `ioredis` por `CACHE_URL` (`rediss://` com senha no cluster, `redis://` local).
2. **O detalhe da OS é o primeiro valor em cache**, na chave `work-order:work-order:<id>`, com TTL de 12 h. O valor é um snapshot versionado (`cacheVersion`) montado pelo `WorkOrderCacheMapper`, sem o usuário atribuído, que é buscado por id a cada leitura. Valor ilegível ou de outra versão conta como falta.
3. **A invalidação é do caso de uso, depois do commit**: toda escrita na OS, no cliente ou no veículo apaga as chaves afetadas com o resultado devolvido do callback da transação, o mesmo padrão dos eventos de negócio.
4. **Falha do cache vira leitura no banco.** O cliente roda sem fila offline, com uma tentativa e `commandTimeout` de 500 ms; falha de leitura registra `cache.unavailable` e conta como falta, falha de exclusão registra `cache.invalidation_failed` e a chave expira pelo TTL.
5. **Escrita em serviço ou peça não invalida o detalhe das OS.** Nome, descrição, SKU, unidade e categoria dos itens podem ficar até 12 h desatualizados no cache; preço, quantidade, total e status não, porque o item da OS guarda o próprio preço.

## Alternativas consideradas

| Alternativa | Trade-off | Rever se |
| --- | --- | --- |
| Valkey em pod no cluster, ou DynamoDB | Pod custa nada a mais, mas fica dentro do cluster, sem gestão; DynamoDB não tem TTL exato nem contador atômico para os outros usos do cache | — |
| ElastiCache Serverless | Sem dimensionamento, mas indisponível no ambiente da AWS usado pela solução | O ambiente liberar o serviço |
| Cache em quem consome (30 a 60 s) | Poupa a chamada interna, mas quem consome não sabe quando o dado muda e serve dado velho sem ter como invalidar | — |
| TTL de 10 min ou de 24 h | 10 min derruba a taxa de acerto; 24 h deixa os nomes de catálogo velhos por mais tempo sem ganho, já que 12 h cobre uma sessão de uso | — |
| Invalidação centralizada nos repositórios ou no Unit of Work | Ninguém esquece de invalidar, mas a regra sai do caso de uso e do padrão dos efeitos depois do commit, para cobrir um esquecimento que o code review já pega | A carga crescer e escritas sem invalidação aparecerem |
| Segundo `DEL` atrasado, ou `SET` condicionado por versão | Fecha a corrida entre leitura que regrava valor velho e escrita que apaga, a um custo de código e de comandos desprezível nesta carga | A carga crescer |
| Invalidar o detalhe das OS em escrita de serviço ou peça | Nomes de catálogo sempre atuais, mas exige busca reversa das OS que têm o item, que cresce com o histórico da oficina a cada edição de catálogo | O catálogo continuar neste serviço por muito tempo, ou o nome do item passar a ter efeito legal ou financeiro no detalhe |
| Reler o catálogo a cada leitura em cache | Nomes sempre atuais, com consultas a mais no caminho mais quente | — |
| Guardar o usuário atribuído no snapshot | Uma consulta a menos por leitura, mas leva o hash de senha ao cache e deixa o nome do mecânico velho, porque escrita em usuário não invalida o cache | — |
| `@nestjs/cache-manager` (com `@keyv/redis`) | Integração pronta com o Nest, mas: o `ioredis` e a instrumentação dele já estão fixados; o `@keyv/redis` não tem prazo por comando, e um Valkey que aceita TCP e não responde travaria a leitura; o `throwOnErrors: false` não distingue falha de leitura de falha de invalidação; a porta e o adaptador continuariam necessários; o `CacheInterceptor` guarda a resposta inteira por URL, e o cache em memória por réplica serve dado velho sem invalidação entre réplicas | For preciso um cache em memória sem invalidação entre réplicas |

## Consequências

### Positivas

- A leitura do detalhe sai do cache na maior parte das vezes, para as telas e para os outros serviços.
- O dado em cache só muda por quem o escreve: não há invalidação entre serviços.
- Um Valkey fora do ar ou lento não derruba nem trava a API.
- Um deploy que muda o formato do snapshot não responde 500: o valor antigo vira falta.

### Negativas e limites

- Toda escrita nova em OS, cliente ou veículo precisa apagar as chaves; o esquecimento serve dado velho por até 12 h.
- Nomes de itens de catálogo podem ficar até 12 h desatualizados no detalhe das OS.
- A corrida entre uma leitura que regrava valor velho e uma escrita que apaga continua possível, com janela de milissegundos.
- O ElastiCache é mais um recurso pago e provisionado por serviço.

## Referências

- [Arquitetura — Cache do detalhe da OS](../architecture.md#cache-do-detalhe-da-os)
- [Valkey](https://valkey.io/)
- [AWS — Amazon ElastiCache for Valkey](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.html)
- [ioredis](https://github.com/redis/ioredis)
- [Cache-aside](https://learn.microsoft.com/azure/architecture/patterns/cache-aside)
