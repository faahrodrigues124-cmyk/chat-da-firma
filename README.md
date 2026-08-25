# Chat da Firma

Versão consolidada: chat, salas, WebSocket/Durable Objects, rádio sincronizada, mixer de volume por usuário, recomendações automáticas, GIFs pesquisáveis, envio por colar/arrastar, cards de música no chat, capa em vinil, cor ambiente, transição visual suave e recap de 7 dias.

## Cloudflare Secrets

Configure no Worker:
- CHAVE_API_DO_YOUTUBE
- CHAVE_API_DO_YOUTUBE_2
- CHAVE_API_DO_YOUTUBE_3

As três são usadas em rotação quando uma chave do YouTube atingir a cota.
