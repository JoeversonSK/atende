# Volume local de mídia do OpenWA

Os anexos das conversas ficam em um volume Docker próprio (`atende-media`), montado em `/app/data/media`. O volume `atende-openwa` continua guardando a sessão do WhatsApp. Os caminhos salvos em `openwa.messages."mediaPath"` não mudam, e o banco não é migrado.

Em uma instalação nova, `docker compose up -d` cria os dois volumes. **Em uma instalação que já tenha anexos no volume antigo, copie-os antes de recriar o OpenWA**: o novo ponto de montagem encobrirá `/app/data/media` dentro do volume antigo, embora os arquivos continuem guardados nele.

## Migração de uma instalação existente

Os comandos abaixo usam o nome de projeto Compose `atende`. Confirme os nomes reais com `docker volume ls` se a instalação usar outro projeto. Execute-os no diretório do repositório. Não use `docker compose down -v` nem remova o volume antigo.

1. Crie o destino sem alterar o volume antigo:

   ```powershell
   docker volume create atende_atende-media
   ```

2. Faça uma primeira cópia com o OpenWA em funcionamento:

   ```powershell
   docker run --rm --network none --user 0:0 --entrypoint sh -v atende_atende-openwa:/source:ro -v atende_atende-media:/target atende-openwa:latest -lc 'cp -a /source/media/. /target/'
   ```

3. Planeje uma breve interrupção, pare apenas o OpenWA e copie novamente os arquivos que chegaram durante a primeira cópia:

   ```powershell
   docker compose stop openwa
   docker run --rm --network none --user 0:0 --entrypoint sh -v atende_atende-openwa:/source:ro -v atende_atende-media:/target atende-openwa:latest -lc 'cp -a /source/media/. /target/ && diff -qr /source/media/chat-media /target/chat-media'
   ```

   O segundo comando deve terminar com código 0 e sem diferenças. Se falhar, não prossiga: confira a cópia mantendo o OpenWA parado.

4. Inicie com o novo ponto de montagem e confira o estado:

   ```powershell
   docker compose up -d --no-deps openwa
   docker compose ps
   docker inspect atende-openwa --format '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{println}}{{end}}'
   ```

   O volume `atende_atende-media` deve aparecer em `/app/data/media`, e a sessão deve retornar ao estado `ready`.

Depois da troca, o conteúdo antigo em `atende-openwa` é apenas uma cópia do momento da migração; **não é um backup contínuo**. Faça backups periódicos do banco PostgreSQL e do novo volume de mídia em conjunto. Não remova a cópia antiga antes de testar uma restauração desses backups.

Esta separação não apaga nem converte o base64 que já está no banco. A eliminação de cópias duplicadas exige outra migração, com backup verificado, leitura por arquivo e validação de cada registro antes de qualquer remoção.
