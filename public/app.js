"use strict";

const EMOJIS_SALA = ["#", "🎸", "🎮", "📚", "☕", "🌙", "🔥", "🎨"];
const SESSION_KEY = "sessaoSalaSonora";

let meuNome = "";
let meuId = "";
let meuRole = "user";
let sessionToken = "";
let salas = [];
let salaAtual = localStorage.getItem("salaAtual") || "geral";
let socket = null;
let tocandoAgoraAtual = null;
let ytPlayer = null;
let ytPronto = false;
let ytPendente = null;
let audioLiberado = false;
let emojiEscolhido = EMOJIS_SALA[0];
let filaAtual = [];
let conexaoAutenticada = false;
let roomRefreshTimer = null;
let loginModoCadastro = false;

const el = (id) => document.getElementById(id);

const modalAuth = el("modal-auth");
const tituloAuth = el("titulo-auth");
const subtituloAuth = el("subtitulo-auth");
const inputLogin = el("input-login");
const inputSenhaLogin = el("input-senha-login");
const btnAuth = el("btn-auth");
const btnTrocarAuth = el("btn-trocar-auth");
const textoTrocarAuth = el("texto-trocar-auth");
const erroAuth = el("erro-auth");

const modalSala = el("modal-sala");
const inputSala = el("input-sala");
const btnNovaSala = el("btn-nova-sala");
const btnCriarSala = el("btn-criar-sala");
const btnCancelarSala = el("btn-cancelar-sala");
const erroSala = el("erro-sala");
const emojiPicker = el("emoji-picker");
const checkSalaSenha = el("check-sala-senha");
const inputSalaSenha = el("input-sala-senha");

const modalSenhaSala = el("modal-senha-sala");
const inputEntrarSenha = el("input-entrar-senha");
const btnCancelarSenha = el("btn-cancelar-senha");
const btnEntrarSenha = el("btn-entrar-senha");
const erroSenhaSala = el("erro-senha-sala");

const modalMusica = el("modal-musica");
const btnAbrirBusca = el("btn-abrir-busca");
const btnFecharMusica = el("btn-fechar-musica");
const inputBuscaMusica = el("input-busca-musica");
const btnBuscarMusica = el("btn-buscar-musica");
const statusBusca = el("status-busca-musica");
const resultadosMusica = el("resultados-musica");

const modalFila = el("modal-fila");
const btnAbrirFila = el("btn-abrir-fila");
const btnFecharFila = el("btn-fechar-fila");
const listaFila = el("lista-fila");

const app = el("app");
const nomeUsuarioEl = el("nome-usuario");
const btnSair = el("btn-sair");
const badgeAdmin = el("badge-admin");
const btnAdmin = el("btn-admin");
const modalAdmin = el("modal-admin");
const btnFecharAdmin = el("btn-fechar-admin");
const btnAdminLimparTudo = el("btn-admin-limpar-tudo");
const listaAdminSalas = el("lista-admin-salas");
const listaSalasEl = el("lista-salas");
const miniRadioTitulo = el("mini-radio-titulo");
const btnAtivarAudio = el("btn-ativar-audio");
const capaRadio = el("capa-radio");
const tituloRadio = el("titulo-radio");
const artistaRadio = el("artista-radio");
const filaPreview = el("fila-preview");
const btnPausarMusica = el("btn-pausar-musica");
const btnPularMusica = el("btn-pular-musica");
const btnLimparConversa = el("btn-limpar-conversa");
const emojiSalaAtual = el("emoji-sala-atual");
const nomeSalaAtual = el("nome-sala-atual");
const presencaSala = el("presenca-sala");
const listaMensagens = el("lista-mensagens");
const inputMensagem = el("input-mensagem");
const btnEnviar = el("btn-enviar");

function salvarSessao() {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token: sessionToken, id: meuId, nome: meuNome, role: meuRole }));
}
function carregarSessao() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (s?.token && s?.id && s?.nome) { sessionToken = s.token; meuId = s.id; meuNome = s.nome; meuRole = s.role || "user"; return true; }
  } catch {}
  return false;
}
function limparSessao() { localStorage.removeItem(SESSION_KEY); sessionToken = ""; meuId = ""; meuNome = ""; meuRole = "user"; }

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("content-type", "application/json");
  if (sessionToken) headers.set("authorization", `Bearer ${sessionToken}`);
  const resposta = await fetch(path, { ...options, headers });
  const texto = await resposta.text();
  let dados = {};
  try { dados = texto ? JSON.parse(texto) : {}; } catch { dados = { ok: false, error: "Resposta inválida do servidor." }; }
  return { resposta, dados };
}

