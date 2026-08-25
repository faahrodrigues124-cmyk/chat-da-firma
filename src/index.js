const MAX_MENSAGEM = 500;
const MAX_NOME = 30;
const SESSION_DIAS = 30;
const MAX_FILA = 50;
const MAX_HISTORICO = 150;
const ADMIN_USUARIO = "fab";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}

async function hashSenha(senha) {
  const bytes = new TextEncoder().encode(String(senha));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function tokenNovo() { return `${crypto.randomUUID()}-${crypto.randomUUID()}`; }

function tokenDaRequest(request) {
  const auth = request.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const header = request.headers.get("x-session-token") || "";
  if (header) return header;
  return new URL(request.url).searchParams.get("token") || "";
}

async function appData(env, path, options = {}) {
  const stub = env.APP_DATA.get(env.APP_DATA.idFromName("global"));
  return stub.fetch(new Request(`https://app-data.internal${path}`, options));
}

async function usuarioAtual(request, env) {
  const token = tokenDaRequest(request);
  if (!token) return null;
  const r = await appData(env, `/internal/session/${encodeURIComponent(token)}`);
  return r.ok ? r.json() : null;
}

let youtubeKeyIndex = 0;
let youtubeKeyBlockedUntil = 0;

function youtubeKeys(env) {
  return [
    env.CHAVE_API_DO_YOUTUBE,
    env.CHAVE_API_DO_YOUTUBE_2,
    env.CHAVE_API_DO_YOUTUBE_3,
  ].map((key) => String(key || '').trim()).filter(Boolean);
}

function youtubeQuotaError(data, status) {
  const reasons = Array.isArray(data?.error?.errors)
    ? data.error.errors.map((x) => String(x?.reason || '').toLowerCase())
    : [];
  const message = String(data?.error?.message || '').toLowerCase();
  return status === 403 || reasons.some((r) => r.includes('quota')) || message.includes('quota');
}

async function buscarMusica(url, env) {
  const termo = (url.searchParams.get("q") || "").trim();
  if (!termo) return json({ ok: false, error: "Informe uma busca." }, 400);

  const keys = youtubeKeys(env);
  if (!keys.length) {
    return json({
      ok: false,
      error: "Nenhuma chave do YouTube está configurada no Worker.",
    }, 500);
  }

  const agora = Date.now();
  if (agora >= youtubeKeyBlockedUntil) youtubeKeyBlockedUntil = 0;

  const inicio = Math.min(youtubeKeyIndex, keys.length - 1);
  let ultimaMensagem = "Não foi possível pesquisar no YouTube.";
  let ultimaStatus = 502;

  for (let tentativa = 0; tentativa < keys.length; tentativa++) {
    const indice = (inicio + tentativa) % keys.length;
    const key = keys[indice];

    // Se uma chave já falhou por cota nesta instância, pule-a temporariamente.
    if (youtubeKeyBlockedUntil > agora && indice === youtubeKeyIndex && keys.length > 1) continue;

    const api = new URL("https://www.googleapis.com/youtube/v3/search");
    api.searchParams.set("part", "snippet");
    api.searchParams.set("type", "video");
    api.searchParams.set("maxResults", "10");
    api.searchParams.set("videoEmbeddable", "true");
    api.searchParams.set("q", termo);
    api.searchParams.set("key", key);

    let response;
    try {
      response = await fetch(api);
    } catch {
      ultimaMensagem = "Falha ao consultar o YouTube.";
      ultimaStatus = 502;
      continue;
    }

    const raw = await response.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      ultimaMensagem = "Resposta inválida do YouTube.";
      ultimaStatus = 502;
      continue;
    }

    if (response.ok && !data.error) {
      youtubeKeyIndex = indice;
      youtubeKeyBlockedUntil = 0;
      const results = (data.items || [])
        .filter((x) => x.id?.videoId && x.snippet)
        .map((x) => ({
          id: x.id.videoId,
          title: x.snippet.title,
          channel: x.snippet.channelTitle,
          thumbnail:
            x.snippet.thumbnails?.high?.url ||
            x.snippet.thumbnails?.medium?.url ||
            x.snippet.thumbnails?.default?.url ||
            "",
        }));
      return json({ ok: true, results });
    }

    ultimaMensagem = data.error?.message || `YouTube respondeu ${response.status}.`;
    ultimaStatus = response.status || 502;

    // 403/quota: tenta automaticamente a próxima chave.
    if (youtubeQuotaError(data, response.status)) {
      if (indice === youtubeKeyIndex && keys.length > 1) {
        youtubeKeyBlockedUntil = Date.now() + 10 * 60 * 1000;
      }
      youtubeKeyIndex = (indice + 1) % keys.length;
      continue;
    }

    // Erro específico dessa chave: tenta as demais para manter a busca disponível.
    if (response.status === 400 || response.status === 401) {
      youtubeKeyIndex = (indice + 1) % keys.length;
      continue;
    }

    return json({ ok: false, error: ultimaMensagem }, ultimaStatus >= 400 ? ultimaStatus : 502);
  }

  return json({
    ok: false,
    error: `Todas as chaves disponíveis falharam. ${ultimaMensagem}`,
  }, ultimaStatus >= 400 ? ultimaStatus : 502);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type, authorization, x-session-token",
    }});

    if (url.pathname === "/api/health") return json({ ok: true });
    if (url.pathname === "/api/music") return buscarMusica(url, env);

    if (url.pathname === "/api/auth/register" && request.method === "POST") {
      const b = await request.json().catch(() => ({}));
      const nome = String(b.nome || "").trim();
      const senha = String(b.senha || "");
      if (nome.length < 3 || nome.length > MAX_NOME) return json({ ok: false, error: "O usuário deve ter entre 3 e 30 caracteres." }, 400);
      if (senha.length < 6) return json({ ok: false, error: "A senha deve ter pelo menos 6 caracteres." }, 400);
      const r = await appData(env, "/internal/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nome, senhaHash: await hashSenha(senha) }) });
      return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      const b = await request.json().catch(() => ({}));
      const r = await appData(env, "/internal/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nome: String(b.nome || "").trim(), senhaHash: await hashSenha(String(b.senha || "")) }) });
      return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }

    if (url.pathname === "/api/auth/me") {
      const user = await usuarioAtual(request, env);
      return user ? json({ ok: true, user }) : json({ ok: false, error: "Sessão expirada." }, 401);
    }

    if (url.pathname === "/api/config" && request.method === "GET") {
      const r = await appData(env, "/internal/config");
      return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }

    if (url.pathname === "/api/settings/profile" && request.method === "POST") {
      const user = await usuarioAtual(request, env);
      if (!user) return json({ ok: false, error: "Faça login." }, 401);
      const b = await request.json().catch(() => ({}));
      const displayName = String(b.displayName || "").trim();
      if (displayName.length < 2 || displayName.length > MAX_NOME) return json({ ok: false, error: "O nome de exibição deve ter entre 2 e 30 caracteres." }, 400);
      const r = await appData(env, "/internal/settings/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: user.id, displayName }) });
      return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }

    if (url.pathname === "/api/admin/settings" && request.method === "POST") {
      const user = await usuarioAtual(request, env);
      if (!user || user.role !== "admin") return json({ ok: false, error: "Acesso restrito ao administrador." }, 403);
      const b = await request.json().catch(() => ({}));
      const siteName = String(b.siteName || "").trim();
      if (siteName.length < 2 || siteName.length > 40) return json({ ok: false, error: "O nome do site deve ter entre 2 e 40 caracteres." }, 400);
      const r = await appData(env, "/internal/admin/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteName }) });
      return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }

    if (url.pathname === "/api/rooms" && request.method === "GET") {
      if (!await usuarioAtual(request, env)) return json({ ok: false, error: "Faça login." }, 401);
      const r = await appData(env, "/internal/rooms");
      return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const user = await usuarioAtual(request, env);
      if (!user) return json({ ok: false, error: "Faça login." }, 401);
      const b = await request.json().catch(() => ({}));
      const nome = String(b.nome || "").trim().toLowerCase().replace(/\s+/g, "-");
      const senha = String(b.senha || "");
      if (!nome || nome.length > MAX_NOME) return json({ ok: false, error: "Nome de sala inválido." }, 400);
      if (senha && senha.length < 4) return json({ ok: false, error: "A senha deve ter pelo menos 4 caracteres." }, 400);
      const r = await appData(env, "/internal/rooms/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nome, accent: String(b.accent || "violet"), senhaHash: senha ? await hashSenha(senha) : "", ownerId: user.id, ownerName: user.nome }) });
      return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }

    if (url.pathname.startsWith("/api/admin/rooms/clear-all") && request.method === "POST") {
      const user = await usuarioAtual(request, env);
      if (!user || user.role !== "admin") return json({ ok: false, error: "Acesso restrito ao administrador." }, 403);
      const r = await appData(env, "/internal/rooms");
      const data = await r.json();
      for (const room of data.rooms || []) {
        const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(room.nome));
        await stub.fetch(new Request("https://admin.internal/admin/clear", { method: "POST" }));
      }
      return json({ ok: true });
    }

    if (url.pathname.startsWith("/api/admin/rooms/") && url.pathname.endsWith("/clear") && request.method === "POST") {
      const user = await usuarioAtual(request, env);
      if (!user || user.role !== "admin") return json({ ok: false, error: "Acesso restrito ao administrador." }, 403);
      const name = decodeURIComponent(url.pathname.split("/")[4] || "").toLowerCase();
      const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(name));
      const r = await stub.fetch(new Request("https://admin.internal/admin/clear", { method: "POST" }));
      return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
    }

    if (url.pathname.startsWith("/api/admin/rooms/") && request.method === "DELETE") {
      const user = await usuarioAtual(request, env);
      if (!user || user.role !== "admin") return json({ ok: false, error: "Acesso restrito ao administrador." }, 403);
      const name = decodeURIComponent(url.pathname.split("/").pop() || "").toLowerCase();
      if (!name || name === "geral") return json({ ok: false, error: "A sala geral não pode ser apagada." }, 400);
      const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(name));
      await stub.fetch(new Request("https://admin.internal/admin/delete", { method: "POST" }));
      const r = await appData(env, `/internal/rooms/${encodeURIComponent(name)}`, { method: "DELETE" });
      return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/api/admin/rooms" && request.method === "GET") {
      const user = await usuarioAtual(request, env);
      if (!user || user.role !== "admin") return json({ ok: false, error: "Acesso restrito ao administrador." }, 403);
      const r = await appData(env, "/internal/rooms");
      return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
    }

    if (url.pathname === "/ws") {
      // Não recriamos o Request de WebSocket aqui: o clone pode perder o upgrade
      // em alguns runtimes. O próprio Durable Object valida a sessão e a sala.
      const roomName = (url.searchParams.get("room") || "geral").trim().slice(0, MAX_NOME).toLowerCase();
      if (!roomName) return new Response("Sala inválida.", { status: 400 });
      const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(roomName));
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};

class AppData {
  constructor(state) {
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      this.users = await this.state.storage.get("users") || {};
      this.sessions = await this.state.storage.get("sessions") || {};
      this.rooms = await this.state.storage.get("rooms") || {};
      this.config = await this.state.storage.get("config") || { siteName: "Chat da Firma" };
      if (!this.config.siteName) this.config.siteName = "Chat da Firma";
      if (!this.rooms.geral) this.rooms.geral = { nome: "geral", accent: "violet", senhaHash: "", ownerId: "", ownerName: "Sistema" };
      let changed = false;
      for (const user of Object.values(this.users)) {
        const role = user.nome.toLowerCase() === ADMIN_USUARIO ? "admin" : "user";
        if (user.role !== role) { user.role = role; changed = true; }
      }
      if (changed) await this.persist();
    });
  }
  async persist() { await this.state.storage.put({ users: this.users, sessions: this.sessions, rooms: this.rooms, config: this.config }); }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/internal/register" && request.method === "POST") {
      const b = await request.json(); const key = String(b.nome).toLowerCase();
      if (this.users[key]) return json({ ok: false, error: "Esse usuário já existe." }, 409);
      const id = crypto.randomUUID(); this.users[key] = { id, nome: b.nome, displayName: b.nome, senhaHash: b.senhaHash, role: key === ADMIN_USUARIO ? "admin" : "user" };
      const token = tokenNovo(); this.sessions[token] = { userId: id, expiresAt: Date.now() + SESSION_DIAS * 86400000 }; await this.persist();
      return json({ ok: true, token, user: { id, nome: b.nome, displayName: this.users[key].displayName || b.nome, role: this.users[key].role } });
    }
    if (url.pathname === "/internal/login" && request.method === "POST") {
      const b = await request.json(); const user = this.users[String(b.nome || "").toLowerCase()];
      if (!user || user.senhaHash !== b.senhaHash) return json({ ok: false, error: "Usuário ou senha incorretos." }, 401);
      user.role = user.nome.toLowerCase() === ADMIN_USUARIO ? "admin" : "user";
      const token = tokenNovo(); this.sessions[token] = { userId: user.id, expiresAt: Date.now() + SESSION_DIAS * 86400000 }; await this.persist();
      return json({ ok: true, token, user: { id: user.id, nome: user.nome, displayName: user.displayName || user.nome, role: user.role } });
    }
    if (url.pathname.startsWith("/internal/session/")) {
      const token = decodeURIComponent(url.pathname.split("/").pop()); const sess = this.sessions[token];
      if (!sess || sess.expiresAt < Date.now()) return json({ ok: false }, 401);
      const user = Object.values(this.users).find((u) => u.id === sess.userId); if (!user) return json({ ok: false }, 401);
      user.role = user.nome.toLowerCase() === ADMIN_USUARIO ? "admin" : "user";
      return json({ id: user.id, nome: user.nome, displayName: user.displayName || user.nome, role: user.role });
    }
    if (url.pathname === "/internal/config") return json({ ok: true, siteName: this.config.siteName || "Chat da Firma" });
    if (url.pathname === "/internal/settings/profile" && request.method === "POST") {
      const b = await request.json();
      const user = Object.values(this.users).find((u) => u.id === String(b.userId || ""));
      if (!user) return json({ ok: false, error: "Usuário não encontrado." }, 404);
      const displayName = String(b.displayName || "").trim();
      if (displayName.length < 2 || displayName.length > MAX_NOME) return json({ ok: false, error: "Nome de exibição inválido." }, 400);
      user.displayName = displayName;
      await this.persist();
      return json({ ok: true, user: { id: user.id, nome: user.nome, displayName: user.displayName, role: user.role } });
    }
    if (url.pathname === "/internal/admin/settings" && request.method === "POST") {
      const b = await request.json();
      this.config.siteName = String(b.siteName || "Chat da Firma").trim().slice(0, 40) || "Chat da Firma";
      await this.persist();
      return json({ ok: true, siteName: this.config.siteName });
    }
    if (url.pathname === "/internal/rooms") return json({ ok: true, rooms: Object.values(this.rooms).map(({ senhaHash, ...r }) => ({ ...r, protegida: Boolean(senhaHash) })) });
    if (url.pathname.startsWith("/internal/room/")) {
      const name = decodeURIComponent(url.pathname.split("/").pop()).toLowerCase(); const room = this.rooms[name];
      return room ? json({ ok: true, ...room }) : json({ ok: false }, 404);
    }
    if (url.pathname.startsWith("/internal/rooms/") && request.method === "DELETE") {
      const name = decodeURIComponent(url.pathname.split("/").pop()).toLowerCase();
      if (!this.rooms[name]) return json({ ok: false, error: "Sala não encontrada." }, 404);
      if (name === "geral") return json({ ok: false, error: "A sala geral não pode ser apagada." }, 400);
      delete this.rooms[name]; await this.persist(); return json({ ok: true });
    }
    if (url.pathname === "/internal/rooms/create" && request.method === "POST") {
      const b = await request.json(); const name = String(b.nome).toLowerCase();
      if (this.rooms[name]) return json({ ok: false, error: "Essa sala já existe." }, 409);
      this.rooms[name] = { nome: name, accent: b.accent || "violet", senhaHash: b.senhaHash || "", ownerId: b.ownerId, ownerName: b.ownerName };
      await this.persist(); return json({ ok: true, room: { ...this.rooms[name], protegida: Boolean(b.senhaHash) } });
    }
    return json({ ok: false, error: "Rota interna inválida." }, 404);
  }
}

