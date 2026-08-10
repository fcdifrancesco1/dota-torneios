# Como publicar o app "Torneios Dota 2"

Esse app é diferente dos seus outros PWAs: ele tem uma parte de backend (as "Netlify Functions" na pasta `netlify/functions`) que precisa da sua chave da Steam Web API guardada em segredo. Por isso, dessa vez o deploy não é arrastar-e-soltar — precisa passar pelo GitHub. Vou te guiar em cada clique.

## Parte 1 — Criar um repositório no GitHub (sem precisar usar comandos de git)

1. Acesse **https://github.com** e faça login (ou crie uma conta gratuita, se ainda não tiver).
2. No canto superior direito, clique no **ícone de "+"** e depois em **"New repository"**.
3. Em **"Repository name"**, digite: `dota-torneios`
4. Deixe marcado como **"Public"** (pode ser privado também, tanto faz).
5. **Não marque** nenhuma das caixinhas de "Add a README" — deixe tudo desmarcado.
6. Clique no botão verde **"Create repository"**.
7. Na próxima tela, procure o link **"uploading an existing file"** (link azul no meio do texto) e clique nele.
8. Agora você vai arrastar os arquivos do app pra essa tela do navegador. Arraste **a pasta inteira `dota-torneios`** que eu te entreguei — ou, se o GitHub não aceitar pasta, abra a pasta e arraste todo o conteúdo dela (arquivos e subpastas `netlify` e `public` juntos).
9. Espere o upload terminar (aparece uma lista de arquivos identificados). Role até o final da página e clique no botão verde **"Commit changes"**.

Pronto — seu código está no GitHub.

## Parte 2 — Conectar o repositório ao Netlify

1. Acesse **https://app.netlify.com** e faça login (pode ser com a mesma conta do GitHub, clicando em **"Sign up with GitHub"** se for a primeira vez).
2. Clique no botão **"Add new site"** → **"Import an existing project"**.
3. Clique em **"Deploy with GitHub"**.
4. Se for a primeira vez, o Netlify vai pedir autorização pra acessar seus repositórios — clique em **"Authorize Netlify"** e depois selecione **"Only select repositories"** → escolha `dota-torneios` → **"Install"**.
5. Na lista que aparece, clique no repositório **`dota-torneios`**.
6. Na tela de configuração de build, **não precisa mudar nada** (o arquivo `netlify.toml` que já está no projeto configura tudo sozinho). Clique em **"Deploy dota-torneios"**.
7. Espere a barra de progresso terminar (leva uns 1-2 minutos). Quando aparecer **"Site is live"**, seu app já está publicado — mas ainda falta configurar a chave da Steam API (parte 3), senão a aba "Ao vivo" não vai funcionar.

## Parte 3 — Configurar sua chave da Steam API (variável de ambiente)

1. Ainda dentro do painel do site no Netlify, clique em **"Site configuration"** no menu lateral esquerdo.
2. Clique em **"Environment variables"**.
3. Clique no botão **"Add a variable"** → **"Add a single variable"**.
4. Em **"Key"**, digite exatamente: `STEAM_API_KEY`
5. Em **"Values"**, cole a sua chave (a mesma que você pegou em steamcommunity.com/dev/apikey).
6. Clique em **"Create variable"**.
7. Agora precisa **re-publicar** o site pra essa variável entrar em vigor: vá em **"Deploys"** no menu superior → clique no botão **"Trigger deploy"** → **"Deploy site"**.

## Parte 4 — Testar

1. Ainda no painel do Netlify, copie a URL do site (algo como `https://nome-aleatorio.netlify.app`, aparece no topo da página).
2. Abra essa URL no navegador do celular ou do PC.
3. Digite "International 2026" na busca — deve aparecer o torneio na lista.
4. Selecione, e veja se as abas "Ao vivo", "Resultados" e "Classificação" carregam sem erro.

Se a aba "Ao vivo" mostrar uma mensagem de erro sobre `STEAM_API_KEY`, revise a Parte 3 — provavelmente esqueceu de re-publicar depois de adicionar a variável.

## Parte 5 — Gerar o APK (opcional, pra instalar no Android)

1. Acesse **https://www.pwabuilder.com**.
2. Cole a URL do seu site publicado no Netlify (da Parte 4) e clique na seta/**"Start"**.
3. Espere a análise terminar, depois clique na aba **"Android"**.
4. Clique em **"Generate Package"**, aceite as opções padrão, e clique em **"Download"**.
5. Extraia o `.zip` baixado — dentro tem um arquivo `.apk`.
6. Transfira esse `.apk` pro celular (por WhatsApp, e-mail, cabo USB — do jeito que preferir).
7. No celular, toque no arquivo `.apk` pra instalar. Se aparecer aviso de "fontes desconhecidas", toque em **"Configurações"** → ative a permissão → volte e instale.

## Como atualizar o app depois

Sempre que eu te entregar uma versão nova dos arquivos: vá no GitHub, dentro do repositório `dota-torneios`, clique em **"Add file"** → **"Upload files"**, arraste os arquivos novos (eles substituem os antigos automaticamente pelo nome) e clique em **"Commit changes"**. O Netlify detecta a mudança sozinho e já re-publica o site em 1-2 minutos — não precisa fazer nada no Netlify.

## Sobre os dados

Esse app **não guarda dados seus** localmente além do torneio selecionado (pra lembrar da última vez que você abriu) e da lista de torneios recentes — tudo isso fica salvo só no navegador do próprio aparelho. Os resultados, herois e estatísticas vêm sempre ao vivo da OpenDota e da Steam API, então não tem backup a fazer.