function mostrarAuth(cadastro = false) {
  loginModoCadastro = cadastro;
  tituloAuth.textContent = cadastro ? "Criar sua conta" : "Entrar na Sala Sonora";
  subtituloAuth.textContent = cadastro ? "Seu usuário ficará salvo para os próximos acessos." : "Entre com seu usuário e senha para continuar.";
  btnAuth.textContent = cadastro ? "Criar conta" : "Entrar";
  textoTrocarAuth.textContent = cadastro ? "Já tenho uma conta" : "Ainda não tenho conta";
  erroAuth.textContent = "";
  modalAuth.classList.remove("escondido");
  setTimeout(() => inputLogin.focus(), 30);
}

async function autenticar() {
  const nome = inputLogin.value.trim();
  const senha = inputSenhaLogin.value;
  if (nome.length < 3) { erroAuth.textContent = "Digite um usuário com pelo menos 3 caracteres."; return; }
  if (senha.length < 6) { erroAuth.textContent = "A senha deve ter pelo menos 6 caracteres."; return; }
  btnAuth.disabled = true;
  erroAuth.textContent = loginModoCadastro ? "Criando conta..." : "Entrando...";
  const rota = loginModoCadastro ? "/api/auth/register" : "/api/auth/login";
  try {
    const { resposta, dados } = await api(rota, { method: "POST", body: JSON.stringify({ nome, senha }) });
    if (!resposta.ok || !dados.ok) { erroAuth.textContent = dados.error || "Não foi possível continuar."; return; }
    sessionToken = dados.token; meuId = dados.user.id; meuNome = dados.user.nome; meuRole = dados.user.role || "user"; salvarSessao();
    modalAuth.classList.add("escondido");
    await abrirApp();
  } catch { erroAuth.textContent = "Falha de conexão."; }
  finally { btnAuth.disabled = false; }
}

async function iniciar() {
  montarEmojiPicker();
  btnAuth.addEventListener("click", autenticar);
  inputSenhaLogin.addEventListener("keydown", (e) => { if (e.key === "Enter") autenticar(); });
  inputLogin.addEventListener("keydown", (e) => { if (e.key === "Enter") inputSenhaLogin.focus(); });
  btnTrocarAuth.addEventListener("click", () => mostrarAuth(!loginModoCadastro));
  btnSair.addEventListener("click", () => { if (confirm("Sair da conta neste navegador?")) { if (socket) socket.close(); limparSessao(); app.classList.add("escondido"); mostrarAuth(false); } });

  if (carregarSessao()) {
    const { resposta, dados } = await api("/api/auth/me");
    if (resposta.ok && dados.ok) await abrirApp();
    else { limparSessao(); mostrarAuth(false); }
  } else mostrarAuth(false);
}

async function abrirApp() {
  app.classList.remove("escondido");
  nomeUsuarioEl.textContent = meuNome;
  const admin = meuRole === "admin";
  badgeAdmin.classList.toggle("escondido", !admin);
  btnAdmin.classList.toggle("escondido", !admin);
  await carregarSalasServidor();
  renderizarSalas();
  if (!salas.some((s) => s.nome === salaAtual)) salaAtual = "geral";
  trocarDeSala(salaAtual);
  clearInterval(roomRefreshTimer);
  roomRefreshTimer = setInterval(carregarSalasServidor, 5000);
}

async function carregarSalasServidor() {
  const { resposta, dados } = await api("/api/rooms");
  if (!resposta.ok || !dados.ok) return;
  const atual = salas.find((s) => s.nome === salaAtual);
  salas = dados.rooms || [];
  renderizarSalas();
  const novaAtual = salas.find((s) => s.nome === salaAtual);
  if (novaAtual && atual && novaAtual.protegida !== atual.protegida && socket) { trocarDeSala(salaAtual); }
}

