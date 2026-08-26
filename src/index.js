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

// Cache de resultados do YouTube guardado na própria Durable Object AppData
// (compartilhado por todas as salas). Evita repetir a mesma busca/recomendação
// na API quando alguém já pesquisou ou já tocou aquela música recentemente.
async function cacheYoutubeGet(env, chave, ttlMs) {
  try {
    const r = await appData(env, "/internal/music-cache/get", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: chave, ttlMs }),
    });
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    return d && d.hit ? d.results : null;
  } catch { return null; }
}
async function cacheYoutubeSet(env, chave, results) {
  try {
    await appData(env, "/internal/music-cache/set", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: chave, results }),
    });
  } catch { /* cache é um extra: se falhar, o site continua funcionando normalmente */ }
}

// Junta todas as chaves de API do YouTube configuradas no Worker. A segunda
// e a terceira são opcionais — se não existirem, o site funciona só com a
// primeira, exatamente como antes.
let youtubeKeyCursor = 0;

function chavesYoutube(env) {
  return [env.CHAVE_API_DO_YOUTUBE, env.CHAVE_API_DO_YOUTUBE_2, env.CHAVE_API_DO_YOUTUBE_3].filter(Boolean);
}

// Chama a API do YouTube tentando cada chave configurada em ordem. Se uma
// chave estiver com a cota diária estourada, tenta a próxima
// automaticamente antes de desistir — assim a busca continua funcionando
// enquanto pelo menos uma das chaves ainda tiver cota sobrando no dia.
async function chamarYoutube(caminho, parametros, env) {
  const chaves = chavesYoutube(env);
  if (!chaves.length) return { ok: false, status: 500, error: "Nenhuma chave de API do YouTube está configurada no Worker." };

  // Distribui as requisições entre as chaves disponíveis. Se a chave escolhida
  // estiver sem cota, ela é pulada e a próxima é tentada imediatamente.
  // O cursor é por instância do Worker (best-effort) e o fallback por cota
  // continua funcionando mesmo quando uma nova instância é criada.
  const startIndex = youtubeKeyCursor % chaves.length;
  youtubeKeyCursor = (youtubeKeyCursor + 1) % chaves.length;
  let ultimoErro = null;

  for (let tentativa = 0; tentativa < chaves.length; tentativa++) {
    const indice = (startIndex + tentativa) % chaves.length;
    const chave = chaves[indice];
    const api = new URL(`https://www.googleapis.com/youtube/v3/${caminho}`);
    for (const [k, v] of Object.entries(parametros)) api.searchParams.set(k, v);
    api.searchParams.set("key", chave);

    let response;
    try { response = await fetch(api); } catch {
      ultimoErro = { ok: false, status: 502, error: "Falha ao consultar o YouTube." };
      continue;
    }
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch {
      ultimoErro = { ok: false, status: 502, error: "Resposta inválida do YouTube." };
      continue;
    }

    if (response.ok && !data.error) return { ok: true, data, keySlot: indice + 1 };

    const reasons = (data.error?.errors || []).map((e) => String(e.reason || "").toLowerCase());
    const status = String(data.error?.status || "").toUpperCase();
    const cotaEstourada =
      reasons.some((r) => ["quotaexceeded", "dailylimitexceeded", "ratelimitexceeded", "userratelimitexceeded"].includes(r)) ||
      ["RESOURCE_EXHAUSTED", "RATE_LIMIT_EXCEEDED"].includes(status) ||
      response.status === 429;

    ultimoErro = {
      ok: false,
      status: cotaEstourada ? 429 : 502,
      error: data.error?.message || `YouTube respondeu ${response.status}.`,
      cotaEstourada,
      keySlot: indice + 1,
    };
    if (!cotaEstourada) return ultimoErro;
    // Cota da chave atual esgotada: tenta a próxima sem devolver o erro ao cliente.
  }

  return ultimoErro || { ok: false, status: 429, error: "Todas as chaves do YouTube estão com a cota estourada.", cotaEstourada: true };
}

