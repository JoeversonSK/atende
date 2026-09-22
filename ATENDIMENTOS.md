# Painel e contatos

## Painel operacional escuro

O painel segue o modelo em duas colunas: resumo dos analistas e atendimentos ativos à esquerda; indicadores e fila à direita. Em telas menores, os blocos se reorganizam verticalmente.

- **Concluídos / tempo total**: atendimentos finalizados hoje, no fuso de Brasília. O registro ocorre ao salvar o status **Fechado** no perfil; editar novamente sem reabrir não duplica o total. Uma nova finalização após reabrir registra outro atendimento. O tempo é o período com o responsável final; não inclui períodos anteriores a transferências. Conclusões anteriores à implantação desse registro não são estimadas.
- **Tipo / prioridade**: configure no perfil da conversa e salve. O padrão é remoto e prioridade normal.
- **Em alerta**: conversa sem responsável há pelo menos 15 minutos desde a primeira mensagem recebida depois da última resposta enviada. O painel usa os horários sincronizados; quando não há registro suficiente, mostra **—**.
- **Relógio**: horário de Brasília. Os cronômetros visuais atualizam a cada segundo; os dados são consultados a cada 8 segundos.

- **Painel**: lista os chamados, a fila sem responsável, quem está atendendo e os clientes que ainda não responderam. Os cartões filtram a tabela; a busca aceita cliente ou atendente.
- **Abrir / encaminhar**: abre a conversa e seu perfil. Em **Encaminhar para**, escolha uma conta ativa e confirme **Encaminhar atendimento**. A conta precisa da permissão de atribuição, configurada pelo administrador.
- **Dados do usuário**: nome e telefone são campos independentes. Use **Salvar informações** após editar. O nome salvo tem prioridade na lista e no cabeçalho e é compartilhado pela equipe. Não altera a agenda do celular.
- **Telefone**: quando possível, vem da consulta de telefone do WhatsApp. Um identificador `@lid` não é tratado como número telefônico. Se o WhatsApp não informar o número, preencha manualmente.
- **Leitura**: abrir a conversa solicita a confirmação ao WhatsApp. Quando a conversa está visível e o navegador em foco, novas mensagens também são marcadas como lidas. Se o WhatsApp recusar ou estiver desconectado, aparece um aviso; o sistema não confirma falsamente a leitura.
- **Tempo com o atendente**: conta desde a atribuição ao responsável atual. Assumir novamente com a mesma conta não reinicia esse tempo; transferir para outra inicia o tempo do novo responsável.
- **Cliente sem responder**: conta desde a primeira mensagem enviada após a última resposta recebida. Novas mensagens de cobrança não reiniciam a contagem. Mensagens pendentes ou com falha de envio não entram nessa conta.
- **Fechado**: o status salvo no perfil retira a conversa das filas de espera e atendimento. Reabra pelo mesmo campo quando necessário.

O painel atualiza a cada 8 segundos. Os tempos usam as mensagens já sincronizadas no banco, não um histórico externo ainda não importado. Quando o WhatsApp está desconectado, a interface mostra um aviso e os contatos com histórico local disponível; a fila completa e as contagens de leitura voltam após sincronizar. Conversas de grupos não aparecem.

Para restaurar uma sessão que falhou: **Ajustes → WhatsApp → Salvar e conectar**. A ação reutiliza a sessão existente, sem apagar o vínculo. Se o WhatsApp revogou o vínculo, será necessário parear novamente.