function renderizarSalas() {
  listaSalasEl.innerHTML = "";
  for (const sala of salas) {
    const item = document.createElement("li");
    item.tabIndex = 0;
    item.className = sala.nome === salaAtual ? "ativa" : "";
    item.textContent = `${sala.protegida ? "🔒" : sala.emoji} ${sala.nome}`;
    item.addEventListener("click", () => trocarDeSala(sala.nome));
    listaSalasEl.appendChild(item);
  }
}

function trocarDeSala(nome) {
  if (!salas.some((s) => s.nome === nome)) return;
  if (nome === salaAtual && socket && socket.readyState === WebSocket.OPEN) return;
  salaAtual = nome;
  localStorage.setItem("salaAtual", salaAtual);
  renderizarSalas();
  const sala = salaAtualObjeto();
  emojiSalaAtual.textContent = sala.emoji || "#";
  nomeSalaAtual.textContent = nome;
  listaMensagens.innerHTML = "";
  btnLimparConversa.classList.toggle("escondido", sala.ownerId !== meuId);
  conectarWebSocket(nome);
}

function salaAtualObjeto() { return salas.find((s) => s.nome === salaAtual) || { nome: salaAtual, emoji: "#", protegida: false, ownerId: "" }; }

function montarEmojiPicker() {
  emojiPicker.innerHTML = "";
  for (const emoji of EMOJIS_SALA) {
    const b = document.createElement("button"); b.type = "button"; b.textContent = emoji;
    if (emoji === emojiEscolhido) b.classList.add("selecionado");
    b.addEventListener("click", () => { emojiEscolhido = emoji; montarEmojiPicker(); });
    emojiPicker.appendChild(b);
  }
}

async function carregarPainelAdmin() {
  const { resposta, dados } = await api("/api/rooms");
  if (!resposta.ok || !dados.ok) return;
  listaAdminSalas.innerHTML = "";
  for (const sala of dados.rooms || []) {
    const item = document.createElement("div"); item.className = "item-admin-sala";
    const info = document.createElement("div"); info.className = "admin-sala-info";
    const nome = document.createElement("strong"); nome.textContent = `${sala.protegida ? "🔒" : sala.emoji} ${sala.nome}`;
    const dono = document.createElement("span"); dono.textContent = sala.ownerName ? `Criada por ${sala.ownerName}` : "Sala do sistema";
    info.append(nome, dono);
    const acoes = document.createElement("div"); acoes.className = "admin-sala-acoes";
    const limpar = document.createElement("button"); limpar.className = "btn-secundario"; limpar.textContent = "🗑 Limpar";
    limpar.addEventListener("click", async () => {
      if (!confirm(`Limpar todas as mensagens da sala #${sala.nome}?`)) return;
      const r = await api(`/api/admin/rooms/${encodeURIComponent(sala.nome)}/clear`, { method: "POST" });
      if (!r.resposta.ok || !r.dados.ok) alert(r.dados.error || "Não foi possível limpar a sala.");
      else if (sala.nome === salaAtual) listaMensagens.innerHTML = "";
    });
    acoes.appendChild(limpar);
    if (sala.nome !== "geral") {
      const apagar = document.createElement("button"); apagar.className = "btn-perigo"; apagar.textContent = "✕ Apagar sala";
      apagar.addEventListener("click", async () => {
        if (!confirm(`APAGAR a sala #${sala.nome} e todo o histórico dela?`)) return;
        const r = await api(`/api/admin/rooms/${encodeURIComponent(sala.nome)}`, { method: "DELETE" });
        if (!r.resposta.ok || !r.dados.ok) { alert(r.dados.error || "Não foi possível apagar a sala."); return; }
        if (sala.nome === salaAtual) { if (socket) { socket.onclose = null; socket.close(); } salaAtual = "geral"; localStorage.setItem("salaAtual", "geral"); }
        await carregarSalasServidor();
        trocarDeSala("geral");
        await carregarPainelAdmin();
      });
      acoes.appendChild(apagar);
    }
    item.append(info, acoes); listaAdminSalas.appendChild(item);
  }
}

