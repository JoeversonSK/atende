# Recuperação de acesso

Na tela de login, escolha **Esqueci minha senha**. A recuperação não utiliza
e-mail nem depende de serviços pagos.

No computador que hospeda o Docker, abra o terminal na pasta deste projeto e execute:

```powershell
docker compose exec openwa node scripts/recover-operator.cjs joe
```

Substitua `joe` pelo usuário que precisa recuperar. Copie o código apresentado
para o formulário, informe a nova senha e confirme. Depois faça login normalmente.

- O código expira em 15 minutos e só pode ser usado uma vez.
- Gerar outro código invalida o anterior.
- O banco guarda apenas o hash do código, não o código original.
- Trocar a senha encerra as sessões anteriores, mas preserva conversas e permissões.
- Contas desativadas precisam ser reativadas por um administrador.
- Apenas quem administra o computador/Docker deve executar esse comando e entregar
  o código, de forma privada, ao titular da conta.
- A chave da API do WhatsApp não serve como código de recuperação.

Não publique o terminal, o Docker ou o banco de dados na internet.
