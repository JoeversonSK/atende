# Atendimentos, painel e contatos

## Painel operacional escuro

O painel segue o modelo em duas colunas: resumo dos analistas e atendimentos ativos à esquerda; indicadores e fila à direita. Em telas menores, os blocos se reorganizam verticalmente.

- **Concluídos / tempo total**: atendimentos finalizados hoje, no fuso de Brasília. O registro ocorre ao salvar o status **Fechado** no perfil; editar novamente sem reabrir não duplica o total. Uma nova finalização após reabrir registra outro atendimento. O tempo é o período com o responsável final; não inclui períodos anteriores a transferências. Conclusões anteriores à implantação desse registro não são estimadas.
- **Tipo / prioridade**: configure no perfil da conversa e salve. O padrão é remoto e prioridade normal.
- **Em alerta**: conversa sem responsável há pelo menos 15 minutos desde a primeira mensagem recebida depois da última resposta enviada. O painel usa os horários sincronizados; quando não há registro suficiente, mostra **—**.
- **Relógio**: horário de Brasília. Os cronômetros visuais atualizam a cada segundo; os dados são consultados a cada 8 segundos.

- **Painel**: lista os chamados, a fila sem responsável, quem está atendendo e os clientes que ainda não responderam. Os cartões filtram a tabela; a busca aceita cliente ou atendente.
- **Abrir / encaminhar**: abre a conversa e seu perfil. Em **Encaminhar para**, escolha uma conta ativa e confirme **Encaminhar atendimento**. A conta precisa da permissão de atribuição, configurada pelo administrador.
- **Código da atribuição e encerramento**: `app/conversations/ticket-actions.ts` concentra as requisições de ler, atribuir, remover e encerrar; `app/page.tsx` continua atualizando a fila, o perfil e os avisos após cada resposta. Reatribuir pode devolver um perfil reaberto, que deve substituir o perfil anterior na tela.
- **Dados do usuário**: nome e telefone são campos independentes. Use **Salvar informações** após editar. O nome salvo tem prioridade na lista e no cabeçalho e é compartilhado pela equipe. Não altera a agenda do celular.
- **Telefone**: quando possível, vem da consulta de telefone do WhatsApp. Um identificador `@lid` não é tratado como número telefônico. Se o WhatsApp não informar o número, preencha manualmente.
- **Leitura**: abrir a conversa solicita a confirmação ao WhatsApp. Quando a conversa está visível e o navegador em foco, novas mensagens também são marcadas como lidas. Se o WhatsApp recusar ou estiver desconectado, aparece um aviso; o sistema não confirma falsamente a leitura.
- **Código de leitura e cadastro pela conversa**: `app/conversations/conversation-sync.ts` envia a confirmação de leitura; `app/conversations/contact-creation.ts` prepara e salva um novo contato sem apagar campos já existentes. As janelas correspondentes ficam em `app/conversations/components/conversation-dialogs.tsx`; `app/page.tsx` atualiza o estado visual após as respostas.
- **Tempo com o atendente**: conta desde a atribuição ao responsável atual. Assumir novamente com a mesma conta não reinicia esse tempo; transferir para outra inicia o tempo do novo responsável.
- **Cliente sem responder**: conta desde a primeira mensagem enviada após a última resposta recebida. Novas mensagens de cobrança não reiniciam a contagem. Mensagens pendentes ou com falha de envio não entram nessa conta.
- **Fechado**: o status salvo no perfil retira a conversa das filas de espera e atendimento. Reabra pelo mesmo campo quando necessário.

O painel atualiza a cada 8 segundos. Os tempos usam as mensagens já sincronizadas no banco, não um histórico externo ainda não importado. Quando o WhatsApp está desconectado, a interface mostra um aviso e os contatos com histórico local disponível; a fila completa e as contagens de leitura voltam após sincronizar. Conversas de grupos não aparecem.

Na tela de conversas, a atualização de alertas da equipe, validade do acesso e reconciliação das conversas é coordenada por `app/workspace-polling.ts`. Cada tarefa conserva sua frequência e não inicia uma segunda requisição enquanto a anterior ainda está em andamento; a reconciliação roda somente com a página visível. O polling interno do dashboard acima é independente desse agendador.

## Recursos atuais relacionados

- **Cadastro da equipe:** somente a primeira conta pode usar **Criar conta** na tela de entrada; ela se torna administradora. Após isso, o cadastro público é bloqueado no servidor e a opção desaparece da tela. Um administrador autenticado cria outras contas em **Configurações → Equipe e permissões → Adicionar pessoa à equipe**, informando nome, usuário e senha inicial. A conta nova entra como atendente ativo; permissões e função podem ser ajustadas na tabela. Contas existentes antes desta proteção permanecem ativas: revise-as manualmente na mesma tabela.
- **Tela cheia:** o botão do próprio dashboard usa a API de tela cheia do navegador; `Esc` retorna à visualização normal. A navegação e o cabeçalho do Atende ficam fora da área exibida.
- **Atividade da equipe:** o operador pode declarar descanso, reunião, ausência da estação ou outra atividade. Enquanto indisponível, não deve receber novos atendimentos; o dashboard mostra a atividade. Um atendimento em cliente registra início, fim e duração e entra nas métricas de atendimentos realizados. A interface e suas requisições ficam em `app/operator-activity.tsx`; as regras e a persistência ficam no serviço de autenticação do operador. Uma falha ao atualizar o perfil depois de registrar o atendimento não desfaz o registro: a interface informa que é preciso recarregar a página.
- **Filtro de contatos por etiquetas:** é possível selecionar mais de uma etiqueta e escolher entre exigir **todas** no mesmo contato ou aceitar **qualquer uma**. A busca textual e a combinação das etiquetas são aplicadas na lista de contatos.

Para restaurar uma sessão que falhou: **Ajustes → WhatsApp → Salvar e conectar**. A ação reutiliza a sessão existente, sem apagar o vínculo. Se o WhatsApp revogou o vínculo, será necessário parear novamente.
