# Arquitetura e estado atual do Atende

Atualizado em 08/10/2026. Este arquivo é um **mapa do código existente**, não uma especificação de funcionalidades ainda não implementadas. Antes de alterar algo, confira o estado atual com `git status`, leia os arquivos indicados e confirme os fluxos em execução. O repositório pode conter alterações locais não commitadas. O índice canônico está em [`docs/README.md`](README.md); o roteiro curto para agentes está em [`AGENTS.md`](../AGENTS.md).

## 1. O que é o sistema

O Atende é uma central de atendimento multiusuário conectada ao WhatsApp. O operador usa um painel web para conversar com contatos, enviar mídia, responder/encaminhar mensagens, organizar contatos e atribuir/concluir atendimentos. Administradores configuram equipe, permissões, fluxos, mensagens rápidas, horário de funcionamento, automações por planilha e webhooks. O painel operacional mostra fila, atendimentos, tempos e disponibilidade dos operadores.

```
Navegador → web :3000 (ou HTTPS :443)
              ├─ interface React/vinext
              └─ proxy /api e /socket.io → openwa :2785
                                          ├─ PostgreSQL: dados operacionais
                                          ├─ SQLite local: chaves/API e auditoria do OpenWA
                                          ├─ Redis: presença/eventos/cache
                                          └─ WhatsApp Web via navegador Chromium
```

O `docker-compose.yml` da **raiz** é o ambiente Atende usado aqui. Existe outro Compose em `openwa/`, pertencente ao projeto-base, que não substitui o da raiz. O OpenWA possui um dashboard próprio em `openwa/dashboard/`; **a interface Atende mostrada aos usuários está em `app/`**, não nesse dashboard. A interface do OpenWA é compilada dentro da imagem `openwa` e servida como arquivos estáticos pelo processo da API; não há um quinto serviço Docker para ela. `SERVE_DASHBOARD=false` impede servi-la, mas o Dockerfile atual ainda a compila e copia, portanto essa variável sozinha não reduz significativamente o tamanho da imagem. O Atende depende da API do OpenWA, não do seu dashboard.

### Estado funcional em 06/10/2026

- **Atendimento:** caixa compartilhada, histórico de texto e mídia, resposta vinculada a uma mensagem, encaminhamento de mensagens a contatos, atribuição e conclusão de conversas, chat interno e notificações. Arquivos colados na conversa passam por prévia e confirmação antes do envio.
- **Contatos e equipe:** cadastro/importação de contatos, notas, etiquetas e campos personalizados; filtro de várias etiquetas com opção de exigir todas ou aceitar qualquer uma; contas, permissões e destinatários de notificações. A equipe pode informar indisponibilidade e registrar início/fim de atendimento externo.
- **Dashboard:** fila, atendimentos em andamento e concluídos, tempos, atividade dos atendentes e modo de tela cheia. Consulte o guia de atendimentos para as regras de contagem; não infira métricas apenas pela aparência da tela.
- **Configurações:** expediente e resposta fora de horário, mensagens rápidas, fluxos de conversa, preferências de notificação e áudio personalizado por usuário, integração com Google Sheets privado e webhooks genéricos.
- **Implantação:** quatro serviços no Compose da raiz (`web`, `openwa`, `postgres`, `redis`). O painel do OpenWA ainda é compilado na imagem da API, mesmo que a interface operacional seja o Atende. A separação dele foi avaliada como possibilidade de otimização, mas não foi implementada.

**Limites a considerar:** o projeto usa WhatsApp Web, sujeito a mudanças externas; notificações nativas precisam de contexto HTTPS ou `localhost`; a automação de planilhas requer credenciais locais e não deve ser testada enviando mensagens reais sem autorização. Em 07/10/2026, a checagem de tipos, os testes direcionados e o build do painel passaram. A atualização das dependências eliminou o aviso de chunk Excel acima de 500 kB e o `npm audit --omit=dev` ficou sem vulnerabilidades. A auditoria completa ainda reporta 12 apontamentos em ferramentas de desenvolvimento, principalmente dependências transitivas sem correção compatível (`braces`/`micromatch` e `drizzle-kit`/`esbuild`); não use `npm audit fix --force`, que propõe versões incompatíveis. `eslint.config.mjs` mantém ativa a regra de imagens do Next para as demais telas, mas a desliga apenas nos componentes que precisam exibir URLs dinâmicas de WhatsApp, QR Code ou prévias `blob:`/`data:`; esta interface não usa o otimizador de imagens do Next. A checagem global com `tsconfig.json` inclui também o OpenWA e seu dashboard, que precisam de verificação separada com as dependências próprias. Esses números são registros datados, não garantias sobre alterações futuras.

