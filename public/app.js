"use strict";

const SESSION_KEY = "salaSonoraSession";
const SETTINGS_KEY = "salaSonoraPrefs";
const accents = ["#9b7cff", "#5ea7ff", "#ff7190", "#42d3a0", "#f5b45c", "#67d6d0"];

let user = { id: "", nome: "", displayName: "", role: "user" };
let token = "";
let rooms = [];
let currentRoom = localStorage.getItem("ss-room") || "geral";
let socket = null;
let socketGeneration = 0;
let reconnectTimer = null;
let reconnectAttempt = 0;
let authenticated = false;
let queue = [];
let currentTrack = null;
let loadedVideoId = null;
let yt = null;
let ytReady = false;
let audioOn = true;
let volumeLevel = 100;
let volumeMuted = false;
let audioCtx = null;
let selectedAccent = accents[0];
let authRegister = false;
let roomPoll = null;
let soundEnabled = true;
let lastIncomingMessageId = null;
let lastMusicId = null;

const $ = (id) => document.getElementById(id);
const auth = $("auth");
const app = $("app");
const authTitle = $("auth-title");
const authSubtitle = $("auth-subtitle");
const authUser = $("auth-user");
const authPass = $("auth-pass");
const authSubmit = $("auth-submit");
const authToggle = $("auth-toggle");
const authError = $("auth-error");
const roomModal = $("room-modal");
const roomName = $("room-name");
const roomPrivate = $("room-private");
const roomPass = $("room-pass");
const roomPassWrap = $("room-pass-wrap");
const roomError = $("room-error");
const roomsEl = $("rooms");
const accentPicker = $("accent-picker");
const passwordModal = $("password-modal");
const roomEnterPass = $("room-enter-pass");
const passwordError = $("password-error");
const musicModal = $("music-modal");
const musicSearch = $("music-search");
const musicResults = $("music-results");
const musicStatus = $("music-status");
const gifModal = $("gif-modal");
const gifSearch = $("gif-search");
const gifSearchBtn = $("gif-search-btn");
const gifCategories = $("gif-categories");
const gifStatus = $("gif-status");
const gifResults = $("gif-results");
const openGifBtn = $("open-gif");
const openImageBtn = $("open-image");
const imageInput = $("image-input");
const queueModal = $("queue-modal");
const queueList = $("queue-list");
const adminModal = $("admin-modal");
const adminRooms = $("admin-rooms");
const settingsModal = $("settings-modal");
const displayNameInput = $("display-name-input");
const siteNameInput = $("site-name-input");
const siteSettingsWrap = $("site-settings-wrap");
const settingsError = $("settings-error");
const messages = $("messages");
const messageInput = $("message-input");
const presence = $("presence");
const currentRoomEl = $("current-room");
const roomBadge = $("room-badge");
const clearRoom = $("clear-room");
const trackTitle = $("track-title");
const trackChannel = $("track-channel");
const cover = $("cover");
const progressBar = $("progress-bar");
const timeCurrent = $("time-current");
const timeTotal = $("time-total");
const playPause = $("play-pause");
const playIcon = $("play-icon");
const nextTrack = $("next-track");
const sound = $("sound");
const volumeMute = $("volume-mute");
const volumeRange = $("volume-range");
const volumeValue = $("volume-value");
const queueCount = $("queue-count");
const miniQueue = $("mini-queue");
const syncLabel = $("sync-label");

const iconPaths = {
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 2-2 5 5"/>',
  music: '<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V20h-2.6v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H4v-2.6h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V5h2.6v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v2.6h-.1a1.7 1.7 0 0 0-1.6 1Z"/>',
  queue: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  next: '<path d="m5 5 9 7-9 7ZM18 5v14"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  bellOff: '<path d="m3 3 18 18M10 21h4M6.3 17H21c0-2-3-2-3-9a6 6 0 0 0-8.8-5.3M6 8c0 2.3-.5 4.1-1.3 5.6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  trash: '<path d="M4 7h16M10 11v5M14 11v5M6 7l1 13h10l1-13M9 7l1-3h4l1 3"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a9 9 0 0 1 0 12"/>',
  volumeOff: '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m17 9 4 6M21 9l-4 6"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
};
function icon(name, size = 17) { return `<svg class="svg-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || ""}</svg>`; }

