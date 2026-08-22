const MAX_MENSAGEM = 500;
const MAX_NOME = 30;
const SESSION_DIAS = 30;
const ADMIN_USUARIO = "fab";

function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), {
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

function gerarToken() {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

function extrairToken(request) {
  const auth = request.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const headerToken = request.headers.get("x-session-token") || "";
  if (headerToken) return headerToken;

  // O navegador não permite enviar Authorization/x-session-token
  // diretamente no handshake do WebSocket. A interface envia o token
  // na URL somente para a conexão WebSocket.
  const url = new URL(request.url);
  return url.searchParams.get("token") || "";
}

async function chamarAppData(env, path, options = {}) {
  const id = env.APP_DATA.idFromName("global");
  const stub = env.APP_DATA.get(id);
  return stub.fetch(new Request(`https://app-data.internal${path}`, options));
}

async function usuarioAtual(request, env) {
  const token = extrairToken(request);
  if (!token) return null;
  const resposta = await chamarAppData(env, `/internal/session/${encodeURIComponent(token)}`);
  if (!resposta.ok) return null;
  return resposta.json();
}

async function buscarMusica(url, env) {
  const termo = (url.searchParams.get("q") || "").trim();
  if (!termo) return json({ ok: false, error: "Informe um termo de busca (?q=...)." }, 400);
  if (!env.CHAVE_API_DO_YOUTUBE) return json({ ok: false, error: "A variável de ambiente CHAVE_API_DO_YOUTUBE não está configurada no Worker." }, 500);

  const apiUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  apiUrl.searchParams.set("part", "snippet");
  apiUrl.searchParams.set("type", "video");
  apiUrl.searchParams.set("maxResults", "8");
  apiUrl.searchParams.set("videoEmbeddable", "true");
  apiUrl.searchParams.set("q", termo);
  apiUrl.searchParams.set("key", env.CHAVE_API_DO_YOUTUBE);

  let resposta;
  try { resposta = await fetch(apiUrl.toString()); }
  catch { return json({ ok: false, error: "Falha de rede ao contatar a API do YouTube." }, 502); }

  const texto = await resposta.text();
  if (!texto) return json({ ok: false, error: "A API do YouTube devolveu uma resposta vazia." }, 502);
  let dados;
  try { dados = JSON.parse(texto); }
  catch { return json({ ok: false, error: "A API do YouTube devolveu um JSON inválido." }, 502); }

  if (!resposta.ok || dados.error) {
    return json({ ok: false, error: dados.error?.message || `A API do YouTube respondeu com status ${resposta.status}.` }, 502);
  }

  const resultados = (Array.isArray(dados.items) ? dados.items : [])
    .filter((item) => item.id?.videoId && item.snippet)
    .map((item) => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || "",
    }));
  return json({ ok: true, results: resultados });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, authorization, x-session-token",
      }});
    }

    if (url.pathname === "/api/health") return json({ ok: true });
    if (url.pathname === "/api/music") return buscarMusica(url, env);

    if (url.pathname === "/api/auth/register" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const nome = String(body.nome || "").trim();
      const senha = String(body.senha || "");
      if (nome.length < 3 || nome.length > MAX_NOME) return json({ ok: false, error: "O usuário deve ter entre 3 e 30 caracteres." }, 400);
      if (senha.length < 6) return json({ ok: false, error: "A senha deve ter pelo menos 6 caracteres." }, 400);
      const resposta = await chamarAppData(env, "/internal/register", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ nome, senhaHash: await hashSenha(senha) }),
      });
      return new Response(await resposta.text(), { status: resposta.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const nome = String(body.nome || "").trim();
      const senha = String(body.senha || "");
      const resposta = await chamarAppData(env, "/internal/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ nome, senhaHash: await hashSenha(senha) }),
      });
      return new Response(await resposta.text(), { status: resposta.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }

    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      const usuario = await usuarioAtual(request, env);
      return usuario ? json({ ok: true, user: usuario }) : json({ ok: false, error: "Sessão expirada." }, 401);
    }

    if (url.pathname === "/api/rooms" && request.method === "GET") {
      const usuario = await usuarioAtual(request, env);
      if (!usuario) return json({ ok: false, error: "Faça login." }, 401);
      const resposta = await chamarAppData(env, "/internal/rooms");
      return new Response(await resposta.text(), { status: resposta.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }

    if (url.pathname === "/api/admin/rooms" && request.method === "DELETE") {
      const usuario = await usuarioAtual(request, env);
      if (!usuario || usuario.role !== "admin") return json({ ok: false, error: "Acesso restrito ao administrador." }, 403);
      const nomes = Object.keys((await (await chamarAppData(env, "/internal/rooms")).json()).rooms || {}).filter(Boolean);
      return json({ ok: true, rooms: nomes });
    }

    if (url.pathname.startsWith("/api/admin/rooms/") && request.method === "DELETE") {
      const usuario = await usuarioAtual(request, env);
      if (!usuario || usuario.role !== "admin") return json({ ok: false, error: "Acesso restrito ao administrador." }, 403);
      const nome = decodeURIComponent(url.pathname.split("/").pop()).toLowerCase();
      if (!nome || nome === "geral") return json({ ok: false, error: "A sala geral não pode ser apagada." }, 400);
      const metaResp = await chamarAppData(env, `/internal/room/${encodeURIComponent(nome)}`);
      if (!metaResp.ok) return json({ ok: false, error: "Sala não encontrada." }, 404);
      const id = env.CHAT_ROOM.idFromName(nome);
      const stub = env.CHAT_ROOM.get(id);
      await stub.fetch(new Request("https://admin.internal/admin/delete", { method: "POST", headers: { "x-admin-user-id": usuario.id } }));
      const resposta = await chamarAppData(env, `/internal/rooms/${encodeURIComponent(nome)}`, { method: "DELETE" });
      return new Response(await resposta.text(), { status: resposta.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }

    if (url.pathname.startsWith("/api/admin/rooms/") && url.pathname.endsWith("/clear") && request.method === "POST") {
      const usuario = await usuarioAtual(request, env);
      if (!usuario || usuario.role !== "admin") return json({ ok: false, error: "Acesso restrito ao administrador." }, 403);
      const partes = url.pathname.split("/");
      const nome = decodeURIComponent(partes[4] || "").toLowerCase();
      if (!nome) return json({ ok: false, error: "Sala inválida." }, 400);
      const metaResp = await chamarAppData(env, `/internal/room/${encodeURIComponent(nome)}`);
      if (!metaResp.ok) return json({ ok: false, error: "Sala não encontrada." }, 404);
      const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(nome));
      const resposta = await stub.fetch(new Request("https://admin.internal/admin/clear", { method: "POST", headers: { "x-admin-user-id": usuario.id } }));
      return new Response(await resposta.text(), { status: resposta.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }

    if (url.pathname === "/api/admin/rooms/clear-all" && request.method === "POST") {
      const usuario = await usuarioAtual(request, env);
      if (!usuario || usuario.role !== "admin") return json({ ok: false, error: "Acesso restrito ao administrador." }, 403);
      const listaResp = await chamarAppData(env, "/internal/rooms");
      const lista = await listaResp.json();
      for (const room of (lista.rooms || [])) {
        const nome = room.nome;
        const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(nome));
        await stub.fetch(new Request("https://admin.internal/admin/clear", { method: "POST", headers: { "x-admin-user-id": usuario.id } }));
      }
      return json({ ok: true });
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const usuario = await usuarioAtual(request, env);
      if (!usuario) return json({ ok: false, error: "Faça login." }, 401);
      const body = await request.json().catch(() => ({}));
      const nome = String(body.nome || "").trim().toLowerCase().replace(/\s+/g, "-");
      const emoji = String(body.emoji || "#").slice(0, 2);
      const senha = String(body.senha || "");
      if (!nome || nome.length > MAX_NOME) return json({ ok: false, error: "Nome de sala inválido." }, 400);
      if (senha && senha.length < 4) return json({ ok: false, error: "A senha da sala deve ter pelo menos 4 caracteres." }, 400);
      const resposta = await chamarAppData(env, "/internal/rooms/create", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ nome, emoji, senhaHash: senha ? await hashSenha(senha) : "", ownerId: usuario.id, ownerName: usuario.nome }),
      });
      return new Response(await resposta.text(), { status: resposta.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }

    if (url.pathname === "/ws") {
      const usuario = await usuarioAtual(request, env);
      if (!usuario) return new Response("Sessão inválida.", { status: 401 });
      const nomeDaSala = (url.searchParams.get("room") || "geral").trim().slice(0, MAX_NOME).toLowerCase();
      if (!nomeDaSala) return json({ ok: false, error: "Nome de sala inválido." }, 400);

      const metaResp = await chamarAppData(env, `/internal/room/${encodeURIComponent(nomeDaSala)}`);
      if (!metaResp.ok) return new Response("Sala não encontrada.", { status: 404 });
      const meta = await metaResp.json();

      const id = env.CHAT_ROOM.idFromName(nomeDaSala);
      const stub = env.CHAT_ROOM.get(id);
      const headers = new Headers(request.headers);
      headers.set("x-user-id", usuario.id);
      headers.set("x-user-name", usuario.nome);
      headers.set("x-room-password-hash", meta.senhaHash || "");
      headers.set("x-room-owner-id", meta.ownerId || "");
      return stub.fetch(new Request(request, { headers }));
    }

    return env.ASSETS.fetch(request);
  },
};

const MAX_HISTORICO = 100;
const MAX_FILA = 50;

export class AppData {
  constructor(state) {
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      this.users = await this.state.storage.get("users") || {};
      this.sessions = await this.state.storage.get("sessions") || {};
      this.rooms = await this.state.storage.get("rooms") || {};
      if (!this.rooms.geral) {
        this.rooms.geral = { nome: "geral", emoji: "#", senhaHash: "", ownerId: "", ownerName: "Sistema" };
      }
      // O usuário administrativo fixo do projeto é FAB.
      // A comparação é case-insensitive para aceitar "FAB", "Fab" etc.
      const chaveAdmin = ADMIN_USUARIO;
      const usuarios = Object.values(this.users);
      let alterouRoles = false;
      for (const usuario of usuarios) {
        const deveSerAdmin = usuario.nome.toLowerCase() === chaveAdmin;
        const novoRole = deveSerAdmin ? "admin" : "user";
        if (usuario.role !== novoRole) {
          usuario.role = novoRole;
          alterouRoles = true;
        }
      }
      if (alterouRoles) await this.persist();
    });
  }
  async persist() { await this.state.storage.put({ users: this.users, sessions: this.sessions, rooms: this.rooms }); }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/internal/register" && request.method === "POST") {
      const b = await request.json();
      const key = b.nome.toLowerCase();
      if (this.users[key]) return json({ ok: false, error: "Esse usuário já existe." }, 409);
      const id = crypto.randomUUID();
      this.users[key] = {
        id,
        nome: b.nome,
        senhaHash: b.senhaHash,
        role: key === ADMIN_USUARIO ? "admin" : "user",
      };
      const token = gerarToken();
      this.sessions[token] = { userId: id, expiresAt: Date.now() + SESSION_DIAS * 86400000 };
      await this.persist();
      return json({ ok: true, token, user: { id, nome: b.nome, role: this.users[key].role } });
    }
    if (url.pathname === "/internal/login" && request.method === "POST") {
      const b = await request.json();
      const user = this.users[String(b.nome || "").toLowerCase()];
      if (!user || user.senhaHash !== b.senhaHash) return json({ ok: false, error: "Usuário ou senha incorretos." }, 401);
      const token = gerarToken();
      this.sessions[token] = { userId: user.id, expiresAt: Date.now() + SESSION_DIAS * 86400000 };
      await this.persist();
      return json({ ok: true, token, user: { id: user.id, nome: user.nome, role: user.role || "user" } });
    }
    if (url.pathname.startsWith("/internal/session/")) {
      const token = decodeURIComponent(url.pathname.split("/").pop());
      const sess = this.sessions[token];
      if (!sess || sess.expiresAt < Date.now()) return json({ ok: false }, 401);
      const user = Object.values(this.users).find((u) => u.id === sess.userId);
      if (!user) return json({ ok: false }, 401);
      return json({ id: user.id, nome: user.nome, role: user.role || "user" });
    }
    if (url.pathname === "/internal/rooms") return json({ ok: true, rooms: Object.values(this.rooms).map(({ senhaHash, ...room }) => ({ ...room, protegida: Boolean(senhaHash) })) });
    if (url.pathname.startsWith("/internal/room/")) {
      const nome = decodeURIComponent(url.pathname.split("/").pop()).toLowerCase();
      const room = this.rooms[nome];
      return room ? json({ ok: true, ...room }) : json({ ok: false }, 404);
    }
    if (url.pathname.startsWith("/internal/rooms/") && request.method === "DELETE") {
      const nome = decodeURIComponent(url.pathname.split("/").pop()).toLowerCase();
      if (!this.rooms[nome]) return json({ ok: false, error: "Sala não encontrada." }, 404);
      if (nome === "geral") return json({ ok: false, error: "A sala geral não pode ser apagada." }, 400);
      delete this.rooms[nome]; await this.persist();
      return json({ ok: true });
    }
    if (url.pathname === "/internal/rooms/create" && request.method === "POST") {
      const b = await request.json();
      if (this.rooms[b.nome]) return json({ ok: false, error: "Essa sala já existe." }, 409);
      this.rooms[b.nome] = { nome: b.nome, emoji: b.emoji, senhaHash: b.senhaHash || "", ownerId: b.ownerId, ownerName: b.ownerName };
      await this.persist();
      return json({ ok: true, room: { ...this.rooms[b.nome], protegida: Boolean(b.senhaHash) } });
    }
    return json({ ok: false, error: "Rota interna inválida." }, 404);
  }
}

