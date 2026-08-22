// ============================================================================
// src/index.js
// Worker principal (Cloudflare Workers, ES Modules).
// Responsável por: rotear as requisições, expor a API de busca de música,
// servir os arquivos estáticos (public/) e delegar o chat/rádio para a
// Durable Object ChatRoom.
// ============================================================================

const MAX_MENSAGEM = 500; // limite de caracteres por mensagem de chat
const MAX_NOME = 30; // limite de caracteres para apelido/nome de sala

function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}

// Busca segura de músicas na API do YouTube.
// Nunca expõe a chave da API para o cliente: toda a chamada acontece aqui,
// dentro do Worker, usando a variável de ambiente CHAVE_API_DO_YOUTUBE.
async function buscarMusica(url, env) {
  const termo = (url.searchParams.get("q") || "").trim();

  if (!termo) {
    return json({ ok: false, error: "Informe um termo de busca (?q=...)." }, 400);
  }

  if (!env.CHAVE_API_DO_YOUTUBE) {
    return json(
      {
        ok: false,
        error:
          "A variável de ambiente CHAVE_API_DO_YOUTUBE não está configurada no Worker.",
      },
      500
    );
  }

  const apiUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  apiUrl.searchParams.set("part", "snippet");
  apiUrl.searchParams.set("type", "video");
  apiUrl.searchParams.set("maxResults", "8");
  apiUrl.searchParams.set("videoEmbeddable", "true");
  apiUrl.searchParams.set("q", termo);
  apiUrl.searchParams.set("key", env.CHAVE_API_DO_YOUTUBE);

  let resposta;
  try {
    resposta = await fetch(apiUrl.toString());
  } catch (erroRede) {
    return json({ ok: false, error: "Falha de rede ao contatar a API do YouTube." }, 502);
  }

  // Regra de ouro para evitar o erro "Unexpected end of JSON input":
  // 1) ler como texto primeiro, 2) só então tentar JSON.parse, 3) tratar
  // qualquer texto vazio ou inválido de forma explícita.
  const textoBruto = await resposta.text();

  if (!textoBruto) {
    return json(
      { ok: false, error: "A API do YouTube devolveu uma resposta vazia." },
      502
    );
  }

  let dados;
  try {
    dados = JSON.parse(textoBruto);
  } catch (erroParse) {
    return json(
      { ok: false, error: "A API do YouTube devolveu um JSON inválido." },
      502
    );
  }

  if (!resposta.ok || dados.error) {
    const mensagem =
      (dados.error && dados.error.message) ||
      `A API do YouTube respondeu com status ${resposta.status}.`;
    return json({ ok: false, error: mensagem }, 502);
  }

  const itens = Array.isArray(dados.items) ? dados.items : [];

  const resultados = itens
    .filter((item) => item.id && item.id.videoId && item.snippet)
    .map((item) => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail:
        (item.snippet.thumbnails &&
          (item.snippet.thumbnails.medium || item.snippet.thumbnails.default) &&
          (item.snippet.thumbnails.medium || item.snippet.thumbnails.default).url) ||
        "",
    }));

  return json({ ok: true, results: resultados });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true });
    }

    if (url.pathname === "/api/music") {
      return buscarMusica(url, env);
    }

    if (url.pathname === "/ws") {
      const nomeDaSala = (url.searchParams.get("room") || "geral")
        .trim()
        .slice(0, MAX_NOME);

      if (!nomeDaSala) {
        return json({ ok: false, error: "Nome de sala inválido." }, 400);
      }

      const id = env.CHAT_ROOM.idFromName(nomeDaSala.toLowerCase());
      const stub = env.CHAT_ROOM.get(id);
      return stub.fetch(request);
    }

    // Qualquer outra rota: serve os arquivos estáticos de public/
    // (Workers Assets).
    return env.ASSETS.fetch(request);
  },
};

// ============================================================================
// Durable Object: ChatRoom
// Uma instância desta classe existe por sala (o nome da sala vira o ID da
// Durable Object). Ela guarda: histórico de mensagens, fila de músicas,
// a música tocando agora e a lista de conexões WebSocket ativas.
// ============================================================================

const MAX_HISTORICO = 100; // quantidade de mensagens guardadas por sala
const MAX_FILA = 50; // quantidade máxima de músicas na fila