function toast(text, error = false) {
  const d = document.createElement("div");
  d.className = `toast${error ? " error" : ""}`;
  d.innerHTML = `${icon(error ? "close" : "music", 14)}<span></span>`;
  d.querySelector("span").textContent = text;
  $("toast-stack").appendChild(d);
  setTimeout(() => d.remove(), 3200);
}
function initials(name) { return String(name || "?").trim().slice(0, 2).toUpperCase(); }
function saveSession() { localStorage.setItem(SESSION_KEY, JSON.stringify({ token, ...user })); }
function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (s?.token && s?.id && s?.nome) {
      token = s.token;
      user = { id: s.id, nome: s.nome, displayName: s.displayName || s.nome, role: s.role || "user" };
      return true;
    }
  } catch {}
  return false;
}
function clearSession() { localStorage.removeItem(SESSION_KEY); token = ""; user = { id: "", nome: "", displayName: "", role: "user" }; }
function loadPrefs() { try { const p = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); soundEnabled = p.sound !== false; volumeLevel = Math.max(0, Math.min(100, Number(p.volume ?? 100))); volumeMuted = Boolean(p.volumeMuted); } catch {} updateVolumeUI(); }
function savePrefs() { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ sound: soundEnabled, volume: volumeLevel, volumeMuted })); updateSoundButton(); updateVolumeUI(); }
function effectiveVolume() { return volumeMuted ? 0 : volumeLevel; }
function updateVolumeUI() { if (!volumeRange) return; volumeRange.value = String(volumeLevel); volumeValue.textContent = `${effectiveVolume()}%`; volumeMute.innerHTML = icon(effectiveVolume() === 0 ? "volumeOff" : "volume", 17); volumeMute.classList.toggle("muted", effectiveVolume() === 0); }
function applyVolume() { const v = effectiveVolume(); audioOn = v > 0; try { yt?.setVolume?.(v); if (v > 0) yt?.unMute?.(); else yt?.mute?.(); } catch {} updateVolumeUI(); }
function ensureAudio() {
  if (!soundEnabled) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch {}
}
function ping(kind = "message") {
  if (!soundEnabled) return;
  ensureAudio();
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = kind === "music" ? "sine" : "triangle";
  osc.frequency.setValueAtTime(kind === "music" ? 660 : 520, now);
  osc.frequency.exponentialRampToValueAtTime(kind === "music" ? 880 : 700, now + 0.09);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(kind === "music" ? 0.055 : 0.035, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.16);
}
function updateSoundButton() {
  if (!sound) return;
  sound.innerHTML = `${icon(soundEnabled ? "bell" : "bellOff", 15)}<span>${soundEnabled ? "Sons ligados" : "Sons desligados"}</span>`;
  sound.classList.remove("hidden");
  sound.classList.toggle("muted", !soundEnabled);
}
function setAuthMode(register) {
  authRegister = register;
  authTitle.textContent = register ? "Criar conta" : "Entrar";
  authSubtitle.textContent = register ? "Seu perfil fica salvo neste dispositivo." : "Entre para conversar e ouvir com a sala.";
  authSubmit.textContent = register ? "Criar conta" : "Entrar";
  authToggle.textContent = register ? "Já tenho uma conta" : "Criar uma conta";
  authError.textContent = "";
}
async function api(path, options = {}) {
  const h = new Headers(options.headers || {});
  if (options.body && !h.has("content-type")) h.set("content-type", "application/json");
  if (token) h.set("authorization", `Bearer ${token}`);
  const r = await fetch(path, { ...options, headers: h });
  const raw = await r.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { ok: false, error: "Resposta inválida." }; }
  return { r, data };
}
async function authSubmitNow() {
  const nome = authUser.value.trim(), senha = authPass.value;
  if (nome.length < 3) return authError.textContent = "Use pelo menos 3 caracteres no usuário.";
  if (senha.length < 6) return authError.textContent = "A senha precisa ter pelo menos 6 caracteres.";
  authSubmit.disabled = true;
  authError.textContent = authRegister ? "Criando..." : "Entrando...";
  try {
    const { r, data } = await api(authRegister ? "/api/auth/register" : "/api/auth/login", { method: "POST", body: JSON.stringify({ nome, senha }) });
    if (!r.ok || !data.ok) { authError.textContent = data.error || "Não foi possível entrar."; return; }
    token = data.token; user = data.user; saveSession(); ensureAudio(); await openApp();
  } catch { authError.textContent = "Falha de conexão."; }
  finally { authSubmit.disabled = false; }
}