export class ChatRoom {
  constructor(state) {
    this.state = state;
    this.sessoes = new Map();
    this.mensagens = [];
    this.fila = [];
    this.tocandoAgora = null;
    this.senhaHash = "";
    this.ownerId = "";
    this.ultimoAvancoEm = 0;
    this.state.blockConcurrencyWhile(async () => {
      const salvo = await this.state.storage.get(["mensagens", "fila", "tocandoAgora", "senhaHash", "ownerId"]);
      this.mensagens = salvo.get("mensagens") || [];
      this.fila = salvo.get("fila") || [];
      this.tocandoAgora = salvo.get("tocandoAgora") || null;
      this.senhaHash = salvo.get("senhaHash") || "";
      this.ownerId = salvo.get("ownerId") || "";
    });
  }
  async persistir() { await this.state.storage.put({ mensagens: this.mensagens, fila: this.fila, tocandoAgora: this.tocandoAgora, senhaHash: this.senhaHash, ownerId: this.ownerId }); }
  async fetch(request) {
    if (request.method === "POST" && request.url.includes("/admin/clear")) {
      this.mensagens = [];
      await this.persistir();
      this.transmitir({ type: "mensagens_limpas", motivo: "admin" });
      return json({ ok: true });
    }
    if (request.method === "POST" && request.url.includes("/admin/delete")) {
      this.transmitir({ type: "sala_excluida" });
      for (const socket of this.sessoes.keys()) { try { socket.close(1000, "Sala excluída pelo administrador"); } catch {} }
      await this.state.storage.deleteAll();
      return json({ ok: true });
    }
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Esperado um WebSocket em /ws.", { status: 426 });
    if (request.headers.get("x-room-password-hash") && !this.senhaHash) {
      this.senhaHash = request.headers.get("x-room-password-hash") || "";
      this.ownerId = request.headers.get("x-room-owner-id") || "";
      await this.persistir();
    }
    const par = new WebSocketPair();
    const [cliente, servidor] = Object.values(par);
    servidor.accept();
    this.iniciarSessao(servidor, request);
    return new Response(null, { status: 101, webSocket: cliente });
  }
  iniciarSessao(socket, request) {
    const sessao = { nome: request.headers.get("x-user-name") || "Visitante", usuarioId: request.headers.get("x-user-id") || "", autenticado: false };
    this.sessoes.set(socket, sessao);
    this.enviarSeguro(socket, { type: "autenticacao_necessaria", protegida: Boolean(this.senhaHash) });
    socket.addEventListener("message", (evento) => this.tratarMensagem(socket, evento.data));
    const encerrar = () => { this.sessoes.delete(socket); this.transmitirPresenca(); };
    socket.addEventListener("close", encerrar); socket.addEventListener("error", encerrar);
  }
  enviarSeguro(socket, payload) { try { socket.send(JSON.stringify(payload)); } catch { this.sessoes.delete(socket); } }
  transmitir(payload, ignorar = null) { const texto = JSON.stringify(payload); for (const socket of this.sessoes.keys()) { if (socket === ignorar) continue; try { socket.send(texto); } catch { this.sessoes.delete(socket); } } }
  transmitirPresenca() { const usuarios = Array.from(this.sessoes.values()).filter((s) => s.autenticado).map((s) => s.nome); this.transmitir({ type: "presenca", total: usuarios.length, usuarios }); }
  async tratarMensagem(socket, bruto) {
    let dados; try { dados = JSON.parse(bruto); } catch { this.enviarSeguro(socket, { type: "erro", message: "Mensagem inválida." }); return; }
    const sessao = this.sessoes.get(socket); if (!sessao) return;
    if (dados.type === "entrar") {
      if (this.senhaHash && dados.senhaHash !== this.senhaHash) { this.enviarSeguro(socket, { type: "erro", code: "SENHA_INCORRETA", message: "Senha da sala incorreta." }); return; }
      sessao.autenticado = true;
      this.enviarSeguro(socket, { type: "estado_inicial", mensagens: this.mensagens, fila: this.fila, tocandoAgora: this.tocandoAgora, ownerId: this.ownerId });
      this.transmitirPresenca(); return;
    }
    if (!sessao.autenticado) return;

    switch (dados.type) {
      case "mensagem": {
        const texto = String(dados.text || "").trim(); if (!texto) return;
        if (texto.length > MAX_MENSAGEM) { this.enviarSeguro(socket, { type: "erro", message: `Mensagem muito longa (máx. ${MAX_MENSAGEM} caracteres).` }); return; }
        const mensagem = { id: crypto.randomUUID(), autorId: sessao.usuarioId, nome: sessao.nome, text: texto, ts: Date.now(), reacoes: {} };
        this.mensagens.push(mensagem); if (this.mensagens.length > MAX_HISTORICO) this.mensagens.shift(); await this.persistir(); this.transmitir({ type: "mensagem", mensagem }); break;
      }
      case "limpar_mensagens": {
        if (sessao.usuarioId !== this.ownerId) { this.enviarSeguro(socket, { type: "erro", message: "Apenas o criador da sala pode limpar a conversa." }); return; }
        this.mensagens = []; await this.persistir(); this.transmitir({ type: "mensagens_limpas" }); break;
      }
      case "reacao": {
        const alvo = this.mensagens.find((m) => m.id === dados.messageId); if (!alvo || !dados.emoji) return;
        alvo.reacoes[dados.emoji] = (alvo.reacoes[dados.emoji] || 0) + 1; await this.persistir(); this.transmitir({ type: "reacao", messageId: dados.messageId, emoji: dados.emoji, total: alvo.reacoes[dados.emoji] }); break;
      }
      case "fila_adicionar": {
        const { id, title, channel, thumbnail } = dados; if (!id || !title) return;
        const musica = { id, title, channel: channel || "", thumbnail: thumbnail || "" };
        if (!this.tocandoAgora) this.tocandoAgora = { ...musica, startedAt: Date.now(), paused: false, position: 0 };
        else if (this.fila.length < MAX_FILA) this.fila.push(musica);
        else { this.enviarSeguro(socket, { type: "erro", message: "Fila cheia." }); return; }
        await this.persistir(); this.transmitir({ type: "tocando_agora", tocandoAgora: this.tocandoAgora, fila: this.fila }); break;
      }
      case "pausar_musica": {
        if (!this.tocandoAgora || this.tocandoAgora.paused) return;
        const pos = Number(dados.position); this.tocandoAgora.position = Number.isFinite(pos) && pos >= 0 ? pos : Math.max(0, (Date.now() - this.tocandoAgora.startedAt) / 1000);
        this.tocandoAgora.paused = true; await this.persistir(); this.transmitir({ type: "tocando_agora", tocandoAgora: this.tocandoAgora, fila: this.fila }); break;
      }
      case "continuar_musica": {
        if (!this.tocandoAgora || !this.tocandoAgora.paused) return;
        this.tocandoAgora.startedAt = Date.now() - Math.floor((this.tocandoAgora.position || 0) * 1000);
        this.tocandoAgora.paused = false; await this.persistir(); this.transmitir({ type: "tocando_agora", tocandoAgora: this.tocandoAgora, fila: this.fila }); break;
      }
      case "proxima_musica": {
        if (dados.videoId && this.tocandoAgora && dados.videoId !== this.tocandoAgora.id) return;
        const agora = Date.now(); if (agora - this.ultimoAvancoEm < 4000) return; this.ultimoAvancoEm = agora;
        this.tocandoAgora = this.fila.length ? { ...this.fila.shift(), startedAt: Date.now(), paused: false, position: 0 } : null;
        await this.persistir(); this.transmitir({ type: "tocando_agora", tocandoAgora: this.tocandoAgora, fila: this.fila }); break;
      }
      default: this.enviarSeguro(socket, { type: "erro", message: "Tipo de evento desconhecido." });
    }
  }
}