## 2. Primeiros arquivos a ler

| Assunto | Arquivo/pasta |
| --- | --- |
| Instalação local e portas | `README.md`, `docker-compose.yml`, `.env.example` |
| Interface, navegação, sessão, conversas e envio | `app/page.tsx`, `app/conversations/`, `openwa/src/modules/message/` |
| Tela de login e Ajustes | `app/account-panels.tsx` |
| Módulos da API | `openwa/src/app.module.ts` |
| Autenticação e dados da equipe | `openwa/src/modules/operator-auth/operator-auth.service.ts` |
| Contatos, perfil e painel | `openwa/src/modules/operator-auth/contact-profile.controller.ts` |
| Automações da planilha | `docs/AUTOMACOES.md`, `openwa/src/modules/operator-auth/sheet-automation.controller.ts` |
| Webhooks genéricos | `app/system-webhooks.tsx`, `openwa/src/modules/webhook/` |
| Regras do painel operacional | `docs/ATENDIMENTOS.md`, `app/ticket-dashboard.tsx` |
| Documentação do motor OpenWA | `openwa/docs/README.md` e demais arquivos em `openwa/docs/` |

## 3. Estrutura do repositório

### Raiz e implantação

- `docker-compose.yml`: serviços `web`, `openwa`, `postgres` e `redis`; volumes persistentes; variáveis de ambiente; portas. `openwa` só publica a porta em `127.0.0.1:2785` no host; os demais computadores devem acessar o painel, não essa porta. `atende-postgres`, `atende-redis`, `atende-openwa` (sessão) e `atende-media` (anexos) são volumes distintos.
- `Dockerfile`: compila o painel web, remove as dependências exclusivas de desenvolvimento antes de montar a imagem final e executa o gateway com `wrangler` como dependência de produção. `.dockerignore` exclui configuração local, certificados gerados e pastas de saída do contexto de build, sem apagar esses arquivos do computador. `scripts/local-gateway.mjs` serve uma origem única: encaminha `/api` e `/socket.io` ao OpenWA e o restante à interface. Isto evita que outros computadores tentem acessar `localhost:2785` da própria máquina.
- `.env.example`: exemplo das variáveis obrigatórias e integrações opcionais. `.env` real não deve entrar no Git. Segredos da planilha, chave mestra e senhas ficam no servidor.
- `docker/postgres-init/`: SQL executado **somente na criação de um volume PostgreSQL novo**; não é mecanismo de migração de uma instalação já existente.
- `scripts/create-local-https.ps1`: certificado HTTPS local. Microfone e notificações de sistema em outros computadores exigem contexto seguro.
- `package.json`: scripts do painel. `openwa/package.json`: scripts da API e do projeto-base.

### Painel Atende (`app/`)

