"use strict";

// ============================================================================
// Estado local
// ============================================================================

const EMOJIS_SALA = ["#", "🎸", "🎮", "📚", "☕", "🌙", "🔥", "🎨"];

let meuNome = localStorage.getItem("apelido") || "";
let salas = carregarSalas();
let salaAtual = salas[0].nome;

let socket = null;
let tocandoAgoraAtual = null; // último "tocandoAgora" recebido, para saber se mudou
let ytPlayer = null;
let ytPronto = false;
let ytPendente = null; // música aguardando o player ficar pronto
let audioLiberado = false;
let emojiEscolhido = EMOJIS_SALA[0];

// ============================================================================
// Elementos
// ============================================================================

const el = (id) => document.getElementById(id);

const modalNome = el("modal-nome");
const inputNome = el("input-nome");
const btnEntrar = el("btn-entrar");
const erroNome = el("erro-nome");

const modalSala = el("modal-sala");
const inputSala = el("input-sala");
const btnNovaSala = el("btn-nova-sala");
const btnCriarSala = el("btn-criar-sala");
const btnCancelarSala = el("btn-cancelar-sala");
const erroSala = el("erro-sala");
const emojiPicker = el("emoji-picker");

const modalMusica = el("modal-musica");
const btnAbrirBusca = el("btn-abrir-busca");
const btnFecharMusica = el("btn-fechar-musica");
const inputBuscaMusica = el("input-busca-musica");
const btnBuscarMusica = el("btn-buscar-musica");
const statusBusca = el("status-busca-musica");
const resultadosMusica = el("resultados-musica");

const app = el("app");
const nomeUsuarioEl = el("nome-usuario");
const btnAlterarNome = el("btn-alterar-nome");
const listaSalasEl = el("lista-salas");
const miniRadioTitulo = el("mini-radio-titulo");
const btnAtivarAudio = el("btn-ativar-audio");

const capaRadio = el("capa-radio");
const tituloRadio = el("titulo-radio");
const artistaRadio = el("artista-radio");
const filaPreview = el("fila-preview");
const btnPularMusica = el("btn-pular-musica");

const emojiSalaAtual = el("emoji-sala-atual");
const nomeSalaAtual = el("nome-sala-atual");
const presencaSala = el("presenca-sala");
const listaMensagens = el("lista-mensagens");
const inputMensagem = el("input-mensagem");
const btnEnviar = el("btn-enviar");

// ============================================================================
// Salas (guardadas localmente no navegador)
// ============================================================================

function carregarSalas() {
  try {
    const salvo = JSON.parse(localStorage.getItem("salas"));
    if (Array.isArray(salvo) && salvo.length > 0) return salvo;
  } catch (erro) {
    /* ignora e usa o padrão */
  }
  return [{ nome: "geral", emoji: "#" }];
}

function salvarSalas() {
  localStorage.setItem("salas", JSON.stringify(salas));
}

function renderizarSalas() {
  listaSalasEl.innerHTML = "";
  for (const sala of salas) {
    const item = document.createElement("li");
    item.tabIndex = 0;
    item.className = sala.nome === salaAtual ? "ativa" : "";
    item.textContent = `${sala.emoji} ${sala.nome}`;
    item.addEventListener("click", () => trocarDeSala(sala.nome));
    listaSalasEl.appendChild(item);
  }
}

function trocarDeSala(nome) {
  if (nome === salaAtual && socket && socket.readyState === WebSocket.OPEN) return;
  salaAtual = nome;
  renderizarSalas();
  const sala = salas.find((s) => s.nome === nome);
  emojiSalaAtual.textContent = sala ? sala.emoji : "#";
  nomeSalaAtual.textContent = nome;
  listaMensagens.innerHTML = "";
  conectarWebSocket(nome);
}

// ============================================================================
// Apelido
// ============================================================================

function iniciar() {
  montarEmojiPicker();

  if (meuNome) {
    abrirApp();
  } else {
    modalNome.classList.remove("escondido");
    inputNome.focus();
  }

  btnEntrar.addEventListener("click", confirmarNome);
  inputNome.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmarNome();
  });

  btnAlterarNome.addEventListener("click", () => {
    modalNome.classList.remove("escondido");
    inputNome.value = meuNome;
    inputNome.focus();
  });
}

function confirmarNome() {
  const valor = inputNome.value.trim();
  if (!valor) {
    erroNome.textContent = "Digite um apelido para continuar.";
    return;
  }
  if (valor.length > 30) {
    erroNome.textContent = "Apelido muito longo (máx. 30 caracteres).";
    return;
  }
  erroNome.textContent = "";
  meuNome = valor;
  localStorage.setItem("apelido", meuNome);
  modalNome.classList.add("escondido");
  abrirApp();
}

