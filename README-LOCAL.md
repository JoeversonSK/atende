# Ambiente local do Atende

Este ambiente mantém o painel, PostgreSQL, Redis e OpenWA no computador da empresa. Os dados ficam nos volumes Docker locais e não são publicados por esta configuração.

## Pré-requisito

Instale e inicie o Docker Desktop. A virtualização precisa estar habilitada no Windows.

## Primeira execução

1. Copie `.env.example` para `.env` e substitua todos os valores de exemplo por segredos longos.
2. Execute `docker compose up -d --build` na pasta do projeto.
3. Abra `http://localhost:3000` no computador-servidor.
4. Crie uma sessão no painel, obtenha o QR Code e conecte o WhatsApp.

## Serviços internos

- `web`: painel do atendimento na porta 3000.
- `postgres`: usuários, permissões e dados do sistema; não exposto à rede.
- `redis`: presença e eventos em tempo real; não exposto à rede.
- `openwa`: integração WhatsApp; acessível somente aos demais containers.

O acesso externo por túnel será ligado em uma etapa posterior, sem expor PostgreSQL, Redis ou OpenWA diretamente.