export class ChatRoom {
  constructor(state, env) {
    this.state = state; this.env = env; this.sessoes = new Map(); this.mensagens = []; this.fila = []; this.tocandoAgora = null; this.senhaHash = ""; this.ownerId = ""; this.ultimoAvancoEm = 0;
    this.state.blockConcurrencyWhile(async () => {
      const s = await this.state.storage.get(["mensagens", "fila", "tocandoAgora", "senhaHash", "ownerId"]);
      this.mensagens = s.get("mensagens") || []; this.fila = s.get("fila") || []; this.tocandoAgora = s.get("tocandoAgora") || null; this.senhaHash = s.get("senhaHash") || ""; this.ownerId = s.get("ownerId") || "";
    });
  }
  async persistir() { await this.state.storage.put({ mensagens: this.mensagens, fila: this.fila, tocandoAgora: this.tocandoAgora, senhaHash: this.senhaHash, ownerId: this.ownerId }); }
  enviar(socket, data) { try { socket.send(JSON.stringify(data)); } catch {} }
  transmitir(data) { const raw = JSON.stringify(data); for (const s of this.sessoes.keys()) { try { s.send(raw); } catch {} } }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname.endsWith("/admin/clear")) { this.mensagens = []; await this.persistir(); this.transmitir({ type: "mensagens_limpas" }); return json({ ok: true }); }
    if (request.method === "POST" && url.pathname.endsWith("/admin/delete")) { this.transmitir({ type: "sala_excluida" }); for (const s of this.sessoes.keys()) { try { s.close(1000, "Sala removida"); } catch {} } await this.state.storage.deleteAll(); return json({ ok: true }); }
    if (request.headers.get("Upgrade") !== "websocket") return new Response("WebSocket esperado.", { status: 426 });

    // Valida a sessão diretamente no Durable Object. Isso mantém o Request
    // original do WebSocket intacto e evita falhas de conexão causadas por
    // reconstrução do Request no Worker principal.
    const urlToken = new URL(request.url).searchParams.get("token") || "";
    if (!urlToken || !this.env?.APP_DATA) return new Response("Sessão inválida.", { status: 401 });
    const dataStub = this.env.APP_DATA.get(this.env.APP_DATA.idFromName("global"));
    const sessionResp = await dataStub.fetch(new Request(`https://app-data.internal/internal/session/${encodeURIComponent(urlToken)}`));
    if (!sessionResp.ok) return new Response("Sessão inválida.", { status: 401 });
    const user = await sessionResp.json();

    const roomName = new URL(request.url).searchParams.get("room") || "geral";
    const roomResp = await dataStub.fetch(new Request(`https://app-data.internal/internal/room/${encodeURIComponent(roomName.toLowerCase())}`));
    if (!roomResp.ok) return new Response("Sala não encontrada.", { status: 404 });
    const room = await roomResp.json();
    this.senhaHash = room.senhaHash || "";
    this.ownerId = room.ownerId || "";

    const pair = new WebSocketPair(); const [client, server] = Object.values(pair); server.accept();
    const session = { nome: user.displayName || user.nome || "Visitante", usuarioId: user.id || "", role: user.role || "user", autenticado: false };
    this.sessoes.set(server, session);
    this.enviar(server, { type: "autenticacao_necessaria", protegida: Boolean(this.senhaHash) });
    server.addEventListener("message", (e) => this.mensagem(server, e.data));
    const off = () => { this.sessoes.delete(server); this.presenca(); }; server.addEventListener("close", off); server.addEventListener("error", off);
    return new Response(null, { status: 101, webSocket: client });
  }
  presenca() { const users = [...this.sessoes.values()].filter((s) => s.autenticado).map((s) => s.nome); this.transmitir({ type: "presenca", total: users.length, usuarios: users }); }
  async mensagem(socket, raw) {
    let d; try { d = JSON.parse(raw); } catch { this.enviar(socket, { type: "erro", message: "Mensagem inválida." }); return; }
    const s = this.sessoes.get(socket); if (!s) return;
    if (d.type === "entrar") {
      if (this.senhaHash && d.senhaHash !== this.senhaHash) { this.enviar(socket, { type: "erro", code: "SENHA_INCORRETA", message: "Senha da sala incorreta." }); return; }
      s.autenticado = true;
      this.enviar(socket, { type: "estado_inicial", mensagens: this.mensagens, fila: this.fila, tocandoAgora: this.tocandoAgora, ownerId: this.ownerId }); this.presenca(); return;
    }
    if (!s.autenticado) return;
    if (d.type === "mensagem") {
      const text = String(d.text || "").trim(); if (!text) return; if (text.length > MAX_MENSAGEM) return this.enviar(socket, { type: "erro", message: `Mensagem muito longa (máx. ${MAX_MENSAGEM}).` });
      const msg = { id: crypto.randomUUID(), autorId: s.usuarioId, nome: s.nome, text, ts: Date.now(), reacoes: {} }; this.mensagens.push(msg); if (this.mensagens.length > MAX_HISTORICO) this.mensagens.shift(); await this.persistir(); this.transmitir({ type: "mensagem", mensagem: msg }); return;
    }
    if (d.type === "reacao") {
      const m = this.mensagens.find((x) => x.id === d.messageId); if (!m || !d.emoji) return; m.reacoes[d.emoji] = (m.reacoes[d.emoji] || 0) + 1; await this.persistir(); this.transmitir({ type: "reacao", messageId: d.messageId, emoji: d.emoji, total: m.reacoes[d.emoji] }); return;
    }
    if (d.type === "limpar_mensagens") {
      if (s.usuarioId !== this.ownerId) return this.enviar(socket, { type: "erro", message: "Somente o criador da sala pode limpar esta conversa." });
      this.mensagens = []; await this.persistir(); this.transmitir({ type: "mensagens_limpas" }); return;
    }
    if (d.type === "fila_adicionar") {
      if (!d.id || !d.title) return;
      const music = { id: d.id, title: d.title, channel: d.channel || "", thumbnail: d.thumbnail || "" };
      if (!this.tocandoAgora) this.tocandoAgora = { ...music, startedAt: Date.now(), position: 0, paused: false };
      else if (this.fila.length < MAX_FILA) this.fila.push(music);
      else return this.enviar(socket, { type: "erro", message: "Fila cheia." });
      await this.persistir(); this.transmitir({ type: "tocando_agora", tocandoAgora: this.tocandoAgora, fila: this.fila }); return;
    }
    if (d.type === "pausar_musica") {
      if (!this.tocandoAgora || this.tocandoAgora.paused) return;
      let position = Number(d.position); if (!Number.isFinite(position) || position < 0) position = Math.max(0, (Date.now() - this.tocandoAgora.startedAt) / 1000);
      this.tocandoAgora = { ...this.tocandoAgora, position, paused: true, pausedAt: Date.now() };
      await this.persistir(); this.transmitir({ type: "tocando_agora", tocandoAgora: this.tocandoAgora, fila: this.fila }); return;
    }
    if (d.type === "continuar_musica") {
      if (!this.tocandoAgora || !this.tocandoAgora.paused) return;
      const position = Number(this.tocandoAgora.position || 0);
      this.tocandoAgora = { ...this.tocandoAgora, position, startedAt: Date.now() - position * 1000, paused: false, pausedAt: 0 };
      await this.persistir(); this.transmitir({ type: "tocando_agora", tocandoAgora: this.tocandoAgora, fila: this.fila }); return;
    }
    if (d.type === "proxima_musica") {
      if (!this.tocandoAgora) return;
      if (d.videoId && d.videoId !== this.tocandoAgora.id) return;
      const now = Date.now(); if (now - this.ultimoAvancoEm < 3500) return; this.ultimoAvancoEm = now;
      this.tocandoAgora = this.fila.length ? { ...this.fila.shift(), startedAt: now, position: 0, paused: false } : null;
      await this.persistir(); this.transmitir({ type: "tocando_agora", tocandoAgora: this.tocandoAgora, fila: this.fila }); return;
    }
  }
}

export { AppData };