function abrirApp() {
  app.classList.remove("escondido");
  nomeUsuarioEl.textContent = meuNome;
  renderizarSalas();
  trocarDeSala(salaAtual);
}

// ============================================================================
// Nova sala
// ============================================================================

function montarEmojiPicker() {
  emojiPicker.innerHTML = "";
  for (const emoji of EMOJIS_SALA) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.textContent = emoji;
    if (emoji === emojiEscolhido) botao.classList.add("selecionado");
    botao.addEventListener("click", () => {
      emojiEscolhido = emoji;
      montarEmojiPicker();
    });
    emojiPicker.appendChild(botao);
  }
}

btnNovaSala.addEventListener("click", () => {
  inputSala.value = "";
  erroSala.textContent = "";
  modalSala.classList.remove("escondido");
  inputSala.focus();
});

btnCancelarSala.addEventListener("click", () => modalSala.classList.add("escondido"));

btnCriarSala.addEventListener("click", () => {
  const nome = inputSala.value.trim().toLowerCase().replace(/\s+/g, "-");
  if (!nome) {
    erroSala.textContent = "Digite um nome para a sala.";
    return;
  }
  if (salas.some((s) => s.nome === nome)) {
    erroSala.textContent = "Já existe uma sala com esse nome.";
    return;
  }
  salas.push({ nome, emoji: emojiEscolhido });
  salvarSalas();
  modalSala.classList.add("escondido");
  renderizarSalas();
  trocarDeSala(nome);
});

// ============================================================================
// WebSocket
// ============================================================================

function conectarWebSocket(nomeSala) {
  if (socket) {
    socket.onclose = null; // evita reconectar sozinho ao trocar de sala de propósito
    socket.close();
  }

  presencaSala.textContent = "conectando...";

  const protocolo = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocolo}//${location.host}/ws?room=${encodeURIComponent(nomeSala)}`;
  socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    enviarWS({ type: "entrar", nome: meuNome });
    presencaSala.textContent = "";
  });

  socket.addEventListener("message", (evento) => {
    let dados;
    try {
      dados = JSON.parse(evento.data);
    } catch (erro) {
      return; // ignora mensagens que não são JSON válido
    }
    tratarEventoServidor(dados);
  });

  socket.addEventListener("close", () => {
    presencaSala.textContent = "desconectado — reconectando...";
    setTimeout(() => {
      if (salaAtual === nomeSala) conectarWebSocket(nomeSala);
    }, 1500);
  });

  socket.addEventListener("error", () => {
    presencaSala.textContent = "erro de conexão";
  });
}

function enviarWS(objeto) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(objeto));
  }
}

function tratarEventoServidor(dados) {
  switch (dados.type) {
    case "estado_inicial":
      listaMensagens.innerHTML = "";
      for (const msg of dados.mensagens) renderizarMensagem(msg);
      rolarParaFinal();
      atualizarPainelRadio(dados.tocandoAgora, dados.fila);
      break;

    case "mensagem":
      renderizarMensagem(dados.mensagem);
      rolarParaFinal();
      break;

    case "reacao":
      atualizarReacaoNaTela(dados.messageId, dados.emoji, dados.total);
      break;

    case "presenca":
      presencaSala.textContent = `${dados.total} ${dados.total === 1 ? "pessoa" : "pessoas"} na sala`;
      break;

    case "tocando_agora":
      atualizarPainelRadio(dados.tocandoAgora, dados.fila);
      break;

    case "erro":
      adicionarMensagemSistema(`⚠️ ${dados.message}`);
      break;
  }
}

// ============================================================================
// Mensagens
// ============================================================================

function renderizarMensagem(msg) {
  const wrapper = document.createElement("div");
  wrapper.className = "mensagem";
  wrapper.dataset.id = msg.id;

  const avatar = document.createElement("div");
  avatar.className = "avatar-mini";
  wrapper.appendChild(avatar);

  const corpo = document.createElement("div");
  corpo.className = "mensagem-corpo";

  const cabecalho = document.createElement("div");
  cabecalho.className = "mensagem-cabecalho";

  const nomeSpan = document.createElement("span");
  nomeSpan.className = "mensagem-nome";
  nomeSpan.textContent = msg.nome; // textContent: nunca innerHTML com dado de usuário

  const horaSpan = document.createElement("span");
  horaSpan.className = "mensagem-hora";
  horaSpan.textContent = new Date(msg.ts).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  cabecalho.append(nomeSpan, horaSpan);

  const textoDiv = document.createElement("div");
  textoDiv.className = "mensagem-texto";
  textoDiv.textContent = msg.text;

  const reacoesDiv = document.createElement("div");
  reacoesDiv.className = "mensagem-reacoes";
  for (const emoji of ["👍", "❤️", "😂"]) {
    const total = (msg.reacoes && msg.reacoes[emoji]) || 0;
    reacoesDiv.appendChild(criarChipReacao(msg.id, emoji, total));
  }

  corpo.append(cabecalho, textoDiv, reacoesDiv);
  wrapper.appendChild(corpo);
  listaMensagens.appendChild(wrapper);
}

