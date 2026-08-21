CHAT DA FIRMA — V9 CLOUDFLARE

1. O projeto foi preparado para Cloudflare Workers + Assets.
2. O index.html fica em public/.
3. worker.js cria a rota /api/youtube-search e chama a YouTube Data API v3.
4. Configure YOUTUBE_API_KEY em Cloudflare > Workers & Pages > chat-da-firma > Settings > Variables and Secrets.
5. O deploy usa npx wrangler deploy e lê o wrangler.toml.
6. O chat usa Firebase/Firestore.
7. A rádio usa o player oficial do YouTube e sincroniza a posição pelo Firestore.
8. O botão Ativar áudio libera a reprodução após interação do usuário.
9. O erro JavaScript do modal GIF foi removido para que o restante do aplicativo continue executando.
10. A busca não usa mais /.netlify/functions; usa /api/youtube-search.