btnAdmin.addEventListener("click", async () => { if (meuRole !== "admin") return; modalAdmin.classList.remove("escondido"); await carregarPainelAdmin(); });
btnFecharAdmin.addEventListener("click", () => modalAdmin.classList.add("escondido"));
btnAdminLimparTudo.addEventListener("click", async () => {
  if (!confirm("ATENÇÃO: limpar as mensagens de TODAS as salas? Essa ação não pode ser desfeita.")) return;
  const r = await api("/api/admin/rooms/clear-all", { method: "POST" });
  if (!r.resposta.ok || !r.dados.ok) alert(r.dados.error || "Não foi possível limpar as conversas.");
  else { listaMensagens.innerHTML = ""; alert("Todas as conversas foram limpas."); }
});

btnNovaSala.addEventListener("click", () => {
  inputSala.value = ""; inputSalaSenha.value = ""; checkSalaSenha.checked = false; inputSalaSenha.classList.add("escondido"); erroSala.textContent = ""; modalSala.classList.remove("escondido"); inputSala.focus();
});
checkSalaSenha.addEventListener("change", () => { inputSalaSenha.classList.toggle("escondido", !checkSalaSenha.checked); if (checkSalaSenha.checked) inputSalaSenha.focus(); });
btnCancelarSala.addEventListener("click", () => modalSala.classList.add("escondido"));
btnCriarSala.addEventListener("click", async () => {
  const nome = inputSala.value.trim().toLowerCase().replace(/\s+/g, "-");
  const senha = inputSalaSenha.value;
  if (!nome) { erroSala.textContent = "Digite um nome para a sala."; return; }
  if (checkSalaSenha.checked && senha.length < 4) { erroSala.textContent = "Use uma senha com pelo menos 4 caracteres."; return; }
  btnCriarSala.disabled = true;
  const { resposta, dados } = await api("/api/rooms", { method: "POST", body: JSON.stringify({ nome, emoji: emojiEscolhido, senha: checkSalaSenha.checked ? senha : "" }) });
  btnCriarSala.disabled = false;
  if (!resposta.ok || !dados.ok) { erroSala.textContent = dados.error || "Não foi possível criar a sala."; return; }
  modalSala.classList.add("escondido");
  await carregarSalasServidor();
  trocarDeSala(nome);
});

btnCancelarSenha.addEventListener("click", () => { modalSenhaSala.classList.add("escondido"); if (socket) { socket.onclose = null; socket.close(); } });
btnEntrarSenha.addEventListener("click", () => { const senha = inputEntrarSenha.value; if (!senha) { erroSenhaSala.textContent = "Digite a senha."; return; } erroSenhaSala.textContent = ""; modalSenhaSala.classList.add("escondido"); enviarEntradaNaSala(senha); });
inputEntrarSenha.addEventListener("keydown", (e) => { if (e.key === "Enter") btnEntrarSenha.click(); });

async function hashLocal(senha) {
  const bytes = new TextEncoder().encode(String(senha));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function conectarWebSocket(nomeSala) {
  if (socket) { socket.onclose = null; socket.close(); }
  presencaSala.textContent = "conectando...";
  const protocolo = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocolo}//${location.host}/ws?room=${encodeURIComponent(nomeSala)}&token=${encodeURIComponent(sessionToken)}`);
  socket.addEventListener("open", () => { presencaSala.textContent = "autenticando..."; conexaoAutenticada = false; enviarEntradaNaSala(); });
  socket.addEventListener("message", (evento) => { try { tratarEventoServidor(JSON.parse(evento.data)); } catch {} });
  socket.addEventListener("close", () => { presencaSala.textContent = "desconectado — reconectando..."; setTimeout(() => { if (salaAtual === nomeSala && sessionToken) conectarWebSocket(nomeSala); }, 1500); });
  socket.addEventListener("error", () => { presencaSala.textContent = "erro de conexão"; });
}

async function enviarEntradaNaSala(senhaOverride = null) {
  const sala = salaAtualObjeto();
  let senhaHash = "";
  if (senhaOverride !== null) senhaHash = await hashLocal(senhaOverride);
  enviarWS({ type: "entrar", senhaHash });
}
function enviarWS(objeto) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(objeto)); }

