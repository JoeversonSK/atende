# Orientação rápida para agentes

Este arquivo vale para o projeto Atende na raiz. Leia primeiro [`docs/README.md`](docs/README.md) e somente o guia do assunto que será alterado. O código é a fonte de verdade; a documentação é o mapa para encontrá-lo rapidamente. `openwa/` contém um projeto-base personalizado, com documentação própria em `openwa/docs/`; não confunda o painel dele com a interface Atende em `app/`.

| Se a tarefa envolve... | Comece em... |
| --- | --- |
| Instalação, Docker, portas, backup ou volumes | `README.md`, `docker-compose.yml`, `docs/MIGRACAO_VOLUME_MIDIA.md` |
| Navegação, conversas, notificações ou envio de mídia | `docs/ARQUITETURA_E_ESTADO_ATUAL.md` → `app/page.tsx` e `app/conversations/` → `openwa/src/modules/message/` |
| Contatos, etiquetas, permissões ou dashboard | `docs/ATENDIMENTOS.md`, `app/contacts-panel.tsx`, `app/ticket-dashboard.tsx`, `openwa/src/modules/operator-auth/` |
| Automações ou Google Sheets | `docs/AUTOMACOES.md`, `app/automation-settings.tsx`, `openwa/src/modules/operator-auth/sheet-automation.controller.ts` |
| Webhooks | `docs/ARQUITETURA_E_ESTADO_ATUAL.md` (seção Webhooks), `app/system-webhooks.tsx`, `openwa/src/modules/webhook/` |
| Recuperação de senha | `docs/RECUPERAR-ACESSO.md` |

## Manutenção obrigatória da documentação

Ao criar, remover ou mudar comportamento, API, variável de ambiente, fluxo, campo, persistência ou modo de instalação, atualize **na mesma alteração** o guia específico e, se o mapa de localização mudar, `docs/ARQUITETURA_E_ESTADO_ATUAL.md` e o índice `docs/README.md`. Se mudar a instalação para quem clona o projeto, atualize também o `README.md` da raiz e `.env.example` quando aplicável. Não crie outro arquivo Markdown para repetir um assunto já coberto: amplie o guia canônico. Corrija links após mover arquivos e registre limitações reais, não funcionalidades planejadas como se existissem.

## Segurança e verificação

- Confira `git status` antes de editar; preserve alterações e dados locais. Nunca remova volumes, banco, mídia ou sessão para "limpar" o projeto.
- Mensagens de commit e comunicação com o usuário devem ser em português. Não faça push nem envie mensagens reais a clientes sem pedido explícito.
- Para alterações na API, execute testes relevantes e `docker compose build openwa`; para interface, compile `web`. Confira `docker compose --env-file .env.example config --quiet` quando alterar implantação. O lint do frontend possui apontamentos existentes; não confunda build aprovado com lint aprovado.
- Não copie `.env`, chaves, tokens, dados de clientes ou conteúdo de conversas para documentação, testes ou logs.

As instruções de `openwa/AGENTS.md`, se existirem futuramente, podem complementar este arquivo para mudanças no projeto-base; a documentação de `openwa/docs/` permanece separada da documentação do Atende.