| Arquivo | Responsabilidade |
| --- | --- |
| `page.tsx` | Orquestra navegação, estado compartilhado e composição das telas. Os fluxos de sincronização, envio, atribuição, conexão, encaminhamento e criação de contatos ficam em módulos próprios de `conversations/`. |
| `conversations/components/` | Componentes visuais da caixa de entrada: barra lateral e filtros, histórico e mídia, compositor, perfil, avatar, prévia de arquivos colados e janelas de confirmação, encaminhamento e novo contato. `workspace-chrome.tsx` reúne cabeçalho, navegação e estado inicial; `workspace-alerts.tsx` exibe avisos; `conversation-pane.tsx` reúne cabeçalho, histórico e compositor da conversa. |
| `conversations/contact-list.ts` | Montagem pura do diretório a partir de chats e perfis, reconciliação conservadora de LID com perfil importado, etiquetas disponíveis e busca de destinatários para encaminhamento. Testes em `scripts/test-contact-list.mjs`. |
| `conversations/conversation-sync.ts` | Busca paginada dos chats, modo com WhatsApp indisponível, fotos de perfil, confirmação de leitura e montagem da lista com leitura otimista. Testes em `scripts/test-conversation-sync.mjs`. |
| `conversations/conversation-history.ts` | Busca do histórico local/ao vivo, fallback e reconciliação dos registros; cria, confirma e descarta mensagens otimistas durante a atualização. Testes no mesmo arquivo de sincronização. |
| `conversations/contact-creation.ts` | Validação do nome/telefone e persistência de um contato iniciado pela conversa; preserva os demais campos e a revisão do perfil. Testes em `scripts/test-contact-creation-and-account.mjs`. |
| `conversations/message-delivery.ts`, `flow-variables.ts` | Transporte de texto e mídia (inclusive áudio de voz) e substituição dos campos automáticos dos fluxos. Testes em `scripts/test-message-delivery.mjs`. |
| `conversations/flow-execution.ts` | Executa sequencialmente blocos de fluxo, pausas, enquetes e continuação, atribuição, fechamento e avaliação. Devolve os resultados à tela por callbacks; a autorização, os avisos e o estado visual permanecem em `page.tsx`. Testes em `scripts/test-flow-execution.mjs`, sem envio real. |
| `conversations/conversation-forwarding.ts` | Encaminhamento sequencial para até dez destinatários selecionados na tela; retorna sucessos e falhas individuais para manter selecionados só os que precisam de nova tentativa. Testes em `scripts/test-conversation-forwarding.mjs`. |
| `conversations/use-message-forwarding.ts`, `use-contact-creation.ts` | Estado e ações da interface de encaminhamento e de novo contato; usam os serviços de domínio existentes, preservando erros e resultados por destinatário. |
| `conversations/conversation-actions.ts` | Orquestra envio de texto com mensagem otimista, mídia, fluxos e confirmação de conteúdo colado. Não altera o transporte (`message-delivery.ts`) nem a execução dos blocos (`flow-execution.ts`). |
| `conversations/use-conversation-sync.ts` | Carregamento e reconciliação dos chats, histórico, atribuições, confirmação de leitura e controle de consultas simultâneas. Os dados continuam em `conversation-sync.ts`, `conversation-history.ts` e `ticket-actions.ts`. |
| `conversations/use-ticket-actions.ts` | Estado e ações de atribuir, remover atribuição e concluir atendimento; usa `ticket-actions.ts` para as requisições e mantém os dados do painel em sincronia. |
| `conversations/use-workspace-connection.ts` | Recuperação da conexão da equipe, salvar/restaurar sessão existente, criar sessão e ler QR Code. Usa `session-connection.ts` para as chamadas à API. |
| `conversations/session-connection.ts` | Consultas de saúde/sessão, restauração da sessão existente, criação e leitura do QR Code. `page.tsx` decide quando persistir a configuração e atualizar a tela; a consulta redundante aos dados da conta foi removida. Testes em `scripts/test-conversation-operations.mjs`. |
| `conversations/ticket-actions.ts` | Listagem de atribuições, leitura, atribuição, remoção e encerramento de atendimentos; retorna os dados de reabertura ou perfil sem manipular o estado React. Testes em `scripts/test-conversation-operations.mjs`. |
| `conversations/use-conversation-events.ts` | Assinatura Socket.IO, reconexão e processamento de eventos de chats, QR Code e avisos; a tela ainda decide como mostrar a notificação. |
| `conversations/use-voice-recorder.ts` | Ciclo do MediaRecorder e entrega do áudio gravado ao controlador da conversa. |
| `conversations/use-notification-settings.ts` | Hook das preferências do navegador, áudio personalizado por usuário, reprodução, ativação e teste das notificações. `page.tsx` continua decidindo quando avisar por eventos das conversas e da equipe. |
| `conversations/workspace-storage.ts` | Tipos, valores iniciais e persistência local da conexão, sessão do operador e preferências de notificação. Não é armazenamento de histórico de conversas. |
| `atende-api.ts` | Cliente HTTP compartilhado: origem `/api`, cabeçalhos do Atende, leitura do token e tratamento uniforme de erros; `operatorRequest` preserva a resposta HTTP e `operatorJson<T>` tipa a resposta JSON. |
| `conversation-model.ts` | Tipos e transformações puras de conversas/mensagens, incluindo identificação de mensagens, prévias de mídia e reconciliação. |
| `operator-activity.tsx` | Estado, requisições e controle visual da atividade do operador e dos atendimentos externos. |
| `operator-account.ts` | Requisições de login, atualização do nome do operador e saída; estado visual e armazenamento local permanecem em `page.tsx`. Testes em `scripts/test-contact-creation-and-account.mjs`. |
| `workspace-polling.ts` | Agenda única para atualização da equipe, validade do acesso e reconciliação de conversas. Impede consultas sobrepostas da mesma tarefa e cancela o ciclo ao trocar de sessão. |
| `account-panels.tsx` | Login, navegação e conteúdo de Ajustes; horário de funcionamento, perfil e notificações. |
| `contacts-panel.tsx`, `contact-editor.tsx`, `contact-import.tsx`, `contact-profile.tsx` | Diretório, criação/edição, importação e perfil detalhado do contato. O `.xlsx` é lido sob demanda por `read-excel-file/browser`; `scripts/test-contact-import.mjs` exercita a primeira aba com dados sintéticos. |
| `ticket-dashboard.tsx`, `dashboard-model.ts` | Dashboard, filtros e transformação dos dados operacionais. |
| `team-chat.tsx`, `team-chat.css` | Chat interno, sala geral e conversas individuais. |
| `team-settings.tsx` | Contas da equipe, permissões e destinatários de avisos sem responsável. |
| `quick-replies.tsx`, `flow-settings.tsx` | Mensagens rápidas e fluxos automáticos de conversa. |
| `automation-settings.tsx` | Cadastro manual/mensal de automações, mapeamento de colunas, prévia, iniciar/pausar/avançar etapa. |
| `webhook-settings.tsx`, `system-webhooks.tsx` | Avisos simples para Discord/JSON e integrações HTTP genéricas por evento. |
| `modern.css`, `workspace.css`, `contacts.css`, `globals.css` | Estilos; confira seletores existentes antes de duplicar regras. |
| `message-reconciliation.ts` | Reconciliação de mensagens no cliente. |
| `connection-origin.ts` | Converte endereço local antigo da API para a origem atual do navegador. |

