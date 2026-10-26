# Ids canônicos do seed

UUIDs fixos das entidades que um serviço referencia em outro (usuário, cliente, veículo e itens de catálogo). Cada serviço semeia só os próprios dados, com estes ids, para que as referências entre serviços casem desde o primeiro deploy, sem consulta entre seeds.

A fonte no código é [`app/prisma/seeds/seed-ids.ts`](../app/prisma/seeds/seed-ids.ts): o seed usa o id na criação (`create` do `upsert`), e a linha que já existe mantém o id que tem. Mudar um id aqui quebra as referências nos outros serviços; um registro novo do seed ganha um UUID v4 novo nesta lista e no arquivo.

A coluna **Dono** é o serviço dono da entidade na arquitetura de microsserviços. O seed deste repositório cria todas as linhas da tabela.

| Dono | Entidade | Chave natural | Id | Uso |
| --- | --- | --- | --- | --- |
| identity | Usuário | `guilhermedarochasalvador@gmail.com` | `1c905c27-4c5e-4d85-a53d-914ed8b87bbe` | Login do ADMIN |
| identity | Usuário | `lucas.almeida-silva@hotmail.com` | `9e5ba067-a8a2-4c7c-b597-72db4d7a3d8e` | Login do ADMIN |
| identity | Usuário | `ramooncamacho@hotmail.com` | `2e9e5d67-b47f-48d9-ae4f-8ec95ec2be9f` | Login do ADMIN |
| identity | Usuário | `camacho.renan@gmail.com` | `f0903c59-e803-4b4d-a9a4-850e5bec1eb9` | Login do ADMIN |
| identity | Usuário | `joao.silva@email.com` | `212ca9d7-fa8f-4111-9746-d431da68b063` | Login do cliente por CPF (vinculado ao próprio cadastro 12345678909) |
| identity | Usuário | `maria.souza@email.com` | `6aa85b42-72dd-4ca2-bc94-a1080cfc5a3b` | Login do cliente por CPF (representa a empresa 12345678000195) |
| work-order | Cliente | `12345678909` | `70bb2668-aa3a-4412-afca-198286ca98db` | Dono das OS e dos veículos do seed |
| work-order | Cliente | `98765432100` | `826fd6ab-e5da-4c18-be2b-13fd64843321` | Dono das OS e dos veículos do seed |
| work-order | Cliente | `12345678000195` | `c37a755d-9257-43ad-ae38-890efe884d63` | Dono das OS e dos veículos do seed |
| work-order | Veículo | `ABC-1234` | `4074d524-911a-4e03-a827-d3d0dd01447e` | Veículo das OS do seed |
| work-order | Veículo | `DEF-5678` | `89a190fc-770f-456b-ac45-9e6287accd5a` | Veículo das OS do seed |
| work-order | Veículo | `GHI-9012` | `35ca25b7-50ca-4810-93ba-5397c2f91e66` | Veículo das OS do seed |
| inventory | Serviço | `Troca de óleo` | `3551b3f8-625e-4f2b-b777-a1d0ec4e4585` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Alinhamento e balanceamento` | `ec0e5bf9-cad6-4054-94cb-825e6b89e707` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Revisão completa` | `2758ae13-f327-4935-882d-b48055b6e610` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Troca de pastilhas de freio` | `d5a57c32-0477-419e-abde-8c4c62c6fa78` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Troca de correia dentada` | `74604a72-b8b6-467b-8c65-11ca2bb54e52` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Troca de bateria` | `c992d344-7f2b-45d4-b854-770734140531` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Limpeza de bicos injetores` | `9d1028a2-734a-44d5-90cf-07c62930218f` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Troca de velas de ignição` | `9ac6e329-fd94-439a-bc55-7aa4e45c359f` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Troca de filtro de ar` | `2b475c29-0777-4b55-816a-0664be7f2054` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Troca de filtro de combustível` | `97d99a0d-c1c1-4d6c-b57e-a3a34aecc6ab` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Troca de amortecedores` | `c63e60f6-bc5f-4a5c-adf0-9e1d355ac8a8` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Sangria de freios` | `96a1b6f0-3bbf-4bab-8c30-3c318784679f` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Troca de embreagem` | `16c5ea92-3ed3-4d1d-a4fd-f0a629efe056` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Diagnóstico eletrônico` | `95856429-6e18-4428-8ad7-27d5f4c87296` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Troca de pneus` | `20790818-cf97-4eb6-97b0-0762c2c28611` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Geometria de suspensão` | `5f08b8a3-2448-4135-8102-d894e9680caa` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Troca de óleo de câmbio` | `417823c0-ed8c-45a8-9614-9c586be9857d` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Limpeza de ar-condicionado` | `597dddb5-16b8-4286-a8fe-8a6cafbddb04` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Recarga de ar-condicionado` | `4eb6ea5e-22c6-4870-980d-c1505a1ce2bf` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Troca de disco de freio` | `7bbe9c9f-e9da-44d6-b150-910fc0904cb0` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Polimento de faróis` | `a7497569-9e78-4cca-af22-48b4079337a4` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Troca de radiador` | `d58ff505-c75f-400a-98de-1b8482da289a` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Troca de bomba d'água` | `bfe1600a-b8a5-432b-987e-f83dddfbe73d` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Retífica de motor` | `bf3b9d64-bbdf-44c1-8cfb-93771c472b9a` | Item de catálogo das OS e orçamentos |
| inventory | Serviço | `Martelinho de ouro` | `e9c35c23-293b-4ff1-a063-0d4c701e6fd9` | Item de catálogo das OS e orçamentos |
| inventory | Peça/insumo | `FILT-OL-001` | `361b050f-c441-429d-8a73-dfc12415dc62` | Item de estoque das OS e orçamentos |
| inventory | Peça/insumo | `OLEO-5W30-1L` | `5925a7b0-6fda-4194-ae46-edcfc3066e7a` | Item de estoque das OS e orçamentos |
| inventory | Peça/insumo | `PAST-FR-DI-001` | `02705dbd-d7a7-4ba4-b3cc-31e0c0035107` | Item de estoque das OS e orçamentos |
| inventory | Peça/insumo | `CORR-DEN-001` | `91c7e565-d2bc-4cdc-956a-32f12802828e` | Item de estoque das OS e orçamentos |
| inventory | Peça/insumo | `VELA-IG-001` | `7e61997b-1e0c-42d9-b33a-beec496f0b79` | Item de estoque das OS e orçamentos |
| inventory | Peça/insumo | `FLUID-FR-DOT4` | `aafbda80-5cc0-4a65-a106-3393a631f9d9` | Item de estoque das OS e orçamentos |
| inventory | Peça/insumo | `BAT-60AH-001` | `be2df5a7-92bd-4f4b-b0d5-7953157c48f0` | Item de estoque das OS e orçamentos |
| inventory | Peça/insumo | `CORR-ALT-001` | `33fd9874-8e09-405c-87f0-898c76f386c6` | Item de estoque das OS e orçamentos |
