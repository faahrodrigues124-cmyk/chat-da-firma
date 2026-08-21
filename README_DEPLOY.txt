CHAT DA FIRMA - DEPLOY CLOUDFLARE

IMPORTANTE: os arquivos deste pacote devem ficar NA RAIZ do repositorio GitHub.

ESTRUTURA EXATA:
public/index.html
src/index.js
wrangler.json

NAO crie uma pasta chamada chat-da-firma-FINAL dentro do repositorio.

O Cloudflare deve usar:
npx wrangler deploy

No Cloudflare, cadastre o Secret:
YOUTUBE_API_KEY = sua chave da YouTube Data API v3

O arquivo src/index.js e o Worker. O arquivo public/index.html e o site.
