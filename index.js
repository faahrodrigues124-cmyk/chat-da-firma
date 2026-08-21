import { DurableObject } from "cloudflare:workers";

const MAX_MESSAGES = 150;
const MAX_ROOMS = 100;
const MAX_IMAGE_CHARS = 120000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket")
        return new Response("WebSocket required", { status: 426 });
      const id = env.CHAT_ROOM.idFromName("global");
      return env.CHAT_ROOM.get(id).fetch(request);
    }

    if (url.pathname === "/api/search") return searchYouTube(url, env);
    if (url.pathname === "/api/gifs") return searchGifs(url, env);

    return env.ASSETS.fetch(request);
  }
};

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) }
  });
}

async function searchYouTube(url, env) {
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return json({ items: [] });

  const key = env.YOUTUBE_API_KEY;
  if (!key) {
    return json({
      error: "Busca por texto não configurada. Cole um link do YouTube ou adicione YOUTUBE_API_KEY nas variáveis do Worker."
    }, { status: 503 });
  }

  const params = new URLSearchParams({
    part: "snippet",
    q,
    type: "video",
    maxResults: "15",
    videoEmbeddable: "true",
    videoSyndicated: "true",
    key
  });

  const r = await fetch("https://www.googleapis.com/youtube/v3/search?" + params);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); }
  catch { return json({ error: "YouTube retornou uma resposta inválida." }, { status: 502 }); }

  if (!r.ok) {
    return json({ error: data?.error?.message || "YouTube API error" }, { status: r.status });
  }

  return json({
    items: (data.items || [])
      .filter(x => x.id?.videoId)
      .map(x => ({
        videoId: x.id.videoId,
        title: x.snippet.title,
        channelTitle: x.snippet.channelTitle,
        thumbnail: x.snippet.thumbnails?.medium?.url || x.snippet.thumbnails?.default?.url
      }))
  }, { headers: { "cache-control": "public,max-age=30" } });
}

async function searchGifs(url, env) {
  const q = (url.searchParams.get("q") || "funny").trim();
  if (!env.GIPHY_API_KEY) return json({ data: [] });

  const r = await fetch("https://api.giphy.com/v1/gifs/search?" + new URLSearchParams({
    api_key: env.GIPHY_API_KEY,
    limit: "24",
    q
  }));

  const text = await r.text();
  try {
    const d = JSON.parse(text);
    return json({
      data: (d.data || [])
        .map(g => ({ url: g.images?.fixed_width?.url || g.images?.original?.url }))
        .filter(x => x.url)
    });
  } catch {
    return json({ data: [] }, { status: 502 });
  }
}