A navegação principal não usa páginas independentes para cada recurso: `app/page.tsx` mantém estados como `contactsOpen`, `teamChatOpen`, `dashboardOpen` e `settingsOpen`; `SettingsScreen` em `account-panels.tsx` alterna suas abas. Para mudanças visuais na conversa, comece por `conversations/components/`; para sincronização e histórico, consulte `use-conversation-sync.ts`, `conversation-sync.ts` e `conversation-history.ts`; para envio e confirmação de colagem, `conversation-actions.ts` e `message-delivery.ts`; para encaminhamento, `use-message-forwarding.ts` e `conversation-forwarding.ts`; para cadastro iniciado na conversa, `use-contact-creation.ts` e `contact-creation.ts`. Avisos em tempo real e gravação de voz estão em `use-conversation-events.ts` e `use-voice-recorder.ts`; preferências de som ficam em `use-notification-settings.ts`. Para seleção e estados compartilhados da tela, comece por `page.tsx`. A tela principal usa `atende-api.ts` para todas as requisições HTTP; `request()` acrescenta `X-API-Key` e `X-Atende-Token`, enquanto `operatorRequest`/`operatorJson<T>` são usados também pelas telas de equipe, fluxos, mensagens rápidas, expediente e webhooks. Outros módulos de contatos e automações ainda têm chamadas específicas próprias. `workspace-polling.ts` conserva as frequências de equipe (4 s), validação do acesso (15 s) e reconciliação visível (15 s, condicionada ao intervalo desde a última atualização), mas as agenda por um só temporizador sem sobreposição por tarefa.