function tratarEventoServidor(dados) {
  switch (dados.type) {
    case "autenticacao_necessaria":
      conexaoAutenticada = false;
      if (dados.protegida) { erroSenhaSala.textContent = ""; inputEntrarSenha.value = ""; modalSenhaSala.classList.remove("escondido"); inputEntrarSenha.focus(); }
      else enviarEntradaNaSala();
      break;
    case "estado_inicial":
      conexaoAutenticada = true; btnLimparConversa.classList.toggle("escondido", dados.ownerId !== meuId); listaMensagens.innerHTML = ""; for (const msg of dados.mensagens || []) renderizarMensagem(msg); rolarParaFinal(); atualizarPainelRadio(dados.tocandoAgora, dados.fila); break;
    case "mensagem": renderizarMensagem(dados.mensagem); rolarParaFinal(); break;
    case "mensagens_limpas": listaMensagens.innerHTML = ""; adicionarMensagemSistema("Conversa limpa pelo criador da sala."); break;
    case "reacao": atualizarReacaoNaTela(dados.messageId, dados.emoji, dados.total); break;
    case "presenca": presencaSala.textContent = `${dados.total} ${dados.total === 1 ? "pessoa" : "pessoas"} na sala`; break;
    case "tocando_agora": atualizarPainelRadio(dados.tocandoAgora, dados.fila); break;
    case "erro":
      if (dados.code === "SENHA_INCORRETA" || dados.code === "SENHA_NECESSARIA") { conexaoAutenticada = false; erroSenhaSala.textContent = dados.message; modalSenhaSala.classList.remove("escondido"); inputEntrarSenha.focus(); }
      else adicionarMensagemSistema(`⚠️ ${dados.message}`);
      break;
  }
}

function renderizarMensagem(msg) {
  const wrapper = document.createElement("div");
  wrapper.className = `mensagem ${msg.autorId === meuId ? "minha" : "outra"}`;
  wrapper.dataset.id = msg.id;
  const avatar = document.createElement("div"); avatar.className = "avatar-mini";
  const corpo = document.createElement("div"); corpo.className = "mensagem-corpo";
  const cabecalho = document.createElement("div"); cabecalho.className = "mensagem-cabecalho";
  const nomeSpan = document.createElement("span"); nomeSpan.className = "mensagem-nome"; nomeSpan.textContent = msg.autorId === meuId ? "Você" : msg.nome;
  const horaSpan = document.createElement("span"); horaSpan.className = "mensagem-hora"; horaSpan.textContent = new Date(msg.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  cabecalho.append(nomeSpan, horaSpan);
  const textoDiv = document.createElement("div"); textoDiv.className = "mensagem-texto"; textoDiv.textContent = msg.text;
  const reacoesDiv = document.createElement("div"); reacoesDiv.className = "mensagem-reacoes";
  for (const emoji of ["👍", "❤️", "😂"]) reacoesDiv.appendChild(criarChipReacao(msg.id, emoji, msg.reacoes?.[emoji] || 0));
  corpo.append(cabecalho, textoDiv, reacoesDiv); wrapper.append(avatar, corpo); listaMensagens.appendChild(wrapper);
}
function criarChipReacao(messageId, emoji, total) { const chip = document.createElement("button"); chip.type = "button"; chip.className = "chip-reacao"; chip.dataset.emoji = emoji; chip.textContent = total > 0 ? `${emoji} ${total}` : emoji; chip.addEventListener("click", () => enviarWS({ type: "reacao", messageId, emoji })); return chip; }
function atualizarReacaoNaTela(messageId, emoji, total) { const wrapper = listaMensagens.querySelector(`[data-id="${CSS.escape(messageId)}"]`); if (!wrapper) return; const chip = wrapper.querySelector(`.chip-reacao[data-emoji="${CSS.escape(emoji)}"]`); if (chip) { chip.textContent = total > 0 ? `${emoji} ${total}` : emoji; chip.classList.add("ativa"); } }
function adicionarMensagemSistema(texto) { const div = document.createElement("div"); div.className = "mensagem-sistema"; div.textContent = texto; listaMensagens.appendChild(div); rolarParaFinal(); }
function rolarParaFinal() { listaMensagens.scrollTop = listaMensagens.scrollHeight; }

function enviarMensagemAtual() {
  const texto = inputMensagem.value.trim(); if (!texto) return;
  if (texto.toLowerCase().startsWith("!play ")) { const termo = texto.slice(6).trim(); inputMensagem.value = ""; ajustarAlturaTextarea(); if (termo) tocarPorComando(termo); return; }
  enviarWS({ type: "mensagem", text: texto }); inputMensagem.value = ""; ajustarAlturaTextarea();
}
btnEnviar.addEventListener("click", enviarMensagemAtual);
inputMensagem.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviarMensagemAtual(); } });
inputMensagem.addEventListener("input", ajustarAlturaTextarea);
function ajustarAlturaTextarea() { inputMensagem.style.height = "auto"; inputMensagem.style.height = Math.min(inputMensagem.scrollHeight, 140) + "px"; }
async function tocarPorComando(termo) { adicionarMensagemSistema(`🔎 Buscando "${termo}" para tocar...`); const resultado = await buscarMusicaAPI(termo); if (!resultado.ok || !resultado.results.length) { adicionarMensagemSistema(`Não encontrei nada para "${termo}".`); return; } selecionarMusica(resultado.results[0]); }

