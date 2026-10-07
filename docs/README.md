# Documentação do Atende

Este é o índice dos guias do **Atende**. O [README da raiz](../README.md) é a entrada para instalação e uso inicial. A documentação original do motor OpenWA fica em [`openwa/docs/`](../openwa/docs/) e não descreve necessariamente as personalizações do Atende.

| Guia canônico | Leia quando precisar de... |
| --- | --- |
| [Arquitetura e estado atual](ARQUITETURA_E_ESTADO_ATUAL.md) | Mapa da interface, sincronização, envio e encaminhamento de conversas, notificações, fluxo navegador–API–WhatsApp, atividade, migrações, webhooks, dados e verificação. É o ponto de partida para desenvolvimento. |
| [Atendimentos, painel e contatos](ATENDIMENTOS.md) | Regras operacionais de fila, responsável, conclusão, tempos, contatos e dashboard. |
| [Automações](AUTOMACOES.md) | Google Sheets privado, mapeamento manual, chamadas mensais, prevenção de duplicidade e operação. |
| [Recuperação de acesso](RECUPERAR-ACESSO.md) | Procedimento local de redefinição de senha e cuidados com o código. |
| [Migração do volume de mídia](MIGRACAO_VOLUME_MIDIA.md) | Atualização de instalação existente sem ocultar anexos antigos. Não é necessária em instalação nova. |

## Para quem vai modificar o projeto

Leia [`AGENTS.md`](../AGENTS.md) para o roteiro curto de arquivos e a regra de manutenção da documentação. Depois abra somente o guia da área da tarefa e os arquivos indicados nele. Não é necessário ler todo o OpenWA para uma mudança no painel.

Ao acrescentar uma funcionalidade, documente seu comportamento no guia canônico, atualize o mapa de código quando surgir um novo módulo e mantenha os comandos de instalação/recuperação reproduzíveis. Evite documentos paralelos com versões conflitantes da mesma regra.
