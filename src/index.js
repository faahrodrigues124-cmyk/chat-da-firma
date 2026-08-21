import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // WebSocket do chat
    if (url.pathname.startsWith("/ws")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket esperado", { status: 426 });
      }

      const roomId = env.CHAT_ROOM.idFromName("geral");
      const room = env.CHAT_ROOM.get(roomId);

      return room.fetch(request);
    }

    // API de busca de música
    if (url.pathname === "/api/music") {
      const query = url.searchParams.get("q")?.trim();

      if (!query) {
        return Response.json(
          { error: "Digite o nome da música ou artista." },
          { status: 400 }
        );
      }

      const apiKey = env.CHAVE_API_DO_YOUTUBE;

      if (!apiKey) {
        return Response.json(
          { error: "API do YouTube não configurada." },
          { status: 500 }
        );
      }

      try {
        const youtubeUrl =
          "https://www.googleapis.com/youtube/v3/search" +
          "?part=snippet&type=video&maxResults=10" +
          "&q=" +
          encodeURIComponent(query) +
          "&key=" +
          encodeURIComponent(apiKey);

        const response = await fetch(youtubeUrl);

        const text = await response.text();

        if (!response.ok) {
          return Response.json(
            {
              error: "Erro na API do YouTube",
              details: text
            },
            { status: response.status }
          );
        }

        let data;

        try {
          data = JSON.parse(text);
        } catch {
          return Response.json(
            {
              error: "A API retornou uma resposta inválida."
            },
            { status: 502 }
          );
        }

        const results = (data.items || []).map((item) => ({
          id: item.id?.videoId,
          title: item.snippet?.title || "",
          channel: item.snippet?.channelTitle || "",
          thumbnail:
            item.snippet?.thumbnails?.medium?.url ||
            item.snippet?.thumbnails?.default?.url ||
            ""
        }));

        return Response.json({ results });
      } catch (error) {
        return Response.json(
          {
            error: "Falha ao buscar música.",
            details: error?.message || String(error)
          },
          { status: 500 }
        );
      }
    }

    // API de teste
    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        chat: true,
        music: true
      });
    }

    // Site
    return env.ASSETS.fetch(request);
  }
};

export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket esperado", { status: 426 });
    }

    const pair = new WebSocketPair();

    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);

    server.serializeAttachment({
      connectedAt: Date.now()
    });

    server.send(
      JSON.stringify({
        type: "system",
        text: "Conectado ao chat."
      })
    );

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  async webSocketMessage(ws, message) {
    let data;

    try {
      data = JSON.parse(message);
    } catch {
      data = {
        type: "message",
        text: String(message)
      };
    }

    if (data.type === "message") {
      const text = String(data.text || "").trim();

      if (!text) return;

      const payload = JSON.stringify({
        type: "message",
        text,
        user: data.user || "Usuário",
        time: Date.now()
      });

      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(payload);
        } catch {}
      }
    }
  }

  async webSocketClose(ws) {
    try {
      ws.close();
    } catch {}
  }

  async webSocketError(ws) {
    try {
      ws.close();
    } catch {}
  }
}