btnAbrirBusca.addEventListener("click", () => { modalMusica.classList.remove("escondido"); inputBuscaMusica.value = ""; resultadosMusica.innerHTML = ""; statusBusca.textContent = ""; inputBuscaMusica.focus(); });
btnFecharMusica.addEventListener("click", () => modalMusica.classList.add("escondido"));
btnBuscarMusica.addEventListener("click", executarBusca);
inputBuscaMusica.addEventListener("keydown", (e) => { if (e.key === "Enter") executarBusca(); });
async function executarBusca() { const termo = inputBuscaMusica.value.trim(); if (!termo) return; statusBusca.textContent = "Buscando..."; resultadosMusica.innerHTML = ""; const resultado = await buscarMusicaAPI(termo); if (!resultado.ok) { statusBusca.textContent = `Erro: ${resultado.error || "não foi possível buscar."}`; return; } if (!resultado.results.length) { statusBusca.textContent = "Nenhum resultado encontrado."; return; } statusBusca.textContent = ""; resultado.results.forEach((item) => resultadosMusica.appendChild(criarLinhaResultado(item))); }
async function buscarMusicaAPI(termo) { try { const resposta = await fetch(`/api/music?q=${encodeURIComponent(termo)}`); const texto = await resposta.text(); const dados = texto ? JSON.parse(texto) : {}; if (!resposta.ok || dados.ok === false) return { ok: false, error: dados.error || `status ${resposta.status}` }; return { ok: true, results: dados.results || [] }; } catch { return { ok: false, error: "falha de rede." }; } }
function criarLinhaResultado(item) { const linha = document.createElement("div"); linha.className = "resultado-musica"; const img = document.createElement("img"); img.src = item.thumbnail; img.alt = ""; const info = document.createElement("div"); info.className = "resultado-info"; const titulo = document.createElement("div"); titulo.className = "resultado-titulo"; titulo.textContent = item.title; const canal = document.createElement("div"); canal.className = "resultado-canal"; canal.textContent = item.channel; info.append(titulo, canal); linha.append(img, info); linha.addEventListener("click", () => { selecionarMusica(item); modalMusica.classList.add("escondido"); }); return linha; }
function selecionarMusica(item) { enviarWS({ type: "fila_adicionar", id: item.id, title: item.title, channel: item.channel, thumbnail: item.thumbnail }); }

btnPausarMusica.addEventListener("click", () => {
  if (!tocandoAgoraAtual) return;
  if (tocandoAgoraAtual.paused) enviarWS({ type: "continuar_musica" });
  else {
    let position = 0;
    try { if (ytPlayer && typeof ytPlayer.getCurrentTime === "function") position = ytPlayer.getCurrentTime(); } catch {}
    enviarWS({ type: "pausar_musica", position });
  }
});
btnPularMusica.addEventListener("click", () => enviarWS({ type: "proxima_musica", videoId: tocandoAgoraAtual?.id }));
btnLimparConversa.addEventListener("click", () => { if (confirm("Limpar todas as mensagens desta sala para todos?")) enviarWS({ type: "limpar_mensagens" }); });
btnAbrirFila.addEventListener("click", () => { modalFila.classList.remove("escondido"); renderizarFila(filaAtual); });
btnFecharFila.addEventListener("click", () => modalFila.classList.add("escondido"));
function renderizarFila(fila) { filaAtual = Array.isArray(fila) ? fila : []; listaFila.innerHTML = ""; if (!filaAtual.length) { const vazio = document.createElement("div"); vazio.className = "fila-vazia"; vazio.textContent = "A fila está vazia."; listaFila.appendChild(vazio); return; } filaAtual.forEach((musica, index) => { const item = document.createElement("div"); item.className = "item-fila"; const numero = document.createElement("span"); numero.className = "fila-numero"; numero.textContent = String(index + 1).padStart(2, "0"); const img = document.createElement("img"); img.src = musica.thumbnail || ""; img.alt = ""; const info = document.createElement("div"); info.className = "fila-info"; const titulo = document.createElement("div"); titulo.className = "fila-titulo"; titulo.textContent = musica.title; const canal = document.createElement("div"); canal.className = "fila-canal"; canal.textContent = musica.channel || ""; info.append(titulo, canal); item.append(numero, img, info); listaFila.appendChild(item); }); }