Para mudanças na conexão com a sessão WhatsApp ou nas operações de atribuir/encerrar, comece respectivamente por `app/conversations/use-workspace-connection.ts`/`session-connection.ts` e `app/conversations/use-ticket-actions.ts`/`ticket-actions.ts`; `page.tsx` conserva a navegação e os estados compartilhados.

O disparo manual de um fluxo começa em `conversation-actions.ts` (permissão, destinatário e aviso), passa por `flow-variables.ts` para preencher os campos e por `flow-execution.ts` para enviar os blocos na ordem configurada. A execução interrompe após erro e, na enquete, grava os blocos seguintes para continuação após a resposta. Os callbacks devolvem atribuição e perfil encerrado à tela; não testem essa sequência com clientes reais apenas para validar a interface.

### API e WhatsApp (`openwa/`)

- `openwa/src/main.ts` e `openwa/src/app.module.ts`: inicialização NestJS, configuração, bancos, módulos e prefixo de API. Consulte-os ao registrar controladores/provedores.
- `openwa/src/modules/operator-auth/`: adaptações principais do Atende para contas, permissões, contatos, chat da equipe e automações. `operator-auth.module.ts` registra essas peças. Os controladores são acessados sob `/api/operator-auth/...`.
- `openwa/src/modules/message/`: envio, consulta e processamento de mensagens. Rotas principais sob `/api/sessions/:sessionId/messages`.
- `openwa/src/modules/session/`: sessões WhatsApp e atribuições de conversas.
- `openwa/src/modules/events/`: eventos em tempo real/Socket.IO. Mudanças aqui precisam considerar repetição de notificações e limites de consultas.
- `openwa/src/modules/webhook/`: cadastro, entrega, tentativas, outbox, assinatura, filtros e falhas de webhooks. `system-webhook.controller.ts` adapta a administração pela conta Atende, sob `/api/operator-auth/admin/system-webhooks`; `webhook.controller.ts` contém a API original por sessão/chave de API.
- `openwa/src/engine/`: abstração e adaptadores de WhatsApp. O Compose da raiz usa `ENGINE_TYPE=whatsapp-web.js`; há também código Baileys no projeto-base. Verifique a interface do motor antes de depender de uma capacidade de mensagem/mídia.
- `openwa/src/database/migrations/`: migrações do banco de dados do OpenWA. `1791244800000-CreateAtendeNotificationWebhooks.ts` passou a ser a única responsável por criar `openwa.notification_webhooks` em PostgreSQL, de forma idempotente e sem apagar registros existentes; a importação opcional do webhook legado continua no serviço de autenticação. Outras tabelas operacionais do Atende ainda são criadas ou ampliadas em `onModuleInit`/rotinas de inicialização; não assuma que todas têm migração TypeORM.
- `openwa/openapi.json`: contrato gerado da API. `npm run openapi:export` em `openwa/` o atualiza; confira o diff, pois a exportação pode incluir alterações de rotas anteriores não refletidas no snapshot.

## 4. Funcionalidades e caminhos de ponta a ponta

| Recurso | Interface | API/serviço |
| --- | --- | --- |
| Login, perfil, permissões, disponibilidade e atendimento externo | `page.tsx`, `account-panels.tsx`, `team-settings.tsx` | `operator-auth.controller.ts` + `operator-auth.service.ts` |
| Conversas WhatsApp, texto, áudio, arquivos, resposta e encaminhamento | `page.tsx`, `conversations/` | `modules/message/`, `modules/session/`, `engine/` |
| Contatos, etiquetas, campos personalizados e importação | `contacts-*`, `contact-profile.tsx` | `contact-profile.controller.ts`, `contact-import.controller.ts` |
| Fila, responsáveis, conclusão e métricas | `ticket-dashboard.tsx`, `dashboard-model.ts` | `contact-profile.controller.ts` e atribuições em `modules/session/` |
| Chat da equipe | `team-chat.tsx` | `team-chat.controller.ts` |
| Atividade e atendimento externo | `operator-activity.tsx` | `operator-auth.controller.ts`/`operator-auth.service.ts` |
| Mensagens rápidas, fluxos e expediente | `quick-replies.tsx`, `flow-settings.tsx`, `account-panels.tsx` | `operator-auth.controller.ts`/`operator-auth.service.ts`; continuação dos fluxos em `contact-profile.controller.ts` |
| Google Sheets privado e envio automatizado | `automation-settings.tsx` | `sheet-automation.controller.ts`, `scripts/ponte-google-sheets.gs` |
| Webhooks | `webhook-settings.tsx`, `system-webhooks.tsx` | `system-webhook.controller.ts`, `webhook.service.ts`, `webhook-delivery.service.ts` |