async function buscarMusica(url, env) {
  const termo = (url.searchParams.get("q") || "").trim();
  if (!termo) return json({ ok: false, error: "Informe uma busca." }, 400);

  const chaveCache = `busca:v5:${termo.toLowerCase()}`;
  const emCache = await cacheYoutubeGet(env, chaveCache, 6 * 60 * 60 * 1000);
  if (emCache && !Array.isArray(emCache)) return json({ ok: true, ...emCache });

  // Uma única search.list consegue retornar vídeos e playlists. Isso reduz
  // o custo de uma busca normal de 200 para 100 unidades de cota.
  const resultado = await chamarYoutube("search", {
    part: "snippet",
    type: "video,playlist",
    maxResults: "50",
    videoEmbeddable: "true",
    q: termo,
  }, env);

  if (!resultado.ok) {
    return json({ ok: false, error: resultado.error || "Não foi possível buscar.", cotaEstourada: Boolean(resultado.cotaEstourada) }, resultado.status || 502);
  }

  const videos = (resultado.data.items || []).filter((x) => x.id?.videoId && x.snippet).map((x) => ({
    id: x.id.videoId,
    title: x.snippet.title,
    channel: x.snippet.channelTitle,
    thumbnail: x.snippet.thumbnails?.high?.url || x.snippet.thumbnails?.medium?.url || x.snippet.thumbnails?.default?.url || "",
    type: "video",
  }));

  const playlists = (resultado.data.items || []).filter((x) => x.id?.playlistId && x.snippet).map((x) => ({
    id: x.id.playlistId,
    title: x.snippet.title,
    channel: x.snippet.channelTitle,
    thumbnail: x.snippet.thumbnails?.high?.url || x.snippet.thumbnails?.medium?.url || x.snippet.thumbnails?.default?.url || "",
    type: "playlist",
  }));

  const payload = { videos, playlists };
  await cacheYoutubeSet(env, chaveCache, payload);
  return json({ ok: true, ...payload });
}

async function buscarPlaylist(url, env) {
  const playlistId = (url.searchParams.get("id") || "").trim();
  if (!playlistId) return json({ ok: false, error: "Playlist inválida." }, 400);
  if (!/^[A-Za-z0-9_-]{5,100}$/.test(playlistId)) return json({ ok: false, error: "ID da playlist inválido." }, 400);

  // Não usamos cache aqui: o conteúdo da playlist pode mudar a qualquer momento.
  // Assim, se alguém adicionar uma música e pesquisar a playlist novamente,
  // a versão atualizada é consultada no YouTube.
  const bruto = [];
  let pageToken = "";
  let paginas = 0;

  do {
    const parametros = {
      part: "snippet,contentDetails",
      playlistId,
      maxResults: "50",
    };
    if (pageToken) parametros.pageToken = pageToken;

    const resultado = await chamarYoutube("playlistItems", parametros, env);
    if (!resultado.ok) {
      return json({ ok: false, error: resultado.error, cotaEstourada: Boolean(resultado.cotaEstourada) }, resultado.status);
    }

    bruto.push(...(resultado.data.items || []).filter((x) => x.contentDetails?.videoId && x.snippet));
    pageToken = resultado.data.nextPageToken || "";
    paginas += 1;

    // Evita uma playlist gigantesca gerar uma quantidade excessiva de chamadas.
    if (paginas >= 10) break;
  } while (pageToken);

  if (!bruto.length) return json({ ok: true, results: [] });

  // Confirma quais vídeos continuam disponíveis/embeddable.
  // A API de vídeos aceita no máximo 50 IDs por chamada, então fazemos lotes.
  const statusMap = new Map();
  const ids = [...new Set(bruto.map((x) => x.contentDetails.videoId).filter(Boolean))];

  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50);
    const detalhes = await chamarYoutube("videos", {
      part: "snippet,status",
      id: lote.join(","),
      maxResults: "50",
    }, env);

    if (detalhes.ok) {
      for (const x of detalhes.data.items || []) statusMap.set(x.id, x);
    }
  }

  const results = bruto.map((x) => {
    const id = x.contentDetails.videoId;
    const detail = statusMap.get(id);
    const snippet = detail?.snippet || x.snippet;
    return {
      id,
      title: snippet?.title || x.snippet.title || "Vídeo",
      channel: snippet?.channelTitle || x.snippet.channelTitle || "YouTube",
      thumbnail: snippet?.thumbnails?.high?.url || snippet?.thumbnails?.medium?.url || snippet?.thumbnails?.default?.url || "",
      type: "video",
      embeddable: detail?.status ? detail.status.embeddable !== false : true,
    };
  }).filter((x) => x.embeddable && x.id);

  return json({ ok: true, results });
}

const GIPHY_SERVER_KEY = "GlVGYHkr3WSBnllca54iNt0yFbjz7L65";