function criarChipReacao(messageId, emoji, total) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip-reacao";
  chip.dataset.emoji = emoji;
  chip.textContent = total > 0 ? `${emoji} ${total}` : emoji;
  chip.addEventListener("click", () => {
    enviarWS({ type: "reacao", messageId, emoji });
  });
  return chip;
}

function atualizarReacaoNaTela(messageId, emoji, total) {
  const wrapper = listaMensagens.querySelector(`[data-id="${CSS.escape(messageId)}"]`);
  if (!wrapper) return;
  const chip = wrapper.querySelector(`.chip-reacao[data-emoji="${CSS.escape(emoji)}"]`);
  if (chip) {
    chip.textContent = total > 0 ? `${emoji} ${total}` : emoji;
    chip.classList.add("ativa");
  }
}

function adicionarMensagemSistema(texto) {
  const div = document.createElement("div");
  div.className = "mensagem-sistema";
  div.textContent = texto;
  listaMensagens.appendChild(div);
  rolarParaFinal();
}

function rolarParaFinal() {
  listaMensagens.scrollTop = listaMensagens.scrollHeight;
}

// ============================================================================
// Envio de mensagem + comando !play
// ============================================================================

function enviarMensagemAtual() {
  const texto = inputMensagem.value.trim();
  if (!texto) return;

  if (texto.toLowerCase().startsWith("!play ")) {
    const termo = texto.slice(6).trim();
    inputMensagem.value = "";
    ajustarAlturaTextarea();
    if (termo) tocarPorComando(termo);
    return;
  }

  enviarWS({ type: "mensagem", text: texto });
  inputMensagem.value = "";
  ajustarAlturaTextarea();
}

btnEnviar.addEventListener("click", enviarMensagemAtual);
inputMensagem.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    enviarMensagemAtual();
  }
});
inputMensagem.addEventListener("input", ajustarAlturaTextarea);

function ajustarAlturaTextarea() {
  inputMensagem.style.height = "auto";
  inputMensagem.style.height = Math.min(inputMensagem.scrollHeight, 140) + "px";
}

async function tocarPorComando(termo) {
  adicionarMensagemSistema(`🔎 Buscando "${termo}" para tocar...`);
  const resultado = await buscarMusicaAPI(termo);
  if (!resultado.ok || resultado.results.length === 0) {
    adicionarMensagemSistema(`Não encontrei nada para "${termo}".`);
    return;
  }
  selecionarMusica(resultado.results[0]);
}

// ============================================================================
// Busca de música
// ============================================================================

btnAbrirBusca.addEventListener("click", () => {
  modalMusica.classList.remove("escondido");
  inputBuscaMusica.value = "";
  resultadosMusica.innerHTML = "";
  statusBusca.textContent = "";
  inputBuscaMusica.focus();
});

btnFecharMusica.addEventListener("click", () => modalMusica.classList.add("escondido"));

btnBuscarMusica.addEventListener("click", executarBusca);
inputBuscaMusica.addEventListener("keydown", (e) => {
  if (e.key === "Enter") executarBusca();
});

async function executarBusca() {
  const termo = inputBuscaMusica.value.trim();
  if (!termo) return;
  statusBusca.textContent = "Buscando...";
  resultadosMusica.innerHTML = "";

  const resultado = await buscarMusicaAPI(termo);

  if (!resultado.ok) {
    statusBusca.textContent = `Erro: ${resultado.error || "não foi possível buscar."}`;
    return;
  }
  if (resultado.results.length === 0) {
    statusBusca.textContent = "Nenhum resultado encontrado.";
    return;
  }
  statusBusca.textContent = "";
  for (const item of resultado.results) {
    resultadosMusica.appendChild(criarLinhaResultado(item));
  }
}

// Busca robusta: nunca chama response.json() diretamente. Lê como texto
// primeiro e só tenta interpretar como JSON depois, tratando qualquer
// resposta vazia ou inválida sem quebrar a interface.
async function buscarMusicaAPI(termo) {
  try {
    const resposta = await fetch(`/api/music?q=${encodeURIComponent(termo)}`);
    const textoBruto = await resposta.text();

    if (!textoBruto) {
      return { ok: false, error: "resposta vazia do servidor." };
    }

    let dados;
    try {
      dados = JSON.parse(textoBruto);
    } catch (erroParse) {
      return { ok: false, error: "resposta inválida do servidor." };
    }

    if (!resposta.ok || dados.ok === false) {
      return { ok: false, error: dados.error || `status ${resposta.status}` };
    }

    return { ok: true, results: dados.results || [] };
  } catch (erroRede) {
    return { ok: false, error: "falha de rede." };
  }
}