### Automações: regras importantes

Leia [`AUTOMACOES.md`](AUTOMACOES.md) antes de mudar esse fluxo. A conexão recomendada à planilha privada é a ponte Apps Script `scripts/ponte-google-sheets.gs`, configurada por `GOOGLE_APPS_SCRIPT_URL` e `GOOGLE_APPS_SCRIPT_SECRET`; há alternativa com conta de serviço. A regra manual mapeia colunas a campos do contato. A interface permite criar regras manuais e de arquivos mensais; o modo antigo de chamada por CNPJ aparece apenas para regras já existentes. Alterações na interface não removem automaticamente regras persistidas. Na chamada mensal, a aba do mês anterior é calculada no fuso de São Paulo, `Clientes` fornece a razão social, `X` bloqueia envio, e um contato com vários CNPJs recebe uma mensagem consolidada. As etapas de chamada avançam manualmente; envio e marcação `Chamado` foram projetados para evitar duplicidade após falhas. A prévia não deve enviar nem alterar dados.

### Webhooks: dois mecanismos coexistem

`webhook-settings.tsx` mantém os avisos simples de nova mensagem (Discord ou JSON) para compatibilidade: filtros, campos selecionados e corpo enviado não foram convertidos para o formato genérico. `system-webhooks.tsx` usa o mecanismo genérico do OpenWA: eventos selecionáveis de mensagens/WhatsApp e eventos da central (contatos, atribuição/conclusão, chat da equipe, atividade e automação). O corpo genérico inclui `event`, `timestamp`, `sessionId` e `data`; o formato de `data` depende do evento. A lista de eventos aceitos está em `openwa/src/modules/webhook/dto/webhook.dto.ts`. Ambos os mecanismos agora enviam pelo mesmo transporte `postWebhookPayload` em `openwa/src/modules/webhook/utils/deliver-once.ts`, que aplica a proteção contra SSRF; redirecionamentos de destinos não são seguidos. A migração `1791244800000-CreateAtendeNotificationWebhooks.ts` é a dona única da tabela de avisos simples e não apaga configurações existentes. A entrega simples continua sem a fila/repetição de tentativas do mecanismo genérico. Para adicionar outro evento da central, **não basta** acrescentá-lo ao catálogo: emita-o no serviço responsável com `WebhookService.dispatch()`, documente o payload e teste. Webhooks enviam dados a destinos externos; avalie privacidade, autenticação e assinatura.

## 5. Dados e segurança

- PostgreSQL (volume `atende-postgres`) guarda dados operacionais e tabelas do esquema `openwa`; Redis (`atende-redis`) suporta eventos/cache; a sessão do WhatsApp fica em `atende-openwa`, e a mídia em `atende-media`. Consulte [`MIGRACAO_VOLUME_MIDIA.md`](MIGRACAO_VOLUME_MIDIA.md) antes de atualizar instalações antigas com anexos. **Nunca remova volumes para “corrigir” um erro** sem plano de backup e autorização explícita.
- A API original do OpenWA usa `X-API-Key`; as rotas Atende usam `X-Atende-Token` e checam permissões. Rotas decoradas com `@Public()` podem dispensar a guarda global de chave de API, mas devem validar o token dentro do controlador/serviço. Preserve o escopo da sessão (`sessionId`) para impedir acesso cruzado.
- O cadastro inicial usa `GET /api/operator-auth/registration-status` e `POST /api/operator-auth/register`. O `register` só aceita a primeira conta, dentro de transação com trava; toda conta posterior exige `POST /api/operator-auth/admin/users` com token de administrador. O formulário administrativo fica em `app/team-settings.tsx`. Não reabra o registro público para facilitar a entrada de atendentes.
- `app/conversations/workspace-storage.ts` guarda a configuração de conexão e a sessão do operador no armazenamento local do navegador. Não imprima tokens, chaves, `.env`, segredo do Apps Script ou conteúdo de clientes em logs/testes/relatórios.
- A aplicação pode enviar mensagens reais a clientes. Teste prévias e validações sem disparo quando possível; não inicie automações em produção só para testar.
- HTTPS e certificados locais são tratados por `scripts/local-gateway.mjs` e `scripts/create-local-https.ps1`. A disponibilidade de notificações do sistema varia com a origem segura do navegador.