export class ChatRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        password TEXT NOT NULL DEFAULT '',
        radio_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        room TEXT NOT NULL,
        user TEXT NOT NULL,
        text TEXT,
        image TEXT,
        is_system INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS messages_room_created
      ON messages(room, created_at);
    `);

    const exists = this.ctx.storage.sql
      .exec("SELECT id FROM rooms WHERE id = ?", "geral")
      .toArray();

    if (!exists.length) {
      this.ctx.storage.sql.exec(
        "INSERT INTO rooms(id,name,password,radio_json,created_at) VALUES(?,?,?,?,?)",
        "geral", "geral", "", null, Date.now()
      );
    }
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("WebSocket required", { status: 426 });

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ room: "geral", name: "Visitante" });

    this.send(server, {
      type: "welcome",
      rooms: this.publicRooms(),
      roomState: this.getRadio("geral"),
      messages: this.getMessages("geral")
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === "string"
        ? raw
        : new TextDecoder().decode(raw));
    } catch {
      return this.send(ws, { type: "error", message: "Mensagem inválida." });
    }

    const attachment = ws.deserializeAttachment() || {
      room: "geral",
      name: "Visitante"
    };

    if (msg.type === "createRoom") {
      const id = cleanRoom(msg.room);
      if (!id) return this.send(ws, {
        type: "error",
        message: "Nome de sala inválido."
      });

      const count = this.ctx.storage.sql
        .exec("SELECT COUNT(*) AS n FROM rooms")
        .one().n;

      if (Number(count) >= MAX_ROOMS) {
        const existing = this.ctx.storage.sql
          .exec("SELECT id FROM rooms WHERE id = ?", id)
          .toArray();
        if (!existing.length) {
          return this.send(ws, {
            type: "error",
            message: "Limite de salas atingido."
          });
        }
      }

      this.ctx.storage.sql.exec(
        `INSERT INTO rooms(id,name,password,radio_json,created_at)
         VALUES(?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name`,
        id,
        String(msg.name || id).slice(0, 50),
        String(msg.password || "").slice(0, 100),
        null,
        Date.now()
      );

      const name = cleanName(attachment.name);
      ws.serializeAttachment({ room: id, name });

      this.broadcastAll({ type: "rooms", rooms: this.publicRooms() });
      this.send(ws, { type: "joined", room: id });
      this.sendRoom(ws, id);
      return;
    }

    if (msg.type === "join") {
      const id = cleanRoom(msg.room) || "geral";
      const room = this.getRoom(id);

      if (!room) {
        return this.send(ws, {
          type: "error",
          action: "join",
          message: "Sala não encontrada."
        });
      }

      if (room.password && String(msg.password || "") !== room.password) {
        return this.send(ws, {
          type: "error",
          action: "join",
          message: "Senha incorreta."
        });
      }

      const name = cleanName(msg.name || attachment.name);
      ws.serializeAttachment({ room: id, name });

      this.send(ws, { type: "joined", room: id });
      this.sendRoom(ws, id);
      return;
    }

    if (msg.type === "rename") {
      const room = cleanRoom(attachment.room) || "geral";
      ws.serializeAttachment({
        room,
        name: cleanName(msg.name)
      });
      return;
    }

    if (msg.type === "message") {
      const room = cleanRoom(msg.room || attachment.room) || "geral";
      if (!this.getRoom(room)) return;

      const text = msg.message?.text
        ? String(msg.message.text).slice(0, 4000)
        : null;

      const image = msg.message?.image
        ? String(msg.message.image).slice(0, MAX_IMAGE_CHARS)
        : null;

      if (!text && !image) return;

      const item = {
        id: crypto.randomUUID(),
        room,
        user: cleanName(attachment.name),
        text,
        image,
        createdAt: Date.now()
      };

      this.ctx.storage.sql.exec(
        `INSERT INTO messages
         (id,room,user,text,image,is_system,created_at)
         VALUES(?,?,?,?,?,?,?)`,
        item.id, item.room, item.user, item.text, item.image, 0, item.createdAt
      );

      this.trimMessages(room);
      this.broadcastRoom(room, {
        type: "message",
        message: item
      });
      return;
    }

    if (msg.type === "radio") {
      const room = cleanRoom(msg.room || attachment.room) || "geral";
      if (!this.getRoom(room)) return;

      const s = msg.state || {};
      const videoId = String(s.videoId || "");

      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        return this.send(ws, {
          type: "error",
          message: "Vídeo do YouTube inválido."
        });
      }

      const state = {
        videoId,
        title: String(s.title || "Música").slice(0, 300),
        playing: s.playing !== false,
        startedAt: Number(s.startedAt) || Date.now(),
        startedBy: cleanName(attachment.name)
      };

      this.ctx.storage.sql.exec(
        "UPDATE rooms SET radio_json = ? WHERE id = ?",
        JSON.stringify(state),
        room
      );

      const system = {
        id: crypto.randomUUID(),
        room,
        user: "🤖 Rádio",
        text: `${state.startedBy} colocou: ${state.title}`,
        image: null,
        isSystem: true,
        createdAt: Date.now()
      };

      this.ctx.storage.sql.exec(
        `INSERT INTO messages
         (id,room,user,text,image,is_system,created_at)
         VALUES(?,?,?,?,?,?,?)`,
        system.id, system.room, system.user, system.text,
        null, 1, system.createdAt
      );

      this.trimMessages(room);

      this.broadcastRoom(room, {
        type: "radio",
        room,
        state
      });

      this.broadcastRoom(room, {
        type: "message",
        message: system
      });
    }
  }

  async webSocketClose(ws) {}
  async webSocketError(ws) {}

  getRoom(id) {
    return this.ctx.storage.sql
      .exec(
        "SELECT id,name,password,radio_json,created_at FROM rooms WHERE id = ?",
        id
      )
      .toArray()[0] || null;
  }

  getRadio(id) {
    const room = this.getRoom(id);
    if (!room?.radio_json) return null;
    try { return JSON.parse(room.radio_json); }
    catch { return null; }
  }

  getMessages(room) {
    const rows = this.ctx.storage.sql.exec(
      `SELECT id,room,user,text,image,is_system,created_at
       FROM messages
       WHERE room = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      room, MAX_MESSAGES
    ).toArray();

    return rows.reverse().map(r => ({
      id: r.id,
      room: r.room,
      user: r.user,
      text: r.text,
      image: r.image,
      isSystem: !!r.is_system,
      createdAt: r.created_at
    }));
  }

  trimMessages(room) {
    this.ctx.storage.sql.exec(
      `DELETE FROM messages
       WHERE room = ?
       AND id NOT IN (
         SELECT id FROM messages
         WHERE room = ?
         ORDER BY created_at DESC
         LIMIT ?
       )`,
      room, room, MAX_MESSAGES
    );
  }

  publicRooms() {
    const rows = this.ctx.storage.sql
      .exec("SELECT id,name,password FROM rooms ORDER BY created_at ASC")
      .toArray();

    return Object.fromEntries(rows.map(r => [
      r.id,
      {
        name: r.name || r.id,
        password: !!r.password
      }
    ]));
  }

  sendRoom(ws, room) {
    this.send(ws, {
      type: "history",
      room,
      messages: this.getMessages(room)
    });

    this.send(ws, {
      type: "radio",
      room,
      state: this.getRadio(room)
    });

    this.send(ws, {
      type: "rooms",
      rooms: this.publicRooms()
    });
  }

  send(ws, data) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    } catch {}
  }

  broadcastRoom(room, data) {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a?.room === room) this.send(ws, data);
    }
  }

  broadcastAll(data) {
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, data);
    }
  }
}

function cleanRoom(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function cleanName(v) {
  const n = String(v || "Visitante")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 40);

  return n || "Visitante";
}
