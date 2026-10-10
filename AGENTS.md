# Orientação rápida para agentes

Este arquivo vale para o projeto Atende na raiz. Leia primeiro [`docs/README.md`](docs/README.md) e somente o guia do assunto que será alterado. O código é a fonte de verdade; a documentação é o mapa para encontrá-lo rapidamente. `openwa/` contém um projeto-base personalizado, com documentação própria em `openwa/docs/`; não confunda o painel dele com a interface Atende em `app/`.

| Se a tarefa envolve... | Comece em... |
| --- | --- |
| Instalação, Docker, ambientes, portas, backup ou volumes | `README.md`, `docker-compose.yml` (produção), `docker-compose.dev.yml` (criação), `docs/MIGRACAO_VOLUME_MIDIA.md` |
| Navegação, conversas, notificações ou envio de mídia | `docs/ARQUITETURA_E_ESTADO_ATUAL.md` → `app/page.tsx` e `app/conversations/` → `openwa/src/modules/message/` |
| Contatos, etiquetas, permissões ou dashboard | `docs/ATENDIMENTOS.md`, `app/contacts-panel.tsx`, `app/conversations/contact-creation.ts` (cadastro na conversa), `app/ticket-dashboard.tsx`, `openwa/src/modules/operator-auth/` |
| Automações ou Google Sheets | `docs/AUTOMACOES.md`, `app/automation-settings.tsx`, `openwa/src/modules/operator-auth/sheet-automation.controller.ts` |
| Webhooks | `docs/ARQUITETURA_E_ESTADO_ATUAL.md` (seção Webhooks), `app/system-webhooks.tsx`, `openwa/src/modules/webhook/` |
| Recuperação de senha | `docs/RECUPERAR-ACESSO.md` |

## Manutenção obrigatória da documentação

Ao criar, remover ou mudar comportamento, API, variável de ambiente, fluxo, campo, persistência ou modo de instalação, atualize **na mesma alteração** o guia específico e, se o mapa de localização mudar, `docs/ARQUITETURA_E_ESTADO_ATUAL.md` e o índice `docs/README.md`. Se mudar a instalação para quem clona o projeto, atualize também o `README.md` da raiz e `.env.example` quando aplicável. Não crie outro arquivo Markdown para repetir um assunto já coberto: amplie o guia canônico. Corrija links após mover arquivos e registre limitações reais, não funcionalidades planejadas como se existissem.

## Segurança e verificação

- Confira `git status` antes de editar; preserve alterações e dados locais. Nunca remova volumes, banco, mídia ou sessão para "limpar" o projeto.
- A branch `main` e seu checkout são da **produção**; a branch `develop` fica no checkout irmão `atende-desenvolvimento` e constrói o projeto Docker `atende-dev`. Confirme a branch e a pasta antes de editar ou compilar. Use `docker compose --env-file .env.dev -f docker-compose.dev.yml` no checkout `develop` para validar sem afetar os atendentes. `docker compose` sem `-f` aponta para a **produção**; não faça rebuild/recreate nela para testes. O ambiente de criação mantém API e bancos sem saída externa; consulte o README antes de qualquer teste que envolva WhatsApp ou planilhas reais.
- Com número WhatsApp exclusivo de testes, `docker-compose.dev-whatsapp.yml` e `scripts/enable-dev-whatsapp.ps1` liberam a rede apenas para o OpenWA de criação. Nunca copie a sessão autenticada da produção nem pareie seu número nesse clone.
- Mensagens de commit e comunicação com o usuário devem ser em português. Não faça push nem envie mensagens reais a clientes sem pedido explícito.
- Para alterações na API, execute testes relevantes e `docker compose --env-file .env.dev -f docker-compose.dev.yml build openwa`; para interface, compile `web` nesse ambiente. Confira `docker compose --env-file .env.example config --quiet` e `docker compose --env-file .env.dev.example -f docker-compose.dev.yml config --quiet` quando alterar implantação. O lint do frontend possui apontamentos existentes; não confunda build aprovado com lint aprovado.
- Não copie `.env`, chaves, tokens, dados de clientes ou conteúdo de conversas para documentação, testes ou logs.

As instruções de `openwa/AGENTS.md`, se existirem futuramente, podem complementar este arquivo para mudanças no projeto-base; a documentação de `openwa/docs/` permanece separada da documentação do Atende.
