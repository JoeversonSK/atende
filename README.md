<p align="center">
  <img src="docs/banner.svg" alt="Atende — central de atendimento multiusuário" width="100%">
</p>

<p align="center">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-obrigatório-2496ED?logo=docker&logoColor=white">
  <img alt="Node.js 22" src="https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white">
  <img alt="PostgreSQL 16" src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white">
  <img alt="Licença MIT" src="https://img.shields.io/badge/licença-MIT-0d8f79">
</p>

# Atende

Central de atendimento multiusuário para WhatsApp, executada no seu próprio computador com Docker. A equipe acessa uma caixa de entrada compartilhada, identifica o atendente responsável e acompanha a fila e os atendimentos em tempo real.

O projeto usa uma versão personalizada do [OpenWA](https://github.com/rmyndharis/OpenWA) e não depende da API oficial do WhatsApp.

## Recursos

- Caixa de entrada compartilhada com atualização em tempo real
- Contas individuais para atendentes e administradores
- Nome do atendente nas mensagens enviadas
- Atribuição e transferência de conversas
- Fila de espera, tempo de atendimento e tempo sem resposta
- Encerramento e reabertura automática do atendimento
- Histórico de mensagens, imagens, vídeos, documentos, áudios e figurinhas
- Cadastro de contatos, notas, etiquetas e campos personalizados
- Notificações sonoras, internas e do sistema operacional
- Painel de desempenho dos atendentes
- Controle de permissões por conta
- Recuperação de senha administrada localmente
- PostgreSQL, Redis, painel e integração reunidos no Docker Compose

## Arquitetura

| Serviço | Função | Exposição padrão |
| --- | --- | --- |
| `web` | Interface do Atende e gateway interno | Porta `3000` |
| `openwa` | Conexão e envio de mensagens pelo WhatsApp | Somente `127.0.0.1:2785` |
| `postgres` | Contas, contatos, mensagens e atendimentos | Rede interna do Docker |
| `redis` | Eventos e estado em tempo real | Rede interna do Docker |

Os dados são armazenados em volumes Docker. Reiniciar ou atualizar os containers não apaga as conversas nem as contas.

## Requisitos

- Docker Desktop no Windows, macOS ou Linux
- Docker Compose v2, incluído no Docker Desktop
- Pelo menos 4 GB de memória disponíveis para o Docker
- Aproximadamente 6 GB livres para a primeira compilação
- Um número de WhatsApp que possa ler o QR Code

Não é necessário instalar Node.js para executar o sistema pelo Docker.

## Instalação rápida

### 1. Baixe o projeto

Baixe o ZIP pela página do GitHub e extraia-o, ou clone o repositório:

```bash
git clone https://github.com/JoeversonSK/atende.git
cd atende
```

### 2. Crie sua configuração local

No Windows PowerShell:

```powershell
Copy-Item .env.example .env
notepad .env
```

No Linux ou macOS:

```bash
cp .env.example .env
```

Substitua os três valores do arquivo `.env` por textos longos e diferentes:

```dotenv
POSTGRES_PASSWORD=crie-uma-senha-longa-e-unica
APP_SESSION_SECRET=crie-outro-segredo-longo-e-unico
OPENWA_MASTER_KEY=crie-uma-chave-longa-e-unica
```

Nunca publique o arquivo `.env`. Ele já está protegido pelo `.gitignore`.

### 3. Inicie o sistema

```bash
docker compose up -d --build
```

A primeira compilação demora alguns minutos. Acompanhe o estado com:

```bash
docker compose ps
```

Quando os serviços estiverem ativos, abra:

```text
http://localhost:3000
```

### 4. Faça o primeiro acesso

1. Clique em **Criar conta**.
2. A primeira conta criada torna-se administradora.
3. Entre em **Configurações > WhatsApp**.
4. Crie a sessão e leia o QR Code pelo WhatsApp do celular.
5. Aguarde a conexão aparecer como ativa.
6. Crie as contas dos atendentes em **Configurações > Equipe e permissões**.

## Acesso por outros computadores

Na mesma rede local, descubra o nome ou o endereço IP do computador que executa o Docker e acesse:

```text
http://NOME-DO-COMPUTADOR:3000
```

Exemplo:

```text
http://192.168.1.50:3000
```

Talvez seja necessário liberar a porta TCP `3000` no firewall do computador-servidor. Não é necessário abrir portas no roteador para acesso dentro da mesma rede.

Para acesso externo, use um túnel HTTPS confiável ou um proxy reverso com TLS. Não exponha PostgreSQL, Redis ou a porta `2785` diretamente na internet.

## Notificações do computador

Os avisos internos e sonoros funcionam com a página aberta. Notificações nativas fora da janela exigem:

- permissão de notificações no navegador;
- a opção de notificações ativada em cada computador;
- acesso por HTTPS, exceto quando usado diretamente em `localhost`.

Se a página for completamente fechada, as notificações deixam de funcionar porque este projeto ainda não utiliza notificações push em segundo plano.

## Operação diária

```bash
# Iniciar
docker compose up -d

# Ver o estado
docker compose ps

# Acompanhar os registros
docker compose logs -f --tail=100

# Parar sem apagar os dados
docker compose stop

# Reiniciar
docker compose restart
```

Não use `docker compose down -v` em uma instalação com dados importantes: a opção `-v` remove os volumes e pode apagar contas, histórico e sessão do WhatsApp.

## Atualização

Antes de atualizar, faça backup dos volumes ou do banco de dados. Depois:

```bash
git pull
docker compose up -d --build
```

## Backup básico

Crie um backup do banco PostgreSQL:

```bash
docker compose exec -T postgres pg_dump -U atende -d atende > atende-backup.sql
```

Restaure em uma instalação vazia:

```bash
docker compose exec -T postgres psql -U atende -d atende < atende-backup.sql
```

A autenticação do WhatsApp e os arquivos de mídia ficam no volume `atende-openwa`; faça backup desse volume separadamente quando precisar recuperar a instalação completa.

## Estrutura do repositório

```text
app/                 Interface da central de atendimento
docker/              Inicialização do PostgreSQL
docs/                Imagens e documentação visual
openwa/              OpenWA personalizado para o Atende
scripts/             Gateway local e verificações
docker-compose.yml   Orquestração completa
Dockerfile           Imagem da interface
.env.example         Modelo seguro de configuração
```

## Desenvolvimento

Para trabalhar apenas na interface:

```bash
npm install
npm run dev
```

Validação da compilação:

```bash
npm run build
docker compose build
```

Os testes de integração locais usam registros temporários e revertem as alterações ao terminar. Eles não devem ser executados contra uma instalação que você não administra.

## Segurança e limitações

Este projeto usa automação do WhatsApp Web, não a API oficial da Meta. Alterações do WhatsApp podem interromper a conexão, e o uso automatizado pode estar sujeito a limitações ou bloqueios definidos pelo WhatsApp. Use por sua conta e risco e respeite os termos aplicáveis.

Recomendações:

- use um número dedicado ao atendimento;
- mantenha Docker, navegador e sistema operacional atualizados;
- não compartilhe `OPENWA_MASTER_KEY`;
- não envie o arquivo `.env` para o GitHub;
- use HTTPS antes de permitir acesso pela internet;
- mantenha backups regulares;
- restrinja o acesso físico e administrativo ao computador-servidor.

## Créditos

A integração é baseada no projeto [OpenWA](https://github.com/rmyndharis/OpenWA), distribuído sob licença MIT. O código incorporado preserva a licença original em [openwa/LICENSE](openwa/LICENSE).

WhatsApp é uma marca da Meta Platforms, Inc. Este projeto é independente e não possui associação oficial com WhatsApp ou Meta.

## Licença

O Atende é disponibilizado sob a [Licença MIT](LICENSE). Componentes de terceiros continuam sujeitos às respectivas licenças.