async function boot() {
  loadPrefs();
  buildAccentPicker();
  $("settings-icon").innerHTML = icon("settings", 14);
  $("queue-icon").innerHTML = icon("queue", 13);
  updateSoundButton();
  updateVolumeUI();
  volumeRange.oninput = () => { volumeLevel = Number(volumeRange.value); volumeMuted = false; savePrefs(); applyVolume(); };
  volumeMute.onclick = () => { volumeMuted = !volumeMuted; savePrefs(); applyVolume(); };
  authSubmit.onclick = authSubmitNow;
  authToggle.onclick = () => setAuthMode(!authRegister);
  authPass.onkeydown = e => { if (e.key === "Enter") authSubmitNow(); };
  authUser.onkeydown = e => { if (e.key === "Enter") authPass.focus(); };
  $("logout").onclick = () => { if (confirm("Sair desta conta neste dispositivo?")) { if (socket) socket.close(); clearSession(); app.classList.add("hidden"); auth.classList.remove("hidden"); setAuthMode(false); } };
  $("new-room").onclick = () => { roomName.value = ""; roomPass.value = ""; roomPrivate.checked = false; roomPassWrap.classList.add("hidden"); roomError.textContent = ""; roomModal.classList.remove("hidden"); roomName.focus(); };
  $("room-close").onclick = () => roomModal.classList.add("hidden");
  roomPrivate.onchange = () => roomPassWrap.classList.toggle("hidden", !roomPrivate.checked);
  $("room-create").onclick = createRoom;
  $("password-close").onclick = () => { passwordModal.classList.add("hidden"); if (socket) socket.close(); };
  $("password-enter").onclick = () => sendRoomPassword(roomEnterPass.value);
  roomEnterPass.onkeydown = e => { if (e.key === "Enter") sendRoomPassword(roomEnterPass.value); };
  $("open-music").innerHTML = icon("music", 18);
  $("open-image").innerHTML = icon("image", 18);
  $("open-search-top").querySelector("span")?.replaceWith(Object.assign(document.createElement("span"), { innerHTML: icon("search", 14) }));
  gifSearchBtn.innerHTML = icon("search", 16);
  $("open-music").onclick = openMusic;
  $("open-search-top").onclick = openMusic;
  openGifBtn.onclick = openGifPicker;
  $("gif-close").onclick = () => gifModal.classList.add("hidden");
  gifSearchBtn.onclick = searchGifs;
  gifSearch.onkeydown = e => { if (e.key === "Enter") searchGifs(); };
  openImageBtn.onclick = () => imageInput.click();
  imageInput.onchange = handleImageFile;
  $("music-close").onclick = () => musicModal.classList.add("hidden");
  $("music-search-btn").onclick = searchMusic;
  musicSearch.onkeydown = e => { if (e.key === "Enter") searchMusic(); };
  $("open-queue").onclick = openQueue; $("open-queue-2").onclick = openQueue; $("queue-close").onclick = () => queueModal.classList.add("hidden");
  $("admin-open").onclick = () => { adminModal.classList.remove("hidden"); loadAdmin(); };
  $("admin-close").onclick = () => adminModal.classList.add("hidden");
  $("admin-clear-all").onclick = adminClearAll;
  $("settings-open").onclick = openSettings; $("settings-close").onclick = () => settingsModal.classList.add("hidden"); $("settings-save").onclick = saveSettings;
  $("send").onclick = sendMessage;
  messageInput.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
  messageInput.oninput = resizeMessage;
  clearRoom.onclick = () => sendWS({ type: "limpar_mensagens" });
  playPause.onclick = togglePlayback;
  nextTrack.onclick = () => { if (currentTrack) sendWS({ type: "proxima_musica", videoId: currentTrack.id }); };
  sound.onclick = () => { soundEnabled = !soundEnabled; savePrefs(); if (soundEnabled) { ensureAudio(); ping("message"); } };
  $("mobile-menu").onclick = () => document.body.classList.toggle("sidebar-open");
  document.addEventListener("pointerdown", ensureAudio, { once: true });
  document.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openMusic(); } });
  if (loadSession()) {
    const { r, data } = await api("/api/auth/me");
    if (r.ok && data.ok) { user = data.user; saveSession(); await openApp(); }
    else { clearSession(); auth.classList.remove("hidden"); setAuthMode(false); }
  } else setAuthMode(false);
}