async function hashSenha(senha) {
  const bytes = new TextEncoder().encode(String(senha));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessoes = new Map(); // WebSocket -> { nome }

    this.mensagens = [];
    this.fila = [];
    this.tocandoAgora = null; // { id, title, channel, thumbnail, startedAt, paused, pausedAt }
    this.senhaHash = null;
    this.ultimoAvancoEm = 0; // usado para não avançar a fila duas vezes seguidas

    // Carrega o estado salvo (se a Durable Object tiver "dormido" e voltado).
    this.state.blockConcurrencyWhile(async () => {
      const salvo = await this.state.storage.get([
        "mensagens",
        "fila",
        "tocandoAgora",
        "senhaHash",
      ]);
      this.mensagens = salvo.get("mensagens") || [];
      this.fila = salvo.get("fila") || [];
      this.tocandoAgora = salvo.get("tocandoAgora") || null;
      this.senhaHash = salvo.get("senhaHash") || null;
    });
  }

  async persistir() {
    await this.state.storage.put({
      mensagens: this.mensagens,
      fila: this.fila,
      tocandoAgora: this.tocandoAgora,
      senhaHash: this.senhaHash,
    });
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Esperado um WebSocket em /ws.", { status: 426 });
    }

    const par = new WebSocketPair();
    const [cliente, servidor] = Object.values(par);

    servidor.accept();
    this.iniciarSessao(servidor);

    return new Response(null, { status: 101, webSocket: cliente });
  }

  iniciarSessao(socket) {
    const sessao = { nome: "Visitante", usuarioId: null, autenticado: false };
    this.sessoes.set(socket, sessao);

    this.enviarSeguro(socket, {
      type: "autenticacao_necessaria",
      protegida: Boolean(this.senhaHash),
    });

    socket.addEventListener("message", (evento) => {
      this.tratarMensagem(socket, evento.data);
    });

    const encerrar = () => {
      this.sessoes.delete(socket);
      this.transmitirPresenca();
    };
    socket.addEventListener("close", encerrar);
    socket.addEventListener("error", encerrar);
  }

  enviarSeguro(socket, payload) {
    try {
      socket.send(JSON.stringify(payload));
    } catch (erro) {
      this.sessoes.delete(socket);
    }
  }

  transmitir(payload, ignorar = null) {
    const texto = JSON.stringify(payload);
    for (const socket of this.sessoes.keys()) {
      if (socket === ignorar) continue;
      try {
        socket.send(texto);
      } catch (erro) {
        this.sessoes.delete(socket);
      }
    }
  }

  transmitirPresenca() {
    const usuarios = Array.from(this.sessoes.values())
      .filter((s) => s.autenticado)
      .map((s) => s.nome);
    this.transmitir({ type: "presenca", total: usuarios.length, usuarios });
  }

  async tratarMensagem(socket, dadoBruto) {
    let dados;
    try {
      dados = JSON.parse(dadoBruto);
    } catch (erro) {
      this.enviarSeguro(socket, { type: "erro", message: "Mensagem inválida." });
      return;
    }

    if (!dados || typeof dados.type !== "string") {
      this.enviarSeguro(socket, { type: "erro", message: "Mensagem sem tipo." });
      return;
    }

    const sessao = this.sessoes.get(socket);
    if (!sessao) return;

    if (!sessao.autenticado && dados.type !== "entrar") {
      return;
    }

    switch (dados.type) {
      case "entrar": {
        const nome = String(dados.nome || "").trim().slice(0, MAX_NOME) || "Visitante";
        const usuarioId = String(dados.usuarioId || "").trim().slice(0, 100);
        const senha = String(dados.senha || "");

        if (this.senhaHash) {
          if (!senha || (await hashSenha(senha)) !== this.senhaHash) {
            this.enviarSeguro(socket, {
              type: "erro",
              code: senha ? "SENHA_INCORRETA" : "SENHA_NECESSARIA",
              message: senha ? "Senha incorreta." : "Esta sala exige uma senha.",
            });
            return;
          }
        } else if (dados.configurarSenha && senha) {
          this.senhaHash = await hashSenha(senha);
          await this.persistir();
        }

        sessao.nome = nome;
        sessao.usuarioId = usuarioId || crypto.randomUUID();
        sessao.autenticado = true;

        this.enviarSeguro(socket, {
          type: "estado_inicial",
          mensagens: this.mensagens,
          fila: this.fila,
          tocandoAgora: this.tocandoAgora,
        });
        this.transmitirPresenca();
        break;
      }

      case "mensagem": {
        const texto = String(dados.text || "").trim();
        if (!texto) return; // não permite mensagem vazia
        if (texto.length > MAX_MENSAGEM) {
          this.enviarSeguro(socket, {
            type: "erro",
            message: `Mensagem muito longa (máx. ${MAX_MENSAGEM} caracteres).`,
          });
          return;
        }

        const mensagem = {
          id: crypto.randomUUID(),
          autorId: sessao.usuarioId,
          nome: sessao.nome,
          text: texto,
          ts: Date.now(),
          reacoes: {},
        };

        this.mensagens.push(mensagem);
        if (this.mensagens.length > MAX_HISTORICO) {
          this.mensagens.shift();
        }
        await this.persistir();

        this.transmitir({ type: "mensagem", mensagem });
        break;
      }

      case "reacao": {
        const { messageId, emoji } = dados;
        if (!messageId || !emoji) return;
        const alvo = this.mensagens.find((m) => m.id === messageId);
        if (!alvo) return;

        alvo.reacoes[emoji] = (alvo.reacoes[emoji] || 0) + 1;
        await this.persistir();

        this.transmitir({
          type: "reacao",
          messageId,
          emoji,
          total: alvo.reacoes[emoji],
        });
        break;
      }

      case "fila_adicionar": {
        const { id, title, channel, thumbnail } = dados;
        if (!id || !title) return;

        const musica = { id, title, channel: channel || "", thumbnail: thumbnail || "" };

        if (!this.tocandoAgora) {
          this.tocandoAgora = { ...musica, startedAt: Date.now(), paused: false, pausedAt: null };
        } else if (this.fila.length < MAX_FILA) {
          this.fila.push(musica);
        } else {
          this.enviarSeguro(socket, { type: "erro", message: "Fila cheia." });
          return;
        }

        await this.persistir();
        this.transmitir({
          type: "tocando_agora",
          tocandoAgora: this.tocandoAgora,
          fila: this.fila,
        });
        break;
      }

      case "pausar_musica": {
        if (!this.tocandoAgora || this.tocandoAgora.paused) return;
        this.tocandoAgora.paused = true;
        this.tocandoAgora.pausedAt = Date.now();
        await this.persistir();
        this.transmitir({
          type: "tocando_agora",
          tocandoAgora: this.tocandoAgora,
          fila: this.fila,
        });
        break;
      }

      case "continuar_musica": {
        if (!this.tocandoAgora || !this.tocandoAgora.paused) return;
        const pausadoPor = Math.max(0, Date.now() - (this.tocandoAgora.pausedAt || Date.now()));
        this.tocandoAgora.startedAt += pausadoPor;
        this.tocandoAgora.paused = false;
        this.tocandoAgora.pausedAt = null;
        await this.persistir();
        this.transmitir({
          type: "tocando_agora",
          tocandoAgora: this.tocandoAgora,
          fila: this.fila,
        });
        break;
      }

      case "proxima_musica": {
        // Chamado quando a música atual termina (relatado pelo player) ou
        // quando alguém pula a música.
        if (dados.videoId && this.tocandoAgora && dados.videoId !== this.tocandoAgora.id) {
          // Relato antigo, já trocou de música — ignora para evitar pular
          // duas vezes por engano.
          return;
        }

        // Como cada usuário roda seu próprio player, vários podem avisar
        // "terminou" quase ao mesmo tempo. Ignora avanços repetidos dentro
        // de uma janela curta.
        const agora = Date.now();
        if (agora - this.ultimoAvancoEm < 4000) return;
        this.ultimoAvancoEm = agora;

        this.tocandoAgora = this.fila.length > 0
          ? { ...this.fila.shift(), startedAt: Date.now(), paused: false, pausedAt: null }
          : null;

        await this.persistir();
        this.transmitir({
          type: "tocando_agora",
          tocandoAgora: this.tocandoAgora,
          fila: this.fila,
        });
        break;
      }

      default:
        this.enviarSeguro(socket, { type: "erro", message: "Tipo de evento desconhecido." });
    }
  }
}