function criarLinhaResultado(item) {
  const linha = document.createElement("div");
  linha.className = "resultado-musica";

  const img = document.createElement("img");
  img.src = item.thumbnail;
  img.alt = "";

  const info = document.createElement("div");
  info.className = "resultado-info";

  const titulo = document.createElement("div");
  titulo.className = "resultado-titulo";
  titulo.textContent = item.title;

  const canal = document.createElement("div");
  canal.className = "resultado-canal";
  canal.textContent = item.channel;

  info.append(titulo, canal);
  linha.append(img, info);

  linha.addEventListener("click", () => {
    selecionarMusica(item);
    modalMusica.classList.add("escondido");
  });

  return linha;
}

function selecionarMusica(item) {
  enviarWS({
    type: "fila_adicionar",
    id: item.id,
    title: item.title,
    channel: item.channel,
    thumbnail: item.thumbnail,
  });
}

// ============================================================================
// Painel de rádio + player do YouTube
// ============================================================================

btnPularMusica.addEventListener("click", () => {
  enviarWS({ type: "proxima_musica" });
});

btnAtivarAudio.addEventListener("click", () => {
  audioLiberado = true;
  btnAtivarAudio.classList.add("escondido");
  if (ytPlayer && typeof ytPlayer.unMute === "function") {
    ytPlayer.unMute();
    ytPlayer.playVideo();
  }
});

function atualizarPainelRadio(tocandoAgora, fila) {
  tocandoAgoraAtual = tocandoAgora;

  if (!tocandoAgora) {
    tituloRadio.textContent = "Nenhuma música tocando";
    artistaRadio.textContent = "Pesquise qualquer música ou artista";
    miniRadioTitulo.textContent = "Nenhuma música tocando";
    capaRadio.textContent = "🎵";
    capaRadio.classList.remove("tocando");
    capaRadio.innerHTML = "🎵";
    btnPularMusica.classList.add("escondido");
    filaPreview.textContent = "";
    pararPlayer();
    return;
  }

  tituloRadio.textContent = tocandoAgora.title;
  artistaRadio.textContent = tocandoAgora.channel || "Tocando agora";
  miniRadioTitulo.textContent = tocandoAgora.title;
  btnPularMusica.classList.remove("escondido");

  capaRadio.innerHTML = "";
  if (tocandoAgora.thumbnail) {
    const img = document.createElement("img");
    img.src = tocandoAgora.thumbnail;
    img.alt = "";
    capaRadio.appendChild(img);
  } else {
    capaRadio.textContent = "🎵";
  }
  capaRadio.classList.add("tocando");

  filaPreview.textContent = fila && fila.length > 0
    ? `A seguir: ${fila.slice(0, 3).map((m) => m.title).join(" · ")}`
    : "";

  reproduzir(tocandoAgora);
}

function reproduzir(musica) {
  const segundosDesdeInicio = Math.max(0, Math.floor((Date.now() - musica.startedAt) / 1000));

  if (!ytPronto) {
    ytPendente = musica;
    return;
  }

  btnAtivarAudio.classList.toggle("escondido", audioLiberado);

  ytPlayer.loadVideoById({
    videoId: musica.id,
    startSeconds: segundosDesdeInicio,
  });

  if (!audioLiberado) {
    ytPlayer.mute();
  } else {
    ytPlayer.unMute();
  }
}

function pararPlayer() {
  if (ytPronto && ytPlayer && typeof ytPlayer.stopVideo === "function") {
    ytPlayer.stopVideo();
  }
}

// Callback exigido pela API do YouTube (precisa ser global).
window.onYouTubeIframeAPIReady = function () {
  ytPlayer = new YT.Player("player-youtube", {
    height: "1",
    width: "1",
    playerVars: { autoplay: 1, playsinline: 1 },
    events: {
      onReady: () => {
        ytPronto = true;
        if (ytPendente) {
          reproduzir(ytPendente);
          ytPendente = null;
        }
      },
      onStateChange: (evento) => {
        if (evento.data === YT.PlayerState.ENDED && tocandoAgoraAtual) {
          enviarWS({ type: "proxima_musica", videoId: tocandoAgoraAtual.id });
        }
        // Autoplay com som costuma ser bloqueado pelo navegador; se isso
        // acontecer, o player fica pausado/mudo e mostramos o botão de
        // "Ativar áudio" para o usuário liberar com um clique.
        if (evento.data === YT.PlayerState.PAUSED && !audioLiberado) {
          btnAtivarAudio.classList.remove("escondido");
        }
      },
    },
  });
};

// ============================================================================
// Início
// ============================================================================

iniciar();
