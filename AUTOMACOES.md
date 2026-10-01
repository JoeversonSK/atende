# Automações com Google Sheets privado

A área **Ajustes → Automações** lê uma planilha privada, associa colunas aos campos do contato e, opcionalmente, envia uma mensagem usando valores da linha. Apenas administradores podem configurá-la. A planilha não precisa ser publicada.

1. No Google Cloud, habilite a Google Sheets API e crie uma conta de serviço com uma chave JSON. Dê a essa conta apenas acesso de leitura à planilha desejada (Compartilhar → endereço de e-mail da conta de serviço → Leitor).
2. No computador que hospeda a central, codifique o arquivo JSON em Base64 e coloque o valor em `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` no `.env` local. Nunca inclua a chave ou o `.env` no Git. Reinicie os serviços para carregar a variável.
3. Em **Automações**, confira o e-mail exibido, crie uma regra com o link da planilha e o intervalo (ex.: `A1:Z201`), e indique o nome da coluna de telefone.
4. Mapeie as demais colunas para nome, e-mail, empresa, documento, endereço, etiquetas ou campos personalizados (`custom:Nome do campo`). A primeira linha deve conter cabeçalhos únicos. Use **Conferir planilha** antes de salvar.
5. O envio de mensagem e a execução periódica começam desligados. Ao habilitar envio, uma linha nova ou alterada pode gerar uma mensagem; confira o modelo e os dados antes de executar. `{{Nome da coluna}}` insere o valor correspondente. Linhas sem alteração não são reenviadas.

Limites de segurança: no máximo 1.000 contatos e 52 colunas por regra, leitura somente pelo domínio oficial da API Google, até 50 mensagens por execução com pausa entre envios. O restante fica pendente para a próxima execução. A sincronização não apaga contatos removidos da planilha. Se um envio falhar, a linha fica marcada como falha e **não é reenviada automaticamente** para evitar duplicatas; corrija a causa e altere a linha para permitir uma nova tentativa.

Outros sistemas podem receber eventos pela área **Webhooks**. O formato JSON pode incluir o perfil completo do contato (inclusive campos personalizados), os detalhes da mensagem e o responsável pelo atendimento.