## 6. Como executar e verificar

1. Confira `git status --short` e preserve alterações existentes. Histórico anterior pode conter mudanças locais de outras tarefas; não faça reset/checkout destrutivo.
2. Consulte `.env.example` e [`README.md`](../README.md). Não copie segredos de uma instalação para documentação. Com Docker Desktop iniciado, execute `docker compose up -d --build` **na raiz** para a primeira execução, ou `docker compose build web openwa` e `docker compose up -d --no-build web openwa` após mudanças de código. Em atualização de instalação com mídia antiga, siga antes o guia de migração.
3. Verifique `docker compose ps`; `openwa` deve ficar `healthy`. O painel atende em `http://localhost:3000` e, se o certificado local existir, também em HTTPS na porta 443. Um `401` numa rota administrativa sem token indica que ela está protegida, não necessariamente defeito.
4. Testes rápidos: `npm run typecheck:app`, `npx eslint app --quiet`, `npm run build`, `npm run test:conversation` e `npm run test:workspace` na raiz; este último inclui uma planilha `.xlsx` sintética. Consulte `npm audit --omit=dev` para o conjunto de produção e `npm audit` para as ferramentas de desenvolvimento. Execute `npm run build` em `openwa/` e `npm test -- --runInBand --runTestsByPath <arquivo.spec.ts>` em `openwa/` quando essa área for alterada. `typecheck:app` usa `tsconfig.app.json` e verifica o painel isoladamente; o `tsconfig.json` global também inclui o projeto-base OpenWA e seu dashboard, com dependências/compilador próprios. Rode testes de integração proporcionais ao risco. Evite usar uma sessão WhatsApp real para testes de envio sem necessidade.
5. Para mudanças de API, confira o contrato `openwa/openapi.json` e os testes `openwa/test/`. Para UI, confira estados de carregamento/erro, telas menores e funcionamento nos outros computadores da rede.

## 7. Orientações para a próxima IA

1. Responda e escreva mensagens de commit em **português**, conforme preferência expressa pelo usuário.
2. Não faça push, reescrita de histórico remoto, exclusão de dados ou envio real de mensagens sem pedido claro do usuário. Preserve o trabalho não commitado.
3. Prefira correções no fluxo completo (UI, API, persistência e testes) em vez de apenas ocultar um erro na interface.
4. Confirme capacidades existentes no código atual: há duas superfícies de UI, duas formas de autenticação e módulos originais do OpenWA que não são necessariamente usados pelo painel Atende.
5. Quando mudar automações, confira idempotência, marcações na planilha, casos ambíguos e retomada após reinício. Quando mudar notificações, confira deduplicação e frequência das consultas. Quando mudar webhooks, confira escopo da sessão, proteção de segredos e retries.
6. Documentação complementar: [`ATENDIMENTOS.md`](ATENDIMENTOS.md), [`AUTOMACOES.md`](AUTOMACOES.md), [`RECUPERAR-ACESSO.md`](RECUPERAR-ACESSO.md), [`MIGRACAO_VOLUME_MIDIA.md`](MIGRACAO_VOLUME_MIDIA.md) e `openwa/docs/`. Estas páginas descrevem regras específicas; valide-as contra o código se houver divergência.