async function buscarGifs(url, env) {
  // A chave fica somente no Worker; o navegador nunca recebe a API key.
  // Se futuramente você quiser trocar a chave, basta substituir esta constante.
  const giphyKey = env.CHAVE_API_DO_GIPHY || GIPHY_SERVER_KEY;
  const q = (url.searchParams.get("q") || "").trim().slice(0, 50);
  const endpoint = q ? "https://api.giphy.com/v1/gifs/search" : "https://api.giphy.com/v1/gifs/trending";
  const apiUrl = new URL(endpoint);
  apiUrl.searchParams.set("api_key", giphyKey);
  apiUrl.searchParams.set("limit", "24");
  apiUrl.searchParams.set("rating", "g");
  apiUrl.searchParams.set("lang", "pt");
  if (q) apiUrl.searchParams.set("q", q);
  let response;
  try { response = await fetch(apiUrl); } catch { return json({ ok: false, error: "Falha ao conectar à biblioteca de GIFs." }, 502); }
  const raw = await response.text();
  let data = {}; try { data = raw ? JSON.parse(raw) : {}; } catch { return json({ ok: false, error: "A biblioteca de GIFs devolveu uma resposta inválida." }, 502); }
  if (!response.ok || data.meta?.status >= 400) return json({ ok: false, error: data.meta?.msg || `Biblioteca de GIFs respondeu ${response.status}.` }, 502);
  const results = (Array.isArray(data.data) ? data.data : []).map(x => ({
    id: x.id, title: x.title || "GIF", url: x.images?.fixed_height?.url || x.images?.original?.url || "",
    preview: x.images?.fixed_width_small?.url || x.images?.fixed_height_small?.url || x.images?.fixed_height?.url || ""
  })).filter(x => x.url);
  return json({ ok: true, results });
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
    if (url.pathname === "/api/playlist") return buscarPlaylist(url, env);
    if (url.pathname === "/api/gifs") return buscarGifs(url, env);

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
      this.musicCache = await this.state.storage.get("musicCache") || {};
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
      const id = crypto.randomUUID(); this.users[key] = { id, nome: b.nome, displayName: b.nome, senhaHash: b.senhaHash, role: key === ADMIN_USUARIO ? "admin" : "user", authorizedRooms: key === ADMIN_USUARIO ? ["geral"] : ["geral"] };
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
      return json({ id: user.id, nome: user.nome, displayName: user.displayName || user.nome, role: user.role, authorizedRooms: user.authorizedRooms || ["geral"] });
    }
    if (url.pathname === "/internal/admin/users") {
      return json({ ok: true, users: Object.values(this.users).map(u => ({ id: u.id, nome: u.nome, displayName: u.displayName || u.nome, role: u.role, authorizedRooms: u.authorizedRooms || ["geral"] })) });
    }
    if (url.pathname === "/internal/admin/grant-room" && request.method === "POST") {
      const b = await request.json().catch(() => ({}));
      const user = Object.values(this.users).find(u => u.id === String(b.userId || ""));
      const roomName = String(b.roomName || "").trim().toLowerCase();
      if (!user || !this.rooms[roomName]) return json({ ok: false, error: "Usuário ou sala não encontrado." }, 404);
      user.authorizedRooms = Array.isArray(user.authorizedRooms) ? user.authorizedRooms : ["geral"];
      if (!user.authorizedRooms.includes(roomName)) user.authorizedRooms.push(roomName);
      await this.persist();
      return json({ ok: true, user: { id: user.id, nome: user.nome, displayName: user.displayName || user.nome, role: user.role, authorizedRooms: user.authorizedRooms } });
    }
    if (url.pathname === "/internal/admin/revoke-room" && request.method === "POST") {
      const b = await request.json().catch(() => ({}));
      const user = Object.values(this.users).find(u => u.id === String(b.userId || ""));
      const roomName = String(b.roomName || "").trim().toLowerCase();
      if (!user) return json({ ok: false, error: "Usuário não encontrado." }, 404);
      if (roomName !== "geral") user.authorizedRooms = (user.authorizedRooms || ["geral"]).filter(r => r !== roomName);
      await this.persist(); return json({ ok: true });
    }
    if (url.pathname === "/internal/grant-room-access" && request.method === "POST") {
      const b = await request.json().catch(() => ({}));
      const user = Object.values(this.users).find(u => u.id === String(b.userId || ""));
      const roomName = String(b.roomName || "").trim().toLowerCase();
      if (!user || !this.rooms[roomName]) return json({ ok: false }, 404);
      user.authorizedRooms = Array.isArray(user.authorizedRooms) ? user.authorizedRooms : ["geral"];
      if (!user.authorizedRooms.includes(roomName)) user.authorizedRooms.push(roomName);
      await this.persist(); return json({ ok: true });
    }
    if (url.pathname === "/internal/config") return json({ ok: true, siteName: this.config.siteName || "Chat da Firma" });
    if (url.pathname === "/internal/music-cache/get" && request.method === "POST") {
      const b = await request.json().catch(() => ({}));
      const chave = String(b.key || "");
      const item = chave ? this.musicCache[chave] : null;
      const ttlMs = Number(b.ttlMs) || 6 * 60 * 60 * 1000;
      if (!item || Date.now() - item.ts > ttlMs) return json({ ok: true, hit: false });
      return json({ ok: true, hit: true, results: item.results });
    }
    if (url.pathname === "/internal/music-cache/set" && request.method === "POST") {
      const b = await request.json().catch(() => ({}));
      const chave = String(b.key || "");
      if (!chave) return json({ ok: false }, 400);
      this.musicCache[chave] = { results: b.results, ts: Date.now() };
      // mantém o cache com no máximo 300 entradas, removendo as mais antigas
      const chaves = Object.keys(this.musicCache);
      if (chaves.length > 300) {
        chaves.sort((a, c) => this.musicCache[a].ts - this.musicCache[c].ts);
        for (const k of chaves.slice(0, chaves.length - 300)) delete this.musicCache[k];
      }
      await this.state.storage.put("musicCache", this.musicCache);
      return json({ ok: true });
    }
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
    this.state = state; this.env = env; this.sessoes = new Map(); this.mensagens = []; this.fila = []; this.tocandoAgora = null; this.senhaHash = ""; this.ownerId = ""; this.radioOn = false; this.ultimoAvancoEm = 0; this.playlistAuto = []; this.tocadas = []; this.playlistLibrary = {}; this.playlistHistory = {};
    this.state.blockConcurrencyWhile(async () => {
      const s = await this.state.storage.get(["mensagens", "fila", "tocandoAgora", "senhaHash", "ownerId", "radioOn", "playlistAuto", "tocadas", "playlistLibrary", "playlistHistory"]);
      this.mensagens = s.get("mensagens") || []; this.fila = s.get("fila") || []; this.tocandoAgora = s.get("tocandoAgora") || null; this.senhaHash = s.get("senhaHash") || ""; this.ownerId = s.get("ownerId") || ""; this.radioOn = Boolean(s.get("radioOn")); this.playlistAuto = []; this.tocadas = s.get("tocadas") || []; this.playlistLibrary = s.get("playlistLibrary") || {}; this.playlistHistory = s.get("playlistHistory") || {};
    });
  }
  async persistir() { await this.state.storage.put({ mensagens: this.mensagens, fila: this.fila, tocandoAgora: this.tocandoAgora, senhaHash: this.senhaHash, ownerId: this.ownerId, radioOn: this.radioOn, playlistAuto: this.playlistAuto, tocadas: this.tocadas, playlistLibrary: this.playlistLibrary, playlistHistory: this.playlistHistory }); }
  async atualizarPlaylistsAutomaticas() {
    if (!this.playlistAuto.length) return false;
    let mudou = false;
    for (const source of this.playlistAuto) {
      try {
        const tracks = await this.carregarPlaylistAtual(source.playlistId);
        const antiga = this.playlistLibrary[source.playlistId]?.tracks || [];
        const mapa = new Map(antiga.map(x => [String(x.id), x]));
        for (const t of tracks) mapa.set(String(t.id), { ...t, playlistId: source.playlistId, playlistTitle: source.playlistTitle });
        this.playlistLibrary[source.playlistId] = { playlistId: source.playlistId, playlistTitle: source.playlistTitle, tracks: [...mapa.values()], lastRefresh: Date.now() };
        const existentes = new Set([this.tocandoAgora?.id, ...this.fila.map(x => x.id), ...this.tocadas].filter(Boolean));
        const novas = tracks.filter(x => x.id && !existentes.has(x.id));
        if (source.autoQueue !== false) {
          const espaco = Math.max(0, MAX_FILA - this.fila.length);
          if (novas.length && (espaco > 0 || !this.tocandoAgora)) {
            const limite = Math.max(0, espaco) + (!this.tocandoAgora ? 1 : 0);
            const adicionadas = novas.slice(0, limite).map(x => ({ ...x, requestedBy: source.requestedBy || "Playlist automática", playlistId: source.playlistId, playlistTitle: source.playlistTitle, playlistAuto: true }));
            if (!this.tocandoAgora && adicionadas.length) { const primeira = adicionadas.shift(); this.tocandoAgora = { ...primeira, startedAt: Date.now(), position: 0, paused: false }; mudou = true; }
            if (adicionadas.length) { this.fila.push(...adicionadas); mudou = true; }
          }
        }
        source.lastRefresh = Date.now();
      } catch {}
    }
    return mudou;
  }
  async alarm() {
    // Playlists agora são atualizadas somente quando o usuário clica no botão.
    // Cancela qualquer alarme antigo que tenha ficado salvo de uma versão anterior.
    try { await this.state.storage.deleteAlarm(); } catch {}
    if (this.playlistAuto.length) { this.playlistAuto = []; await this.persistir(); }
  }
  async carregarPlaylistAtual(playlistId) {
    let pageToken = ""; const out = [];
    for (let pagina = 0; pagina < 10; pagina++) {
      const parametros = { part: "snippet,contentDetails", playlistId, maxResults: "50" };
      if (pageToken) parametros.pageToken = pageToken;
      const r = await chamarYoutube("playlistItems", parametros, this.env);
      if (!r.ok) throw new Error(r.error || "Falha ao atualizar playlist");
      for (const x of (r.data.items || [])) {
        const id = x.contentDetails?.videoId; if (!id || !x.snippet) continue;
        out.push({ id, title: x.snippet.title, channel: x.snippet.videoOwnerChannelTitle || x.snippet.channelTitle || "", thumbnail: x.snippet.thumbnails?.high?.url || x.snippet.thumbnails?.medium?.url || x.snippet.thumbnails?.default?.url || "" });
      }
      pageToken = r.data.nextPageToken || ""; if (!pageToken) break;
    }
    return out;
  }
  async registrarTocada(id) {
    if (!id) return; this.tocadas.push(id);
    if (this.tocadas.length > 1000) this.tocadas = this.tocadas.slice(-1000);
  }
  registrarHistoricoPlaylist(track) {
    const pid = track?.playlistId; if (!pid || !track?.id) return;
    const atual = Array.isArray(this.playlistHistory[pid]) ? this.playlistHistory[pid] : [];
    const sem = atual.filter(x => x.id !== track.id);
    sem.push({ id: track.id, title: track.title, channel: track.channel || "", thumbnail: track.thumbnail || "", playlistId: pid, playlistTitle: track.playlistTitle || this.playlistLibrary[pid]?.playlistTitle || "Playlist", playedAt: Date.now() });
    this.playlistHistory[pid] = sem.slice(-200);
  }
  async preencherRecomendacoes() {
    if (!this.radioOn || !this.tocandoAgora) return;
    const faltam = Math.max(0, 3 - this.fila.length);
    if (!faltam) return;

    const chaveCache = `rec:${this.tocandoAgora.id}`;
    let itens = await cacheYoutubeGet(this.env, chaveCache, 12 * 60 * 60 * 1000); // 12h — relacionados mudam pouco

    if (!itens) {
      const resultado = await chamarYoutube("search", {
        part: "snippet", type: "video", maxResults: String(Math.min(8, Math.max(5, faltam + 3))), videoEmbeddable: "true", relatedToVideoId: this.tocandoAgora.id,
      }, this.env);
      if (!resultado.ok) return; // sem cache e sem cota: melhor deixar a fila como está do que travar a sala
      itens = (resultado.data.items || []).filter((x) => x.id?.videoId && x.snippet).map((x) => ({
        id: x.id.videoId,
        title: x.snippet.title,
        channel: x.snippet.channelTitle || "",
        thumbnail: x.snippet.thumbnails?.high?.url || x.snippet.thumbnails?.medium?.url || x.snippet.thumbnails?.default?.url || "",
      }));
      await cacheYoutubeSet(this.env, chaveCache, itens);
    }

    const existentes = new Set([this.tocandoAgora.id, ...this.fila.map((x) => x.id)]);
    for (const item of itens) {
      if (!item.id || existentes.has(item.id)) continue;
      this.fila.push({ ...item, recommendation: true, requestedBy: "Rádio da sala" });
      existentes.add(item.id);
      if (this.fila.length >= 3) break;
    }
  }
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
    this.roomName = roomName.toLowerCase();
    this.ownerId = room.ownerId || "";

    const pair = new WebSocketPair(); const [client, server] = Object.values(pair); server.accept();
    const session = { nome: user.displayName || user.nome || "Visitante", usuarioId: user.id || "", role: user.role || "user", authorizedRooms: user.authorizedRooms || ["geral"], autenticado: false };
    this.sessoes.set(server, session);
    this.enviar(server, { type: "autenticacao_necessaria", protegida: Boolean(this.senhaHash), autorizado: !this.senhaHash || (user.authorizedRooms || ["geral"]).includes(roomName.toLowerCase()) });
    server.addEventListener("message", (e) => this.mensagem(server, e.data));
    const off = () => { this.sessoes.delete(server); this.presenca(); }; server.addEventListener("close", off); server.addEventListener("error", off);
    return new Response(null, { status: 101, webSocket: client });
  }
  presenca() { const users = [...this.sessoes.values()].filter((s) => s.autenticado).map((s) => s.nome); this.transmitir({ type: "presenca", total: users.length, usuarios: users }); }
  async mensagem(socket, raw) {
    let d; try { d = JSON.parse(raw); } catch { this.enviar(socket, { type: "erro", message: "Mensagem inválida." }); return; }
    const s = this.sessoes.get(socket); if (!s) return;
    if (d.type === "entrar") {
      const jaAutorizado = !this.senhaHash || s.authorizedRooms.includes(this.roomName);
      if (this.senhaHash && !jaAutorizado) {
        if (d.senhaHash !== this.senhaHash) { this.enviar(socket, { type: "erro", code: "SENHA_INCORRETA", message: "Senha da sala incorreta." }); return; }
        await this.env.APP_DATA.get(this.env.APP_DATA.idFromName("global")).fetch(new Request("https://app-data.internal/internal/grant-room-access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: s.usuarioId, roomName: this.roomName }) }));
        s.authorizedRooms = [...new Set([...s.authorizedRooms, this.roomName])];
      }
      s.autenticado = true;
      this.enviar(socket, { type: "estado_inicial", mensagens: this.mensagens, fila: this.fila, tocandoAgora: this.tocandoAgora, ownerId: this.ownerId, radioOn: this.radioOn, playlistLibrary: this.playlistLibrary, playlistHistory: this.playlistHistory, playlistsAuto: this.playlistAuto }); this.presenca(); return;
    }
    if (!s.autenticado) return;
    if (d.type === "mensagem" || d.type === "media") {
      const isMedia = d.type === "media";
      const text = String(d.text || "").trim();
      if (!isMedia && !text) return;
      if (!isMedia && text.length > MAX_MENSAGEM) return this.enviar(socket, { type: "erro", message: `Mensagem muito longa (máx. ${MAX_MENSAGEM}).` });
      if (isMedia) {
        const type = String(d.mediaType || ""); const mediaUrl = String(d.url || "");
        if (!["gif", "image"].includes(type)) return;
        if (mediaUrl.length > 520000) return this.enviar(socket, { type: "erro", message: "Essa mídia é muito grande." });
        if (type === "gif" && !/^https:\/\/.*\.(gif|gif\?.*)$/i.test(mediaUrl) && !mediaUrl.includes("giphy.com")) return;
        if (type === "image" && !/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(mediaUrl)) return;
      }
      const msg = { id: crypto.randomUUID(), autorId: s.usuarioId, nome: s.nome, text, ts: Date.now(), reacoes: {} };
      if (isMedia) { msg.mediaType = String(d.mediaType); msg.url = String(d.url); msg.alt = String(d.alt || "").slice(0, 120); msg.caption = String(d.caption || "").slice(0, 240); msg.source = String(d.source || "").slice(0, 30); }
      this.mensagens.push(msg); if (this.mensagens.length > MAX_HISTORICO) this.mensagens.shift(); await this.persistir(); this.transmitir({ type: "mensagem", mensagem: msg }); return;
    }
    if (d.type === "reacao") {
      const m = this.mensagens.find((x) => x.id === d.messageId); if (!m || !d.emoji) return; m.reacoes[d.emoji] = (m.reacoes[d.emoji] || 0) + 1; await this.persistir(); this.transmitir({ type: "reacao", messageId: d.messageId, emoji: d.emoji, total: m.reacoes[d.emoji] }); return;
    }
    if (d.type === "limpar_mensagens") {
      if (s.usuarioId !== this.ownerId) return this.enviar(socket, { type: "erro", message: "Somente o criador da sala pode limpar esta conversa." });
      this.mensagens = []; await this.persistir(); this.transmitir({ type: "mensagens_limpas" }); return;
    }
    if (d.type === "radio_toggle") {
      this.radioOn = Boolean(d.enabled);
      if (this.radioOn && this.tocandoAgora) await this.preencherRecomendacoes();
      await this.persistir();
      this.transmitir({ type: "radio_estado", radioOn: this.radioOn, fila: this.fila });
      if (this.radioOn && this.tocandoAgora) this.transmitir({ type: "tocando_agora", tocandoAgora: this.tocandoAgora, fila: this.fila });
      return;
    }
    if (d.type === "playlist_adicionar") {
      const tracks = Array.isArray(d.tracks) ? d.tracks.filter(x => x && x.id && x.title).slice(0, 500) : [];
      if (!tracks.length) return this.enviar(socket, { type: "erro", message: "A playlist não possui faixas disponíveis." });
      const playlistId = String(d.playlistId || ""); const playlistTitle = String(d.playlistTitle || "Playlist");
      this.playlistLibrary[playlistId] = { playlistId, playlistTitle, tracks: tracks.map(x => ({ ...x, playlistId, playlistTitle })), lastRefresh: Date.now() };
      // A playlist fica armazenada como biblioteca. Atualizações são sempre manuais.
      this.playlistAuto = this.playlistAuto.filter(x => x.playlistId !== playlistId);
      try { await this.state.storage.deleteAlarm(); } catch {}
      await this.persistir();
      this.enviar(socket, { type: "playlist_biblioteca", playlist: this.playlistLibrary[playlistId], history: this.playlistHistory[playlistId] || [], playlists: this.playlistAuto });
      this.transmitir({ type: "playlist_atualizada", playlists: this.playlistAuto, playlistLibrary: this.playlistLibrary, playlistHistory: this.playlistHistory }); return;
    }
    if (d.type === "playlist_fila_adicionar") {
      const pid = String(d.playlistId || ""); const id = String(d.videoId || ""); const lib = this.playlistLibrary[pid]; const track = lib?.tracks?.find(x => String(x.id) === id);
      if (!track) return this.enviar(socket, { type: "erro", message: "Música não encontrada na playlist." });
      if (this.tocandoAgora?.id === id || this.fila.some(x => x.id === id)) return;
      if (this.fila.length >= MAX_FILA) return this.enviar(socket, { type: "erro", message: "Fila cheia." });
      this.fila.push({ ...track, requestedBy: s.nome, playlistId: pid, playlistTitle: lib.playlistTitle }); await this.persistir(); this.transmitir({ type: "tocando_agora", tocandoAgora: this.tocandoAgora, fila: this.fila }); return;
    }
    if (d.type === "playlist_tocar") {
      const pid = String(d.playlistId || ""); const id = String(d.videoId || ""); const lib = this.playlistLibrary[pid]; const track = lib?.tracks?.find(x => String(x.id) === id);
      if (!track) return this.enviar(socket, { type: "erro", message: "Música não encontrada na playlist." });
      const idx = this.fila.findIndex(x => x.id === id); if (idx >= 0) this.fila.splice(idx, 1);
      if (this.tocandoAgora?.id && this.tocandoAgora.id !== id) { await this.registrarTocada(this.tocandoAgora.id); this.registrarHistoricoPlaylist(this.tocandoAgora); }
      const now = Date.now(); this.tocandoAgora = { ...track, requestedBy: s.nome, playlistId: pid, playlistTitle: lib.playlistTitle, startedAt: now, position: 0, paused: false };
      await this.persistir(); this.transmitir({ type: "tocando_agora", tocandoAgora: this.tocandoAgora, fila: this.fila, playlistHistory: this.playlistHistory }); return;
    }
    if (d.type === "playlist_refresh_now") {
      const pid = String(d.playlistId || "");
      const libAtual = this.playlistLibrary[pid];
      if (!pid || !libAtual) return this.enviar(socket, { type: "erro", message: "Playlist não encontrada na biblioteca da sala." });
      try {
        const tracks = await this.carregarPlaylistAtual(pid);
        const playlistTitle = libAtual.playlistTitle || "Playlist";
        const antiga = libAtual.tracks || []; const mapa = new Map(antiga.map(x => [String(x.id), x]));
        for (const t of tracks) mapa.set(String(t.id), { ...t, playlistId: pid, playlistTitle });
        this.playlistLibrary[pid] = { playlistId: pid, playlistTitle, tracks: [...mapa.values()], lastRefresh: Date.now() };

        // Atualização manual: novas faixas descobertas entram na fila.
        // O que já está tocando, na fila ou já foi tocado não é duplicado.
        const existentes = new Set([this.tocandoAgora?.id, ...this.fila.map(x => x.id), ...this.tocadas].filter(Boolean));
        const novas = tracks.filter(x => x.id && !existentes.has(x.id));
        const espaco = Math.max(0, MAX_FILA - this.fila.length);
        const limite = Math.max(0, espaco) + (!this.tocandoAgora ? 1 : 0);
        const add = novas.slice(0, limite).map(x => ({ ...x, requestedBy: s.nome, playlistId: pid, playlistTitle, playlistManual: true }));
        if (!this.tocandoAgora && add.length) { const first = add.shift(); this.tocandoAgora = { ...first, startedAt: Date.now(), position: 0, paused: false }; }
        this.fila.push(...add);
        await this.persistir();
        this.transmitir({ type: "playlist_atualizada", playlists: [], playlistLibrary: this.playlistLibrary, playlistHistory: this.playlistHistory, tocandoAgora: this.tocandoAgora, fila: this.fila });
      } catch (e) { this.enviar(socket, { type: "erro", message: e.message || "Falha ao atualizar playlist." }); }
      return;
    }
    if (d.type === "playlist_auto_toggle") {
      const playlistId = String(d.playlistId || ""); if (!playlistId) return;
      if (d.enabled) {
        const source = { playlistId, playlistTitle: String(d.playlistTitle || "Playlist"), requestedBy: s.nome, lastRefresh: Date.now(), autoQueue: d.autoQueue !== false };
        const idx = this.playlistAuto.findIndex(x => x.playlistId === playlistId); if (idx >= 0) this.playlistAuto[idx] = { ...this.playlistAuto[idx], ...source }; else this.playlistAuto.push(source); await this.state.storage.setAlarm(Date.now() + 1000);
      } else { this.playlistAuto = this.playlistAuto.filter(x => x.playlistId !== playlistId); if (!this.playlistAuto.length) try { await this.state.storage.deleteAlarm(); } catch {} }
      await this.persistir(); this.transmitir({ type: "playlist_atualizada", playlists: this.playlistAuto, playlistLibrary: this.playlistLibrary, playlistHistory: this.playlistHistory }); return;
    }
    if (d.type === "fila_adicionar") {
      if (!d.id || !d.title) return;
      const music = { id: d.id, title: d.title, channel: d.channel || "", thumbnail: d.thumbnail || "" };
      const wasEmpty = !this.tocandoAgora;
      if (!this.tocandoAgora) this.tocandoAgora = { ...music, startedAt: Date.now(), position: 0, paused: false, requestedBy: s.nome };
      else if (this.fila.length < MAX_FILA) this.fila.push({ ...music, requestedBy: s.nome });
      else return this.enviar(socket, { type: "erro", message: "Fila cheia." });
      if (this.radioOn && this.tocandoAgora && this.fila.length < 3) await this.preencherRecomendacoes();
      const musicMsg = { id: crypto.randomUUID(), autorId: s.usuarioId, nome: s.nome, text: "", ts: Date.now(), reacoes: {}, tipo: "musica", music: { ...music, recommendation: false, position: wasEmpty ? "agora" : "fila" } };
      this.mensagens.push(musicMsg); if (this.mensagens.length > MAX_HISTORICO) this.mensagens.shift();
      await this.persistir(); this.transmitir({ type: "mensagem", mensagem: musicMsg }); this.transmitir({ type: "tocando_agora", tocandoAgora: this.tocandoAgora, fila: this.fila }); return;
    }
    if (d.type === "fila_reordenar") {
      const ids = Array.isArray(d.ids) ? d.ids.map(String) : [];
      if (ids.length !== this.fila.length || new Set(ids).size !== this.fila.length) return this.enviar(socket, { type: "erro", message: "Ordem da fila inválida." });
      const mapa = new Map(this.fila.map(x => [String(x.id), x]));
      if (ids.some(id => !mapa.has(id))) return this.enviar(socket, { type: "erro", message: "Essa fila mudou. Atualize e tente novamente." });
      this.fila = ids.map(id => mapa.get(id));
      await this.persistir();
      this.transmitir({ type: "tocando_agora", tocandoAgora: this.tocandoAgora, fila: this.fila });
      return;
    }
    if (d.type === "fila_tocar") {
      const videoId = String(d.videoId || "");
      if (!videoId || !this.fila.length) return;
      const idx = this.fila.findIndex(x => x && x.id === videoId);
      if (idx < 0) return this.enviar(socket, { type: "erro", message: "Essa música não está mais na fila." });
      const next = this.fila.splice(idx, 1)[0];
      const now = Date.now();
      if (this.tocandoAgora?.id && this.tocandoAgora.id !== next.id) await this.registrarTocada(this.tocandoAgora.id);
      this.tocandoAgora = { ...next, startedAt: now, position: 0, paused: false, requestedBy: next.requestedBy || s.nome };
      if (this.radioOn && this.tocandoAgora && this.fila.length < 3) await this.preencherRecomendacoes();
      await this.persistir();
      this.transmitir({ type: "tocando_agora", tocandoAgora: this.tocandoAgora, fila: this.fila });
      return;
    }
    if (d.type === "pausar_musica") {
      if (!this.tocandoAgora || this.tocandoAgora.paused) return;
      // A posição oficial é calculada no servidor. A versão anterior confiava
      // demais no currentTime enviado pelo player oculto; em alguns momentos
      // o YouTube retorna 0 durante a transição para pause, fazendo a faixa
      // voltar ao começo.
      const elapsed = Math.max(0, (Date.now() - Number(this.tocandoAgora.startedAt || Date.now())) / 1000);
      const enviado = Number(d.position);
      const position = Number.isFinite(enviado) && enviado > 0 ? Math.max(0, Math.min(enviado, elapsed + 3)) : elapsed;
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
      // Antes de declarar a rádio vazia, atualiza as playlists automáticas.
      // Isso evita o estado “Nenhuma música” quando uma faixa nova acabou de
      // entrar na playlist e ainda não chegou ao próximo alarme.
      if (!this.fila.length && this.playlistAuto.length) {
        await this.atualizarPlaylistsAutomaticas();
      }
      if (!this.fila.length && this.radioOn) await this.preencherRecomendacoes();
      await this.registrarTocada(this.tocandoAgora.id);
      this.registrarHistoricoPlaylist(this.tocandoAgora);
      const next = this.fila.length ? this.fila.shift() : null;
      this.tocandoAgora = next ? { ...next, startedAt: now, position: 0, paused: false } : null;
      if (this.radioOn && this.tocandoAgora) await this.preencherRecomendacoes();
      if (next?.recommendation) {
        const recMsg = { id: crypto.randomUUID(), autorId: "radio", nome: "Rádio da sala", text: "", ts: now, reacoes: {}, tipo: "musica", music: { ...next, recommendation: true } };
        this.mensagens.push(recMsg); if (this.mensagens.length > MAX_HISTORICO) this.mensagens.shift();
        this.transmitir({ type: "mensagem", mensagem: recMsg });
      }
      await this.persistir(); this.transmitir({ type: "tocando_agora", tocandoAgora: this.tocandoAgora, fila: this.fila, playlistHistory: this.playlistHistory }); return;
    }
  }
}

export { AppData };