btnAtivarAudio.addEventListener("click", () => { audioLiberado = true; btnAtivarAudio.classList.add("escondido"); if (ytPlayer?.unMute) { ytPlayer.unMute(); ytPlayer.playVideo(); } });
function atualizarPainelRadio(tocandoAgora, fila) {
  tocandoAgoraAtual = tocandoAgora; filaAtual = Array.isArray(fila) ? fila : []; renderizarFila(filaAtual);
  if (!tocandoAgora) { tituloRadio.textContent = "Nenhuma música tocando"; artistaRadio.textContent = "Pesquise qualquer música ou artista"; miniRadioTitulo.textContent = "Nenhuma música tocando"; capaRadio.innerHTML = "🎵"; capaRadio.classList.remove("tocando"); btnPausarMusica.classList.add("escondido"); btnPularMusica.classList.add("escondido"); filaPreview.textContent = "Fila vazia"; pararPlayer(); return; }
  tituloRadio.textContent = tocandoAgora.title; artistaRadio.textContent = tocandoAgora.channel || "Tocando agora"; miniRadioTitulo.textContent = tocandoAgora.title; btnPausarMusica.classList.remove("escondido"); btnPularMusica.classList.remove("escondido"); btnPausarMusica.textContent = tocandoAgora.paused ? "▶ Continuar" : "⏸ Pausar";
  capaRadio.innerHTML = ""; if (tocandoAgora.thumbnail) { const img = document.createElement("img"); img.src = tocandoAgora.thumbnail; img.alt = ""; capaRadio.appendChild(img); } else capaRadio.textContent = "🎵";
  capaRadio.classList.toggle("tocando", !tocandoAgora.paused); filaPreview.textContent = filaAtual.length ? `${filaAtual.length} ${filaAtual.length === 1 ? "música na fila" : "músicas na fila"}` : "Fila vazia";
  reproduzir(tocandoAgora);
}
function reproduzir(musica) {
  let segundos;
  if (musica.paused) segundos = Number(musica.position || 0);
  else segundos = Math.max(0, (Date.now() - musica.startedAt) / 1000);
  if (!ytPronto) { ytPendente = musica; return; }
  btnAtivarAudio.classList.toggle("escondido", audioLiberado);
  ytPlayer.loadVideoById({ videoId: musica.id, startSeconds: segundos });
  if (!audioLiberado) ytPlayer.mute(); else ytPlayer.unMute();
  if (musica.paused) setTimeout(() => { if (ytPlayer && tocandoAgoraAtual?.id === musica.id && tocandoAgoraAtual.paused) ytPlayer.pauseVideo(); }, 450);
}
function pararPlayer() { if (ytPronto && ytPlayer?.stopVideo) ytPlayer.stopVideo(); }
window.onYouTubeIframeAPIReady = function () {
  ytPlayer = new YT.Player("player-youtube", { height: "1", width: "1", playerVars: { autoplay: 1, playsinline: 1 }, events: {
    onReady: () => { ytPronto = true; if (ytPendente) { reproduzir(ytPendente); ytPendente = null; } },
    onStateChange: (evento) => {
      if (evento.data === YT.PlayerState.ENDED && tocandoAgoraAtual) enviarWS({ type: "proxima_musica", videoId: tocandoAgoraAtual.id });
      if (evento.data === YT.PlayerState.PAUSED && !audioLiberado && tocandoAgoraAtual && !tocandoAgoraAtual.paused) btnAtivarAudio.classList.remove("escondido");
    },
  }});
};

iniciar();
