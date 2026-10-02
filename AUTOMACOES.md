# Automações com Google Sheets privado

A área **Ajustes → Automações** lê uma planilha privada, associa colunas aos campos do contato e, opcionalmente, envia uma mensagem usando valores da linha. Apenas administradores podem configurá-la. A planilha não precisa ser publicada.

1. No Google Cloud, habilite a Google Sheets API e crie uma conta de serviço com uma chave JSON. Dê a essa conta apenas acesso de leitura à planilha desejada (Compartilhar → endereço de e-mail da conta de serviço → Leitor).
2. No computador que hospeda a central, codifique o arquivo JSON em Base64 e coloque o valor em `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` no `.env` local. Nunca inclua a chave ou o `.env` no Git. Reinicie os serviços para carregar a variável.
3. Em **Automações**, confira o e-mail exibido, crie uma regra com o link da planilha e o intervalo (ex.: `A1:Z201`), e indique o nome da coluna de telefone.
4. Mapeie as demais colunas para nome, e-mail, empresa, documento, endereço, etiquetas ou campos personalizados (`custom:Nome do campo`). A primeira linha deve conter cabeçalhos únicos. Use **Conferir planilha** antes de salvar.
5. O envio de mensagem e a execução periódica começam desligados. Ao habilitar envio, uma linha nova ou alterada pode gerar uma mensagem; confira o modelo e os dados antes de executar. `{{Nome da coluna}}` insere o valor correspondente. Linhas sem alteração não são reenviadas.

Limites de segurança: no máximo 1.000 contatos e 52 colunas por regra, leitura somente pelo domínio oficial da API Google, até 50 mensagens por execução com pausa entre envios. O restante fica pendente para a próxima execução. A sincronização não apaga contatos removidos da planilha. Se um envio falhar, a linha fica marcada como falha e **não é reenviada automaticamente** para evitar duplicatas; corrija a causa e altere a linha para permitir uma nova tentativa.

Outros sistemas podem receber eventos pela área **Webhooks**. O formato JSON pode incluir o perfil completo do contato (inclusive campos personalizados), os detalhes da mensagem e o responsável pelo atendimento.

## Chamar clientes por CNPJ

Crie uma automação do tipo **Chamar clientes por CNPJ**. Informe a aba de controle (por exemplo, `Controle!A1:H201`) e a aba de dados (`Clientes!A1:D201`) da **mesma planilha**, ambas com cabeçalho na primeira linha. Configure o nome exato das colunas de CNPJ em cada aba, a coluna de retorno `Chamado` e o texto a escrever após o envio (por padrão, `Nós chamamos`). A mensagem pode usar `{{Razão social}}`, `{{Nome do cliente}}` ou qualquer outra coluna das duas abas.

O sistema ignora linhas cujo `Chamado` já tem algum valor. Para as demais, normaliza o CNPJ, procura uma única linha na aba de dados e um único contato existente cujo campo **Documento** ou campo personalizado **CNPJ** coincida. Não cria contatos nem associa uma empresa por semelhança de nome. CNPJs ausentes, inválidos ou ambíguos não geram mensagem; a prévia mostra as respectivas contagens.

Depois de enviar pelo WhatsApp, o sistema escreve o valor configurado na célula `Chamado` da mesma linha. Para isso, compartilhe a planilha com a conta de serviço como **Editor** (a importação somente por telefone continua exigindo apenas **Leitor**). Se o envio falhar, a célula não é alterada. Se o envio funcionar mas a escrita falhar, a automação guarda o estado pendente e tenta apenas atualizar a célula no próximo ciclo, **sem reenviar** a mensagem. No máximo 50 novas mensagens são enviadas por execução. Mensagens com resultado incerto ou falha de envio não são reenviadas automaticamente, para evitar duplicidade; confira o WhatsApp e a lista de falhas antes de qualquer nova tentativa.

## Arquivos mensais: mês anterior e várias empresas por contato

Para a planilha **Arquivos mensais**, escolha **Arquivos mensais — mês anterior**. Basta informar o link da planilha privada; os intervalos e cabeçalhos já vêm preenchidos de acordo com o arquivo fornecido. Em outubro de 2026, a aba lida é `Setembro2026`; em janeiro de 2027, será `Dezembro2026`. O servidor usa o calendário de São Paulo. A aba `Clientes` é fixa.

- Na aba mensal, `EMPRESA` (A), `CNPJ` (B) e `Chamado` (H) determinam o trabalho pendente. Qualquer valor em `Chamado` impede novo envio. Um `X` isolado no nome da empresa indica bloqueio e também impede o envio.
- Em `Clientes`, o nome da coluna `Cliente` (A) é comparado com `EMPRESA`; a coluna `Razão Social planilha Clientes Compufour` (F) fornece o texto da mensagem. A comparação ignora caixa, acentos e pontuação, mas não adivinha nomes diferentes. Duplicatas só são aceitas se todas as razões sociais preenchidas forem iguais.
- O contato precisa existir e ter o CNPJ no campo Documento ou em um campo personalizado `CNPJ`. Um campo pode conter vários CNPJs separados por vírgula ou outro texto; cada CNPJ válido é identificado individualmente. Se duas empresas da aba mensal apontarem para o mesmo contato, ele recebe **uma mensagem** com ambas as razões sociais; as duas linhas são marcadas após o envio.
- Se qualquer empresa daquele contato estiver bloqueada por `X` ou sem razão social confiável, nenhuma mensagem parcial é enviada ao contato. A prévia lista as linhas para revisão. O modelo usa `{{Razões sociais}}` e aceita também `{{CNPJs}}` e `{{Mês}}`. Cada razão social é inserida em negrito do WhatsApp.

A primeira execução e a execução periódica começam desligadas. Confira a prévia antes de ativar. O envio é limitado a 50 contatos por execução e não é repetido no mesmo mês para o mesmo contato. Se o envio funcionar mas alguma linha não puder ser marcada, o ciclo seguinte tenta somente as marcações pendentes. A conta de serviço precisa de permissão **Editor** na planilha; a credencial continua apenas no `.env` local.

**Simplificação futura:** adicionar uma coluna CNPJ à aba `Clientes` permitiria cruzar as duas abas por um identificador exato, eliminando dúvidas causadas por abreviações ou nomes diferentes. Enquanto ela não existe, esses casos ficam na prévia para revisão, sem envio automático.
