# Sala Sonora — chat com salas e rádio colaborativa

Chat em tempo real com salas e uma "rádio" compartilhada: qualquer pessoa
pesquisa uma música (via YouTube) e ela toca sincronizada para todo mundo
que está na sala, com uma fila simples (a primeira música pedida é a
primeira a tocar).

## O que foi reinventado em relação à ideia original

- **Fila FIFO**: em vez de uma música simplesmente substituir a outra, agora
  existe uma fila. Quem pede primeiro, toca primeiro.
- **Sincronização de tempo**: quem entra na sala no meio de uma música ouve a
  partir do ponto certo, não do começo — o servidor guarda o horário exato em
  que cada música começou a tocar.
- **Reações rápidas**: 👍 ❤️ 😂 em qualquer mensagem.
- **Salas com emoji**: cada sala criada tem um emoji/cor de identidade.
- **Presença em tempo real**: mostra quantas pessoas estão na sala agora.

## 1. Arquivos do projeto

```
/
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── src/
│   └── index.js
├── wrangler.json
└── README.md
```

Todos esses arquivos já estão prontos nesta pasta. Você só precisa subir
exatamente essa estrutura para o GitHub (as mesmas pastas, com os mesmos
nomes).

## 2. Colocar no GitHub

1. Crie um repositório novo no GitHub (pode ser privado).
2. Envie todos os arquivos desta pasta para esse repositório, mantendo a
   mesma estrutura de pastas (`public/`, `src/`, e os arquivos na raiz).
   Se você não usa terminal, pode arrastar os arquivos direto pela interface
   web do GitHub ("Add file" → "Upload files"), só tome cuidado para criar
   as pastas `public` e `src` corretamente ao subir os arquivos que ficam
   dentro delas.

## 3. Criar o Worker no Cloudflare (conectado ao GitHub)

1. Acesse o painel do Cloudflare → **Workers & Pages**.
2. Clique em **Create** → **Workers** → **Import a repository** (ou
   "Connect to Git", dependendo da versão do painel).
3. Autorize o Cloudflare a acessar sua conta do GitHub e selecione o
   repositório que você criou.
4. O Cloudflare detecta automaticamente o arquivo `wrangler.json` e já
   configura o build. Não é necessário digitar comando nenhum — apenas
   confirme e clique em **Deploy**.

## 4. Configurar a chave da API do YouTube

Isso precisa ser feito uma vez, dentro do painel do Cloudflare (nunca no
código, para a chave não ficar exposta):

1. No seu Worker recém-criado, vá em **Settings** → **Variables and
   Secrets**.
2. Clique em **Add** → escolha o tipo **Secret** (não "Text", para que fique
   criptografado).
3. Nome da variável: `CHAVE_API_DO_YOUTUBE`
4. Valor: cole sua chave da YouTube Data API v3 (crie uma em
   [console.cloud.google.com](https://console.cloud.google.com), ativando a
   "YouTube Data API v3" e gerando uma chave de API).
5. Salve. O Cloudflare vai reimplantar o Worker automaticamente com a nova
   variável disponível.

## 5. Testar

1. Abra a URL do seu Worker (algo como
   `https://chat-radio-site.SEU-USUARIO.workers.dev`).
2. Primeiro teste a saúde da API: acesse `/api/health` — deve responder
   `{"ok":true}`.
3. Depois abra a página principal, escolha um apelido e mande uma mensagem.
4. Abra a mesma URL em outra aba (ou peça para outra pessoa acessar) e
   confirme que a mensagem aparece dos dois lados.
5. Clique em **🔍 Pesquisar música**, busque algo e clique num resultado — a
   música deve começar a tocar e aparecer também na outra aba.
6. Teste também digitar `!play nome da música` diretamente no campo de
   mensagem.

## 6. Pontos importantes / limitações que você deve saber

- **Áudio começa mudo**: navegadores bloqueiam áudio com som automático sem
  interação do usuário. Por isso a rádio toca mudo até a pessoa clicar em
  "Ativar áudio" (aparece automaticamente quando há música tocando). Isso é
  uma limitação dos navegadores, não do código — não tem como contornar de
  forma confiável sem esse clique.
- **Sincronização é aproximada**: o "tempo certo" da música é calculado pelo
  relógio do servidor, então pode haver um atraso de 1–2 segundos entre os
  usuários dependendo da conexão de cada um — é o suficiente para todo mundo
  ouvir "junto", mas não é sample-accurate.
- **Cota da API do YouTube**: a busca gratuita da YouTube Data API tem um
  limite diário de cota. Se a busca parar de funcionar de repente com erro
  "quotaExceeded", é isso — normaliza no dia seguinte.
- **Histórico de mensagens**: cada sala guarda as últimas 100 mensagens.
  Mensagens mais antigas que isso não ficam salvas.
- **Sem cadastro/senha**: como pedido, é só apelido salvo no navegador da
  pessoa. Isso significa que qualquer pessoa pode usar qualquer apelido —
  não há autenticação real.

## 7. Como tudo se conecta (resumo técnico)

```
Navegador (public/index.html, style.css, app.js)
        │
        ├── /api/health         → src/index.js responde {"ok": true}
        ├── /api/music?q=...    → src/index.js consulta a YouTube Data API
        │                          usando a variável CHAVE_API_DO_YOUTUBE
        └── /ws?room=nome-sala  → src/index.js encaminha para a Durable
                                   Object ChatRoom daquela sala, que guarda
                                   mensagens, fila de músicas e quem está
                                   conectado, e transmite tudo via WebSocket
```

Cada sala é uma Durable Object independente (o nome da sala vira o
identificador dela), então o histórico e a fila de uma sala nunca se
misturam com os de outra.