async function openApp() {
  auth.classList.add("hidden"); app.classList.remove("hidden");
  $("user-name").textContent = user.displayName || user.nome;
  $("user-avatar").textContent = initials(user.displayName || user.nome);
  $("user-role").textContent = user.role === "admin" ? "admin" : "online";
  $("admin-open").classList.toggle("hidden", user.role !== "admin");
  await loadConfig();
  await loadRooms();
  if (!rooms.some(r => r.nome === currentRoom)) currentRoom = "geral";
  renderRooms(); connectRoom(currentRoom);
  clearInterval(roomPoll); roomPoll = setInterval(loadRooms, 4000);
}
async function loadConfig() {
  const { r, data } = await api("/api/config");
  if (!r.ok || !data.ok) return;
  const name = data.siteName || "Chat da Firma";
  $("site-name").textContent = name;
  $("brand-mark").textContent = initials(name).slice(0, 1);
  $("auth-site-name").textContent = name.toUpperCase();
}
function openSettings() {
  displayNameInput.value = user.displayName || user.nome;
  siteNameInput.value = $("site-name").textContent || "Chat da Firma";
  siteSettingsWrap.classList.toggle("hidden", user.role !== "admin");
  settingsError.textContent = "";
  settingsModal.classList.remove("hidden"); displayNameInput.focus();
}
async function saveSettings() {
  const displayName = displayNameInput.value.trim();
  if (displayName.length < 2 || displayName.length > 30) { settingsError.textContent = "Seu nome deve ter entre 2 e 30 caracteres."; return; }
  settingsError.textContent = "Salvando...";
  const profile = await api("/api/settings/profile", { method: "POST", body: JSON.stringify({ displayName }) });
  if (!profile.r.ok || !profile.data.ok) { settingsError.textContent = profile.data.error || "Não foi possível salvar seu nome."; return; }
  user = { ...user, ...profile.data.user }; saveSession(); $("user-name").textContent = user.displayName; $("user-avatar").textContent = initials(user.displayName);
  if (user.role === "admin") {
    const siteName = siteNameInput.value.trim();
    if (siteName.length < 2 || siteName.length > 40) { settingsError.textContent = "O nome do site deve ter entre 2 e 40 caracteres."; return; }
    const site = await api("/api/admin/settings", { method: "POST", body: JSON.stringify({ siteName }) });
    if (!site.r.ok || !site.data.ok) { settingsError.textContent = site.data.error || "Não foi possível salvar o nome do site."; return; }
    $("site-name").textContent = site.data.siteName; $("brand-mark").textContent = initials(site.data.siteName).slice(0, 1); $("auth-site-name").textContent = site.data.siteName.toUpperCase();
  }
  settingsModal.classList.add("hidden"); toast("Ajustes salvos");
  if (socket?.readyState === WebSocket.OPEN) { socket.close(); setTimeout(() => connectRoom(currentRoom), 150); }
}
async function loadRooms() {
  const { r, data } = await api("/api/rooms");
  if (!r.ok || !data.ok) return;
  const old = rooms; rooms = data.rooms || []; renderRooms();
  if (!rooms.some(x => x.nome === currentRoom)) { currentRoom = "geral"; connectRoom("geral"); return; }
  const oldCurrent = old.find(x => x.nome === currentRoom), newCurrent = rooms.find(x => x.nome === currentRoom);
  if (oldCurrent && newCurrent && oldCurrent.protegida !== newCurrent.protegida) connectRoom(currentRoom);
}
function renderRooms() {
  roomsEl.innerHTML = "";
  for (const room of rooms) {
    const b = document.createElement("button"); b.className = `room-item${room.nome === currentRoom ? " active" : ""}`;
    const dot = document.createElement("span"); dot.className = "room-dot"; dot.style.setProperty("--room-color", roomColor(room)); dot.textContent = initials(room.nome).slice(0, 1);
    const label = document.createElement("span"); label.textContent = room.nome; b.append(dot, label);
    if (room.protegida) { const lock = document.createElement("span"); lock.className = "room-lock"; lock.innerHTML = icon("lock", 13); b.append(lock); }
    b.onclick = () => selectRoom(room.nome); roomsEl.appendChild(b);
  }
}
function roomColor(room) { const map = { violet: "#9b7cff", blue: "#5ea7ff", pink: "#ff7190", green: "#42d3a0", amber: "#f5b45c", cyan: "#67d6d0" }; return map[room?.accent] || map.violet; }
function selectRoom(name) {
  if (name === currentRoom && socket?.readyState === WebSocket.OPEN && authenticated) return;
  currentRoom = name; localStorage.setItem("ss-room", name); renderRooms(); document.body.classList.remove("sidebar-open"); connectRoom(name);
}
function connectRoom(name) {
  if (!token) return;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (socket) { try { socket.close(1000, "troca de sala"); } catch {} }
  authenticated = false; messages.innerHTML = ""; currentTrack = null; queue = []; loadedVideoId = null; updateRadio();
  presence.textContent = "conectando…";
  const gen = ++socketGeneration;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const wsUrl = `${proto}://${location.host}/ws?room=${encodeURIComponent(name)}&token=${encodeURIComponent(token)}`;
  try { socket = new WebSocket(wsUrl); }
  catch { scheduleReconnect(name, gen); return; }
  socket.onopen = () => { if (gen !== socketGeneration) return; reconnectAttempt = 0; presence.textContent = "autenticando…"; };
  socket.onmessage = e => { if (gen !== socketGeneration) return; try { handleServer(JSON.parse(e.data)); } catch (err) { console.error("Mensagem WS inválida", err); } };
  socket.onerror = () => { if (gen === socketGeneration) presence.textContent = "erro de conexão"; };
  socket.onclose = () => { if (gen !== socketGeneration) return; authenticated = false; presence.textContent = "reconectando…"; scheduleReconnect(name, gen); };
}
function scheduleReconnect(name, gen) {
  if (!token || gen !== socketGeneration || reconnectTimer) return;
  const delay = Math.min(8000, 900 * Math.pow(1.6, reconnectAttempt++));
  reconnectTimer = setTimeout(() => { reconnectTimer = null; if (gen === socketGeneration && token) connectRoom(name); }, delay);
}
function sendWS(obj) {
  const ready = socket?.readyState === WebSocket.OPEN;
  // O primeiro pacote é enviado antes da autenticação terminar.
  // Sem essa exceção, o cliente fica preso em “autenticando…” para sempre.
  const preAuth = obj?.type === "entrar";
  if (!ready || (!authenticated && !preAuth)) {
    toast("A sala ainda não está pronta.", true);
    return false;
  }
  try {
    socket.send(JSON.stringify(obj));
    return true;
  } catch {
    toast("Não foi possível enviar agora.", true);
    return false;
  }
}
async function hashLocal(text) {
  const bytes = new TextEncoder().encode(text); const d = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function handleServer(d) {
  if (d.type === "autenticacao_necessaria") {
    if (d.protegida) { passwordError.textContent = ""; roomEnterPass.value = ""; passwordModal.classList.remove("hidden"); roomEnterPass.focus(); }
    else sendWS({ type: "entrar", senhaHash: "" });
    return;
  }
  if (d.type === "estado_inicial") {
    authenticated = true; passwordModal.classList.add("hidden");
    const room = rooms.find(x => x.nome === currentRoom);
    currentRoomEl.textContent = currentRoom; roomBadge.textContent = initials(currentRoom).slice(0, 1); roomBadge.style.color = roomColor(room);
    clearRoom.classList.toggle("hidden", d.ownerId !== user.id && user.role !== "admin");
    messages.innerHTML = ""; (d.mensagens || []).forEach(renderMessage);
    queue = d.fila || []; applyRadioState(d.tocandoAgora, d.fila, true); scrollBottom();
    syncLabel.textContent = "ao vivo";
    return;
  }
  if (d.type === "mensagem") {
    renderMessage(d.mensagem); scrollBottom();
    if (d.mensagem?.autorId !== user.id && d.mensagem?.id !== lastIncomingMessageId) { lastIncomingMessageId = d.mensagem.id; ping("message"); }
    return;
  }
  if (d.type === "mensagens_limpas") { messages.innerHTML = ""; systemMessage("O histórico desta sala foi limpo."); return; }
  if (d.type === "reacao") { updateReaction(d.messageId, d.emoji, d.total); return; }
  if (d.type === "presenca") { presence.textContent = `${d.total} ${d.total === 1 ? "pessoa" : "pessoas"} na sala`; return; }
  if (d.type === "tocando_agora") {
    const nextId = d.tocandoAgora?.id || null;
    const wasMusic = lastMusicId;
    applyRadioState(d.tocandoAgora, d.fila, false);
    if (nextId && nextId !== wasMusic) ping("music");
    lastMusicId = nextId;
    return;
  }
  if (d.type === "sala_excluida") { toast("Esta sala foi removida.", true); currentRoom = "geral"; localStorage.setItem("ss-room", "geral"); loadRooms().then(() => connectRoom("geral")); return; }
  if (d.type === "erro") {
    if (d.code === "SENHA_INCORRETA") { passwordError.textContent = d.message; passwordModal.classList.remove("hidden"); }
    else toast(d.message || "Algo deu errado.", true);
  }
}
function sendRoomPassword(pass) { if (!pass) return passwordError.textContent = "Digite a senha."; hashLocal(pass).then(h => sendWS({ type: "entrar", senhaHash: h })); }
function renderMessage(m) {
  const row = document.createElement("article");
  row.className = `message-row${m.autorId === user.id ? " mine" : ""}`;
  row.dataset.id = m.id;
  const av = document.createElement("div"); av.className = "message-avatar"; av.textContent = initials(m.nome);
  const c = document.createElement("div"); c.className = "message-content";
  const head = document.createElement("div"); head.className = "message-head";
  const name = document.createElement("span"); name.className = "message-name"; name.textContent = m.autorId === user.id ? "Você" : m.nome;
  const time = document.createElement("span"); time.className = "message-time"; time.textContent = new Date(m.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  head.append(name, time);
  const bubble = document.createElement("div"); bubble.className = `bubble${m.mediaType ? " media-bubble" : ""}`;
  if (m.mediaType === "gif" || m.mediaType === "image") {
    const img = document.createElement("img");
    img.src = m.url || ""; img.alt = m.alt || (m.mediaType === "gif" ? "GIF" : "Imagem enviada");
    img.loading = "lazy"; img.referrerPolicy = "no-referrer";
    img.onerror = () => { img.remove(); const e = document.createElement("span"); e.className = "media-error"; e.textContent = "Mídia indisponível"; bubble.appendChild(e); };
    bubble.appendChild(img);
    if (m.caption) { const cap = document.createElement("div"); cap.className = "media-caption"; cap.textContent = m.caption; bubble.appendChild(cap); }
  } else {
    bubble.textContent = m.text || "";
  }
  const reactions = document.createElement("div"); reactions.className = "reactions";
  for (const emoji of ["👍", "❤️", "😂", "🔥"]) {
    const b = document.createElement("button"); b.className = "reaction"; b.textContent = m.reacoes?.[emoji] ? `${emoji} ${m.reacoes[emoji]}` : emoji;
    b.title = `Reagir com ${emoji}`; b.onclick = () => { ensureAudio(); sendWS({ type: "reacao", messageId: m.id, emoji }); }; reactions.appendChild(b);
  }
  c.append(head, bubble, reactions); row.append(av, c); messages.appendChild(row);
}
function updateReaction(id, emoji, total) {
  const row = messages.querySelector(`[data-id="${CSS.escape(id)}"]`); if (!row) return;
  const button = [...row.querySelectorAll(".reaction")].find(x => x.textContent.startsWith(emoji));
  if (button) button.textContent = total ? `${emoji} ${total}` : emoji;
}
function systemMessage(t) { const d = document.createElement("div"); d.className = "system-message"; d.textContent = t; messages.appendChild(d); scrollBottom(); }
function scrollBottom() { requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; }); }
function sendMessage() {
  const text = messageInput.value.trim(); if (!text) return;
  if (!authenticated) { toast("A sala ainda está conectando.", true); return; }
  if (text.toLowerCase().startsWith("!play ")) { searchAndQueue(text.slice(6).trim()); messageInput.value = ""; resizeMessage(); return; }
  if (sendWS({ type: "mensagem", text })) { messageInput.value = ""; resizeMessage(); }
}
function sendMedia(url, mediaType, alt = "", caption = "", source = "") {
  if (!authenticated || !url) return false;
  const ok = sendWS({ type: "media", mediaType, url, alt, caption, source });
  if (ok) { messageInput.value = ""; resizeMessage(); }
  return ok;
}
function openGifPicker() {
  gifModal.classList.remove("hidden"); gifSearch.value = ""; gifStatus.textContent = "Carregando GIFs em destaque…"; gifResults.innerHTML = "";
  buildGifCategories(); loadGifs(""); setTimeout(() => gifSearch.focus(), 30);
}
function buildGifCategories() {
  gifCategories.innerHTML = "";
  ["😂 reação", "😎 confiante", "👏 aplausos", "🔥 fogo", "😮 surpresa", "❤️ amor"].forEach(label => {
    const b = document.createElement("button"); b.className = "gif-chip"; b.textContent = label;
    b.onclick = () => { const q = label.slice(2).trim(); gifSearch.value = q; loadGifs(q); }; gifCategories.appendChild(b);
  });
}
async function searchGifs() { await loadGifs(gifSearch.value.trim()); }
async function loadGifs(q) {
  gifStatus.textContent = q ? `Buscando “${q}”…` : "Carregando destaques…"; gifResults.innerHTML = "";
  try {
    const r = await fetch(`/api/gifs${q ? `?q=${encodeURIComponent(q)}` : ""}`); const d = await r.json();
    if (!r.ok || !d.ok) { gifStatus.textContent = d.error || "Não foi possível carregar os GIFs."; return; }
    gifStatus.textContent = d.results?.length ? "" : "Nenhum GIF encontrado."; (d.results || []).forEach(renderGifResult);
  } catch { gifStatus.textContent = "Falha de conexão com a biblioteca de GIFs."; }
}
function renderGifResult(item) {
  const b = document.createElement("button"); b.className = "gif-card"; b.title = "Enviar GIF";
  const img = document.createElement("img"); img.src = item.preview || item.url; img.alt = item.title || "GIF"; img.loading = "lazy"; img.referrerPolicy = "no-referrer";
  const meta = document.createElement("span"); meta.textContent = "GIF"; b.append(img, meta);
  b.onclick = () => { if (sendMedia(item.url, "gif", item.title || "GIF", "", "giphy")) { gifModal.classList.add("hidden"); toast("GIF enviado"); } };
  gifResults.appendChild(b);
}
async function handleImageFile() {
  const file = imageInput.files?.[0]; imageInput.value = ""; if (!file) return;
  if (!file.type.startsWith("image/")) return toast("Escolha uma imagem.", true);
  if (file.size > 8 * 1024 * 1024) return toast("A imagem é muito grande.", true);
  try {
    const dataUrl = await compressImage(file);
    if (dataUrl.length > 500000) return toast("Não consegui reduzir essa imagem o suficiente.", true);
    if (sendMedia(dataUrl, "image", file.name)) toast("Imagem enviada");
  } catch { toast("Não foi possível processar a imagem.", true); }
}
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); const max = 1280, scale = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.width * scale)); c.height = Math.max(1, Math.round(img.height * scale)); const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, c.width, c.height); resolve(c.toDataURL("image/webp", .78)); };
    img.onerror = reject; img.src = url;
  });
}
function resizeMessage() { messageInput.style.height = "auto"; messageInput.style.height = `${Math.min(messageInput.scrollHeight, 130)}px`; }
function openMusic() { ensureAudio(); musicModal.classList.remove("hidden"); musicSearch.value = ""; musicResults.innerHTML = ""; musicStatus.textContent = ""; setTimeout(() => musicSearch.focus(), 20); }
async function searchMusic() {
  const q = musicSearch.value.trim(); if (!q) return; musicStatus.textContent = "Buscando…"; musicResults.innerHTML = "";
  try { const r = await fetch(`/api/music?q=${encodeURIComponent(q)}`); const d = await r.json(); if (!r.ok || !d.ok) { musicStatus.textContent = d.error || "Não foi possível buscar."; return; } musicStatus.textContent = d.results.length ? `${d.results.length} resultados` : "Nenhum resultado."; d.results.forEach(addSearchResult); }
  catch { musicStatus.textContent = "Falha de rede."; }
}
async function searchAndQueue(q) {
  if (!q) return false;
  try { const r = await fetch(`/api/music?q=${encodeURIComponent(q)}`); const d = await r.json().catch(() => ({})); if (!r.ok || !d.ok || !d.results?.length) { toast("Não encontrei essa música.", true); return false; } return queueTrack(d.results[0]); }
  catch { toast("Falha ao buscar a música.", true); return false; }
}
function addSearchResult(item) {
  const row = document.createElement("button"); row.className = "music-result";
  const img = document.createElement("img"); img.src = item.thumbnail; img.alt = "";
  const info = document.createElement("div"); const b = document.createElement("strong"); b.textContent = item.title; const s = document.createElement("span"); s.textContent = item.channel; info.append(b, s);
  const add = document.createElement("span"); add.className = "result-add"; add.innerHTML = icon("plus", 15); row.append(img, info, add);
  row.onclick = () => { if (queueTrack(item)) musicModal.classList.add("hidden"); }; musicResults.appendChild(row);
}
function queueTrack(item) { const ok = sendWS({ type: "fila_adicionar", id: item.id, title: item.title, channel: item.channel, thumbnail: item.thumbnail }); if (ok) toast("Música adicionada à fila"); return ok; }
function openQueue() { renderQueue(); queueModal.classList.remove("hidden"); }
function renderQueue() {
  queueList.innerHTML = "";
  if (!queue.length) { queueList.innerHTML = '<div class="queue-empty">A fila está vazia.</div>'; return; }
  queue.forEach((m, i) => { const row = document.createElement("div"); row.className = "queue-row"; const n = document.createElement("b"); n.textContent = String(i + 1).padStart(2, "0"); const img = document.createElement("img"); img.src = m.thumbnail || ""; img.alt = ""; const info = document.createElement("div"); const title = document.createElement("strong"); title.textContent = m.title; const channel = document.createElement("span"); channel.textContent = m.channel || ""; info.append(title, channel); row.append(n, img, info); queueList.appendChild(row); });
}
function updateMiniQueue() {
  queueCount.textContent = queue.length; miniQueue.innerHTML = "";
  if (!queue.length) { miniQueue.innerHTML = '<div class="queue-empty">Nada aguardando</div>'; return; }
  queue.slice(0, 3).forEach(m => { const d = document.createElement("div"); d.className = "mini-item"; const img = document.createElement("img"); img.src = m.thumbnail || ""; img.alt = ""; const info = document.createElement("div"); info.className = "mini-info"; const b = document.createElement("strong"); b.textContent = m.title; const s = document.createElement("span"); s.textContent = m.channel || ""; info.append(b, s); d.append(img, info); miniQueue.appendChild(d); });
}
function updateRadio() { applyRadioState(currentTrack, queue, true); }
function applyRadioState(track, newQueue, initial = false) {
  queue = Array.isArray(newQueue) ? newQueue : []; updateMiniQueue();
  const old = currentTrack;
  const oldId = old?.id || null;
  currentTrack = track || null;
  if (!track) {
    trackTitle.textContent = "Nenhuma música"; trackChannel.textContent = "Adicione uma faixa para começar"; cover.innerHTML = '<div class="cover-letter">S</div><div class="cover-shine"></div>';
    playPause.disabled = true; nextTrack.disabled = true; progressBar.style.width = "0%"; timeCurrent.textContent = "0:00"; timeTotal.textContent = "0:00"; syncLabel.textContent = "—";
    if (ytReady && yt?.stopVideo) try { yt.stopVideo(); } catch {} loadedVideoId = null; lastMusicId = null; return;
  }
  trackTitle.textContent = track.title; trackChannel.textContent = track.channel || "YouTube"; playPause.disabled = false; nextTrack.disabled = false; playIcon.innerHTML = icon(track.paused ? "play" : "pause", 18);
  cover.innerHTML = ""; if (track.thumbnail) { const img = document.createElement("img"); img.src = track.thumbnail; img.alt = ""; cover.append(img); } else cover.innerHTML = '<div class="cover-letter">S</div><div class="cover-shine"></div>';
  const changed = oldId !== track.id;
  const pauseChanged = old && old.id === track.id && old.paused !== track.paused;
  if (changed || initial) loadTrack(track);
  else if (pauseChanged) applySameTrackState(track, true);
  else syncLabel.textContent = track.paused ? "pausado" : "ao vivo";
}
function targetPosition(track) {
  if (track.paused) return Math.max(0, Number(track.position || 0));
  return Math.max(0, (Date.now() - Number(track.startedAt || Date.now())) / 1000);
}
function loadTrack(track) {
  if (!ytReady || !yt) { window.pendingTrack = track; return; }
  const start = targetPosition(track);
  loadedVideoId = track.id;
  try { yt.loadVideoById({ videoId: track.id, startSeconds: start }); } catch { return; }
  setTimeout(() => {
    if (currentTrack?.id !== track.id) return;
    try {
      yt.seekTo(targetPosition(track), true);
      if (track.paused) yt.pauseVideo(); else { applyVolume(); yt.playVideo(); }
      syncLabel.textContent = track.paused ? "pausado" : "ao vivo";
    } catch {}
  }, 350);
}
function applySameTrackState(track, transition = false) {
  if (!ytReady || !yt || loadedVideoId !== track.id) return;
  const target = targetPosition(track);
  try {
    const now = Number(yt.getCurrentTime?.() || 0);
    if (track.paused) { yt.pauseVideo(); if (Math.abs(now - target) > 1.0) yt.seekTo(target, true); }
    else { if (transition || Math.abs(now - target) > 4.5) yt.seekTo(target, true); applyVolume(); yt.playVideo(); }
    playIcon.innerHTML = icon(track.paused ? "play" : "pause", 18); syncLabel.textContent = track.paused ? "pausado" : "ao vivo";
  } catch {}
}
function togglePlayback() {
  if (!currentTrack || !authenticated) return;
  ensureAudio();
  if (currentTrack.paused) { if (sendWS({ type: "continuar_musica" })) syncLabel.textContent = "retomando…"; }
  else {
    let pos = targetPosition(currentTrack); try { if (yt && loadedVideoId === currentTrack.id) pos = yt.getCurrentTime(); yt?.pauseVideo?.(); } catch {}
    if (sendWS({ type: "pausar_musica", position: pos })) { currentTrack = { ...currentTrack, position: pos, paused: true }; playIcon.innerHTML = icon("play", 18); syncLabel.textContent = "pausado"; }
  }
}
function onYTReady() { ytReady = true; yt = window.__salaPlayer; applyVolume(); if (window.pendingTrack) { const p = window.pendingTrack; window.pendingTrack = null; loadTrack(p); } }
window.onYouTubeIframeAPIReady = function () {
  if (yt) return;
  window.__salaPlayer = new YT.Player("youtube-player", { height: "1", width: "1", playerVars: { autoplay: 1, playsinline: 1, controls: 0, rel: 0, modestbranding: 1 }, events: {
    onReady: onYTReady,
    onStateChange: e => {
      if (e.data === YT.PlayerState.ENDED && currentTrack && !currentTrack.paused) sendWS({ type: "proxima_musica", videoId: currentTrack.id });
      if (e.data === YT.PlayerState.PLAYING && currentTrack && !currentTrack.paused) { syncLabel.textContent = "ao vivo"; if (!audioOn) sound.classList.remove("hidden"); }
    }
  } });
};
if (window.YT?.Player && !yt) window.onYouTubeIframeAPIReady();
function updateProgress() {
  if (!currentTrack || !ytReady || loadedVideoId !== currentTrack.id) return;
  try { const cur = Number(yt.getCurrentTime?.() || 0), dur = Number(yt.getDuration?.() || 0); if (dur) { progressBar.style.width = `${Math.min(100, cur / dur * 100)}%`; timeTotal.textContent = fmt(dur); } timeCurrent.textContent = fmt(cur); } catch {}
}
function fmt(sec) { sec = Math.max(0, Math.floor(sec || 0)); const m = Math.floor(sec / 60), s = String(sec % 60).padStart(2, "0"); return `${m}:${s}`; }
setInterval(updateProgress, 500);
function buildAccentPicker() { accentPicker.innerHTML = ""; accents.forEach((color, i) => { const b = document.createElement("button"); b.className = "accent"; b.style.background = color; b.classList.toggle("selected", selectedAccent === color); b.setAttribute("aria-label", `Cor ${i + 1}`); b.onclick = () => { selectedAccent = color; [...accentPicker.children].forEach((x, j) => x.classList.toggle("selected", j === i)); }; accentPicker.appendChild(b); }); }
async function createRoom() {
  const nome = roomName.value.trim(), senha = roomPrivate.checked ? roomPass.value : "";
  if (nome.length < 2) return roomError.textContent = "Dê um nome para a sala.";
  if (roomPrivate.checked && senha.length < 4) return roomError.textContent = "A senha precisa ter pelo menos 4 caracteres.";
  roomError.textContent = "Criando…";
  const names = ["violet", "blue", "pink", "green", "amber", "cyan"]; const accentName = names[accents.indexOf(selectedAccent)] || "violet";
  const { r, data } = await api("/api/rooms", { method: "POST", body: JSON.stringify({ nome, senha, accent: accentName }) });
  if (!r.ok || !data.ok) { roomError.textContent = data.error || "Não foi possível criar."; return; }
  roomModal.classList.add("hidden"); await loadRooms(); selectRoom(data.room.nome); toast(`Sala #${data.room.nome} criada`);
}
async function loadAdmin() {
  const { r, data } = await api("/api/admin/rooms"); if (!r.ok || !data.ok) { toast(data.error || "Acesso negado", true); return; }
  adminRooms.innerHTML = "";
  for (const room of data.rooms || []) {
    const row = document.createElement("div"); row.className = "admin-room";
    const info = document.createElement("div"); info.className = "admin-room-info";
    const b = document.createElement("strong"); b.textContent = `#${room.nome}`;
    const s = document.createElement("span"); s.textContent = room.protegida ? "Sala privada" : "Sala pública"; info.append(b, s);
    const clear = document.createElement("button"); clear.innerHTML = `${icon("trash", 13)} Limpar`; clear.onclick = async () => { if (!confirm(`Limpar o chat de #${room.nome}?`)) return; const x = await api(`/api/admin/rooms/${encodeURIComponent(room.nome)}/clear`, { method: "POST" }); if (x.r.ok) { toast("Conversa limpa"); loadAdmin(); } else toast(x.data.error || "Não foi possível limpar", true); };
    row.append(info, clear);
    if (room.nome !== "geral") { const del = document.createElement("button"); del.className = "delete"; del.innerHTML = `${icon("close", 13)} Excluir`; del.onclick = async () => { if (!confirm(`Excluir a sala #${room.nome}?`)) return; const x = await api(`/api/admin/rooms/${encodeURIComponent(room.nome)}`, { method: "DELETE" }); if (x.r.ok) { if (currentRoom === room.nome) { currentRoom = "geral"; localStorage.setItem("ss-room", "geral"); connectRoom("geral"); } await loadRooms(); loadAdmin(); toast("Sala excluída"); } else toast(x.data.error || "Não foi possível excluir", true); }; row.append(del); }
    adminRooms.appendChild(row);
  }
}
async function adminClearAll() {
  if (!confirm("Limpar as conversas de TODAS as salas?")) return;
  const { r, data } = await api("/api/admin/rooms/clear-all", { method: "POST" });
  if (r.ok && data.ok) { toast("Todos os chats foram limpos"); adminModal.classList.add("hidden"); } else toast(data.error || "Não foi possível limpar.", true);
}

boot();
