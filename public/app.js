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
let audioUnlocked = false;
let audioCtx = null;
let musicVolume = 80;
let volumeSlider = null;
let volumeValue = null;
let volumeMuteButton = null;
let selectedAccent = accents[0];
let authRegister = false;
let roomPoll = null;
let soundEnabled = true;
let lastIncomingMessageId = null;
let lastMusicId = null;
let roomMessages = [];
let radioOn = false;
let selectedImageData = null;
let selectedImageName = "";
let gifSearchTimer = null;

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
const chatScrollBottom = $("chat-scroll-bottom");
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
const queueCount = $("queue-count");
const miniQueue = $("mini-queue");
const syncLabel = $("sync-label");
const composer = $("composer");
const composerBox = $("composer-box");
const imageInput = $("image-input");
const imageButton = $("image-button");
const gifButton = $("gif-button");
const mediaPreview = $("media-preview");
const gifModal = $("gif-modal");
const gifSearch = $("gif-search");
const gifSearchButton = $("gif-search-btn");
const gifGrid = $("gif-grid");
const gifStatus = $("gif-status");
const gifCategories = $("gif-categories");
const radioRecommend = $("radio-recommend");
const playlistAutoUpdate = $("playlist-auto-update");
const recapModal = $("recap-modal");
const recapContent = $("recap-content");

const iconPaths = {
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
  volume: '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  volumeLow: '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 10a3 3 0 0 1 0 4"/>',
  volumeOff: '<path d="M11 5 6 9H3v6h3l5 4V5ZM16 9l5 6M21 9l-5 6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  trash: '<path d="M4 7h16M10 11v5M14 11v5M6 7l1 13h10l1-13M9 7l1-3h4l1 3"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/>',
  spark: '<path d="m12 3-1.2 5.8L5 10l5.8 1.2L12 17l1.2-5.8L19 10l-5.8-1.2L12 3Z"/>',
  chart: '<path d="M4 19V5M4 19h16"/><path d="m7 15 3-4 3 2 5-7"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
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
function loadPrefs() { try { const p = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); soundEnabled = p.sound !== false; } catch {} }
function savePrefs() { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ sound: soundEnabled })); updateSoundButton(); }

function getVolumeStorageKey() {
  return `salaSonoraVolume:${user?.id || "guest"}`;
}

function loadMusicVolume() {
  const saved = Number(localStorage.getItem(getVolumeStorageKey()));
  musicVolume = Number.isFinite(saved) ? Math.max(0, Math.min(100, saved)) : 80;
}

function saveMusicVolume() {
  localStorage.setItem(getVolumeStorageKey(), String(musicVolume));
}

function applyMusicVolume() {
  const v = Math.max(0, Math.min(100, Number(musicVolume) || 0));
  musicVolume = v;
  try {
    if (yt && ytReady) {
      if (v === 0) yt.mute();
      else {
        yt.unMute();
        yt.setVolume(v);
      }
    }
  } catch {}
  updateVolumeUI();
}

function updateVolumeUI() {
  if (!volumeSlider) return;
  volumeSlider.value = String(musicVolume);
  if (volumeValue) volumeValue.textContent = `${musicVolume}%`;
  if (volumeMuteButton) {
    volumeMuteButton.innerHTML = icon(musicVolume === 0 ? "volumeOff" : musicVolume < 45 ? "volumeLow" : "volume", 17);
    volumeMuteButton.title = musicVolume === 0 ? "Ativar áudio" : "Silenciar música";
    volumeMuteButton.setAttribute("aria-label", volumeMuteButton.title);
  }
}

function buildVolumeMixer() {
  if ($("music-volume-mixer")) return;

  const anchor = sound?.parentElement || playPause?.parentElement;
  if (!anchor) return;

  const wrap = document.createElement("div");
  wrap.id = "music-volume-mixer";
  wrap.className = "music-volume-mixer";
  wrap.setAttribute("aria-label", "Volume da música");

  volumeMuteButton = document.createElement("button");
  volumeMuteButton.type = "button";
  volumeMuteButton.className = "music-volume-mute";
  volumeMuteButton.onclick = () => {
    if (musicVolume > 0) {
      volumeMuteButton.dataset.previousVolume = String(musicVolume);
      musicVolume = 0;
    } else {
      const previous = Number(volumeMuteButton.dataset.previousVolume || 80);
      musicVolume = previous > 0 ? previous : 80;
    }
    saveMusicVolume();
    applyMusicVolume();
    ensureAudio();
    if (musicVolume > 0) enableMusicAudio();
  };

  volumeSlider = document.createElement("input");
  volumeSlider.type = "range";
  volumeSlider.min = "0";
  volumeSlider.max = "100";
  volumeSlider.step = "1";
  volumeSlider.className = "music-volume-slider";
  volumeSlider.setAttribute("aria-label", "Volume da música");
  volumeSlider.oninput = () => {
    musicVolume = Number(volumeSlider.value);
    saveMusicVolume();
    applyMusicVolume();
    if (musicVolume > 0) {
      ensureAudio();
      enableMusicAudio();
    }
  };

  volumeValue = document.createElement("span");
  volumeValue.className = "music-volume-value";

  wrap.append(volumeMuteButton, volumeSlider, volumeValue);

  // O mixer fica entre os controles do player e o botão de sons.
  // Isso evita que ele herde o estilo do botão de notificações.
  if (sound?.parentElement === anchor) anchor.insertBefore(wrap, sound);
  else anchor.appendChild(wrap);

  updateVolumeUI();
}

function ensureAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  } catch {}
}
function enableMusicAudio() {
  audioOn = true;
  ensureAudio();
  applyMusicVolume();
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
    token = data.token; user = data.user; saveSession(); loadMusicVolume(); updateVolumeUI(); ensureAudio(); await openApp();
  } catch { authError.textContent = "Falha de conexão."; }
  finally { authSubmit.disabled = false; }
}

async function boot() {
  loadPrefs();
  loadMusicVolume();
  buildAccentPicker();
  $("settings-icon").innerHTML = icon("settings", 14);
  $("queue-icon").innerHTML = icon("queue", 13);
  updateSoundButton();
  buildVolumeMixer();
  updateVolumeUI();
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
  $("open-music").onclick = openMusic;
  $("open-search-top").onclick = openMusic;
  $("music-close").onclick = () => musicModal.classList.add("hidden");
  $("music-search-btn").onclick = searchMusic;
  musicSearch.onkeydown = e => { if (e.key === "Enter") searchMusic(); };
  $("open-queue").onclick = openQueue; $("open-queue-2").onclick = openQueue; $("queue-close").onclick = () => queueModal.classList.add("hidden");
  updateRadioButton(); bindMediaInputs(); imageButton.innerHTML = icon("image", 17); updateChatScrollButton(); $("open-recap").innerHTML = `${icon("chart", 12)}<span>Recap</span>`;
  radioRecommend.onclick = () => { radioOn = !radioOn; updateRadioButton(); if (sendWS({ type: "radio_toggle", enabled: radioOn })) toast(radioOn ? "Recomendações automáticas ativadas" : "Recomendações automáticas desativadas"); };
  $("gif-button").onclick = () => openGifs(); $("gif-close").onclick = () => gifModal.classList.add("hidden"); gifSearchButton.onclick = () => searchGifs(gifSearch.value.trim()); gifSearch.onkeydown = e => { if (e.key === "Enter") searchGifs(gifSearch.value.trim()); };
  gifSearch.oninput = () => { clearTimeout(gifSearchTimer); gifSearchTimer = setTimeout(() => searchGifs(gifSearch.value.trim()), 350); };
  gifCategories.querySelectorAll(".gif-cat").forEach(b => b.onclick = () => { gifCategories.querySelectorAll(".gif-cat").forEach(x => x.classList.remove("active")); b.classList.add("active"); openGifs(b.dataset.q || ""); });
  $("open-recap").onclick = openRecap; $("recap-close").onclick = () => recapModal.classList.add("hidden");
  $("admin-open").onclick = () => { adminModal.classList.remove("hidden"); loadAdmin(); };
  $("admin-close").onclick = () => adminModal.classList.add("hidden");
  $("admin-clear-all").onclick = adminClearAll;
  $("settings-open").onclick = openSettings; $("settings-close").onclick = () => settingsModal.classList.add("hidden"); $("settings-save").onclick = saveSettings;
  $("send").onclick = sendMessage;
  messageInput.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
  messageInput.oninput = resizeMessage;
  messages.addEventListener("scroll", updateChatScrollButton, { passive: true });
  chatScrollBottom.onclick = () => scrollBottom(true);
  clearRoom.onclick = () => sendWS({ type: "limpar_mensagens" });
  playPause.onclick = togglePlayback;
  nextTrack.onclick = () => { if (currentTrack) sendWS({ type: "proxima_musica", videoId: currentTrack.id }); };
  sound.onclick = () => { soundEnabled = !soundEnabled; savePrefs(); if (soundEnabled) { ensureAudio(); ping("message"); } };
  $("mobile-menu").onclick = () => document.body.classList.toggle("sidebar-open");
  document.addEventListener("pointerdown", () => {
    ensureAudio();
    enableMusicAudio();
    unlockYouTubeAudio();
  }, { passive: true });
  document.addEventListener("keydown", () => {
    ensureAudio();
    enableMusicAudio();
    unlockYouTubeAudio();
  }, { passive: true });
  document.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openMusic(); } });
  if (loadSession()) {
    const { r, data } = await api("/api/auth/me");
    if (r.ok && data.ok) { user = data.user; saveSession(); loadMusicVolume(); updateVolumeUI(); await openApp(); }
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
  authenticated = false; messages.innerHTML = ""; updateChatScrollButton(); currentTrack = null; queue = []; loadedVideoId = null; updateRadio();
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
    authenticated = true; radioOn = Boolean(d.radioOn); updateRadioButton(); passwordModal.classList.add("hidden");
    const room = rooms.find(x => x.nome === currentRoom);
    currentRoomEl.textContent = currentRoom; roomBadge.textContent = initials(currentRoom).slice(0, 1); roomBadge.style.color = roomColor(room);
    clearRoom.classList.toggle("hidden", d.ownerId !== user.id && user.role !== "admin");
    roomMessages = Array.isArray(d.mensagens) ? d.mensagens.slice() : [];
    messages.innerHTML = ""; roomMessages.forEach(renderMessage);
    queue = d.fila || []; applyRadioState(d.tocandoAgora, d.fila, true); if (Array.isArray(d.playlistsAuto) && d.playlistsAuto.length) toast(`Playlist automática ativa: ${d.playlistsAuto[0].playlistTitle || "playlist"}`); scrollBottom(true);
    syncLabel.textContent = d.tocandoAgora?.paused ? "pausado" : (d.tocandoAgora ? "ao vivo" : "—");
    return;
  }
  if (d.type === "mensagem") {
    const shouldStickToBottom = isMessagesNearBottom();
    if (d.mensagem && !roomMessages.some(x => x.id === d.mensagem.id)) roomMessages.push(d.mensagem);
    renderMessage(d.mensagem);
    if (shouldStickToBottom) scrollBottom(true);
    else updateChatScrollButton();
    if (d.mensagem?.autorId !== user.id && d.mensagem?.id !== lastIncomingMessageId) { lastIncomingMessageId = d.mensagem.id; ping("message"); }
    return;
  }
  if (d.type === "mensagens_limpas") { roomMessages = []; messages.innerHTML = ""; systemMessage("O histórico desta sala foi limpo."); return; }
  if (d.type === "reacao") { updateReaction(d.messageId, d.emoji, d.total); const m = roomMessages.find(x => x.id === d.messageId); if (m) { m.reacoes ||= {}; m.reacoes[d.emoji] = d.total; } return; }
  if (d.type === "presenca") { presence.textContent = `${d.total} ${d.total === 1 ? "pessoa" : "pessoas"} na sala`; return; }
  if (d.type === "radio_estado") { radioOn = Boolean(d.radioOn); updateRadioButton(); queue = Array.isArray(d.fila) ? d.fila : queue; updateMiniQueue(); return; }
  if (d.type === "playlist_atualizada") { queue = queue; updateMiniQueue(); if (Array.isArray(d.playlists) && d.playlists.length) toast(`Playlist atualizada · ${d.playlists[0].playlistTitle || "novas faixas"}`); return; }
  if (d.type === "tocando_agora") {
    const nextId = d.tocandoAgora?.id || null; const wasMusic = lastMusicId;
    applyRadioState(d.tocandoAgora, d.fila, false);
    if (nextId && nextId !== wasMusic) ping("music");
    lastMusicId = nextId; return;
  }
  if (d.type === "sala_excluida") { toast("Esta sala foi removida.", true); currentRoom = "geral"; localStorage.setItem("ss-room", "geral"); loadRooms().then(() => connectRoom("geral")); return; }
  if (d.type === "erro") {
    if (d.code === "SENHA_INCORRETA") { passwordError.textContent = d.message; passwordModal.classList.remove("hidden"); }
    else toast(d.message || "Algo deu errado.", true);
  }
}
function updateRadioButton() {
  if (!radioRecommend) return;
  radioRecommend.classList.toggle("active", radioOn);
  radioRecommend.innerHTML = `${icon("spark", 12)}<span>${radioOn ? "Recomendações ON" : "Recomendações"}</span>`;
  radioRecommend.title = radioOn ? "Recomendações automáticas ativadas" : "Ativar recomendações automáticas";
}
function sendRoomPassword(pass) { if (!pass) return passwordError.textContent = "Digite a senha."; hashLocal(pass).then(h => sendWS({ type: "entrar", senhaHash: h })); }

function renderMessage(m) {
  if (!m) return;
  const old = messages.querySelector(`[data-id="${CSS.escape(m.id || "")}"]`); if (old) return;
  const row = document.createElement("article"); row.className = `message-row${m.autorId === user.id ? " mine" : ""}`; row.dataset.id = m.id || crypto.randomUUID();
  const av = document.createElement("div"); av.className = "message-avatar"; av.textContent = initials(m.nome);
  const c = document.createElement("div"); c.className = "message-content";
  const head = document.createElement("div"); head.className = "message-head";
  const name = document.createElement("span"); name.className = "message-name"; name.textContent = m.autorId === user.id ? "Você" : m.nome;
  const time = document.createElement("span"); time.className = "message-time"; time.textContent = new Date(m.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  head.append(name, time); c.append(head);

  if (m.tipo === "musica" && m.music) {
    const card = document.createElement("div"); card.className = "music-message-card";
    if (m.music.thumbnail) { const img = document.createElement("img"); img.src = m.music.thumbnail; img.alt = ""; card.append(img); }
    const info = document.createElement("div"); const title = document.createElement("strong"); title.textContent = m.music.title || "Música";
    const ch = document.createElement("span"); ch.textContent = `${m.music.channel || "YouTube"} · ${m.music.recommendation ? "recomendação automática" : "adicionada à rádio"}`;
    const tag = document.createElement("em"); tag.textContent = "🎵 tocando na sala"; info.append(title, ch, tag); card.append(info); c.append(card);
  } else {
    if (m.text) { const bubble = document.createElement("div"); bubble.className = "bubble"; bubble.textContent = m.text; c.append(bubble); }
    if (m.mediaType && m.url) {
      const media = document.createElement("img"); media.className = "message-media"; media.src = m.url; media.alt = m.alt || "Mídia enviada"; media.loading = "lazy"; media.onclick = () => window.open(m.url, "_blank", "noopener"); c.append(media);
    }
  }
  const reactions = document.createElement("div"); reactions.className = "reactions";
  for (const emoji of ["👍", "❤️", "😂", "🔥"]) { const b = document.createElement("button"); b.className = "reaction"; b.textContent = m.reacoes?.[emoji] ? `${emoji} ${m.reacoes[emoji]}` : emoji; b.title = `Reagir com ${emoji}`; b.onclick = () => { ensureAudio(); sendWS({ type: "reacao", messageId: m.id, emoji }); }; reactions.appendChild(b); }
  c.append(reactions); row.append(av, c); messages.appendChild(row);
}
function updateReaction(id, emoji, total) {
  const row = messages.querySelector(`[data-id="${CSS.escape(id)}"]`); if (!row) return;
  const button = [...row.querySelectorAll(".reaction")].find(x => x.textContent.startsWith(emoji));
  if (button) button.textContent = total ? `${emoji} ${total}` : emoji;
}
function isMessagesNearBottom(threshold = 80) {
  if (!messages) return true;
  return messages.scrollHeight - messages.scrollTop - messages.clientHeight <= threshold;
}
function updateChatScrollButton() {
  if (!chatScrollBottom) return;
  chatScrollBottom.classList.toggle("hidden", isMessagesNearBottom());
}
function scrollBottom(force = false) {
  requestAnimationFrame(() => {
    if (!force && !isMessagesNearBottom()) { updateChatScrollButton(); return; }
    messages.scrollTop = messages.scrollHeight;
    updateChatScrollButton();
  });
}
function systemMessage(t) { const d = document.createElement("div"); d.className = "system-message"; d.textContent = t; messages.appendChild(d); scrollBottom(true); }
function sendMessage() {
  const text = messageInput.value.trim();
  if (!authenticated) { toast("A sala ainda está conectando.", true); return; }
  if (selectedImageData) {
    if (sendWS({ type: "media", mediaType: "image", url: selectedImageData, alt: selectedImageName || "Imagem" })) { clearSelectedImage(); messageInput.value = ""; resizeMessage(); }
    return;
  }
  if (!text) return;
  if (text.toLowerCase().startsWith("!play ")) { if (searchAndQueue(text.slice(6).trim())) { messageInput.value = ""; resizeMessage(); } return; }
  if (sendWS({ type: "mensagem", text })) { messageInput.value = ""; resizeMessage(); }
}
function resizeMessage() { messageInput.style.height = "auto"; messageInput.style.height = `${Math.min(messageInput.scrollHeight, 130)}px`; }
function clearSelectedImage() { selectedImageData = null; selectedImageName = ""; imageInput.value = ""; mediaPreview.classList.add("hidden"); mediaPreview.innerHTML = ""; }
function showImagePreview(data, name) {
  selectedImageData = data; selectedImageName = name || "Imagem"; mediaPreview.innerHTML = ""; const img = document.createElement("img"); img.src = data; img.alt = "Prévia"; const close = document.createElement("button"); close.type = "button"; close.textContent = "×"; close.title = "Remover imagem"; close.onclick = clearSelectedImage; mediaPreview.append(img, close); mediaPreview.classList.remove("hidden");
}
function prepareImage(file) {
  if (!file || !file.type.startsWith("image/")) return toast("Selecione uma imagem válida.", true);
  if (file.size > 7 * 1024 * 1024) return toast("A imagem é muito grande.", true);
  const reader = new FileReader(); reader.onload = e => {
    const src = e.target.result;
    if (file.type === "image/gif" && file.size <= 500000) return showImagePreview(src, file.name);
    const img = new Image(); img.onload = () => {
      const max = 1100; let w = img.width, h = img.height; if (w > max || h > max) { const scale = Math.min(max / w, max / h); w = Math.round(w * scale); h = Math.round(h * scale); }
      const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h; const ctx = canvas.getContext("2d"); ctx.drawImage(img, 0, 0, w, h);
      let out = canvas.toDataURL("image/webp", .82); if (out.length > 500000) out = canvas.toDataURL("image/jpeg", .72);
      if (out.length > 510000) return toast("Essa imagem ainda ficou grande demais. Tente uma imagem menor.", true);
      showImagePreview(out, file.name);
    }; img.onerror = () => toast("Não consegui ler essa imagem.", true); img.src = src;
  }; reader.readAsDataURL(file);
}
function bindMediaInputs() {
  imageButton.onclick = () => imageInput.click(); imageInput.onchange = () => { if (imageInput.files?.[0]) prepareImage(imageInput.files[0]); };
  ["dragenter","dragover"].forEach(type => composer.addEventListener(type, e => { e.preventDefault(); e.stopPropagation(); composer.classList.add("drag-active"); }));
  ["dragleave","drop"].forEach(type => composer.addEventListener(type, e => { e.preventDefault(); e.stopPropagation(); if (type === "drop") { composer.classList.remove("drag-active"); const f = e.dataTransfer?.files?.[0]; if (f) prepareImage(f); } else if (!composer.contains(e.relatedTarget)) composer.classList.remove("drag-active"); }));
  messageInput.addEventListener("paste", e => { const items = [...(e.clipboardData?.items || [])]; const item = items.find(x => x.kind === "file" && x.type.startsWith("image/")); if (item) { e.preventDefault(); const f = item.getAsFile(); if (f) prepareImage(f); } });
}
async function searchGifs(q = "") {
  gifStatus.textContent = "Buscando GIFs…"; gifGrid.innerHTML = "";
  try { const r = await fetch(`/api/gifs?q=${encodeURIComponent(q)}`); const d = await r.json().catch(() => ({})); if (!r.ok || !d.ok) { gifStatus.textContent = d.error || "Não foi possível carregar os GIFs."; return; } gifStatus.textContent = d.results?.length ? `${d.results.length} GIFs` : "Nenhum GIF encontrado.";
    (d.results || []).forEach(item => { const img = document.createElement("img"); img.className = "gif-item"; img.src = item.preview || item.url; img.alt = item.title || "GIF"; img.loading = "lazy"; img.onclick = () => { if (sendWS({ type: "media", mediaType: "gif", url: item.url, alt: item.title || "GIF", source: "giphy" })) { gifModal.classList.add("hidden"); toast("GIF enviado"); } }; gifGrid.appendChild(img); });
  } catch { gifStatus.textContent = "Falha de rede."; }
}
function openGifs(query = "") { gifModal.classList.remove("hidden"); gifSearch.value = query; searchGifs(query); setTimeout(() => gifSearch.focus(), 20); }
function openRecap() {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000; const music = roomMessages.filter(m => m.tipo === "musica" && Number(m.ts) >= since && m.music);
  recapContent.innerHTML = ""; if (!music.length) { recapContent.innerHTML = '<div class="recap-empty">Ainda não há músicas suficientes no histórico dos últimos 7 dias.</div>'; recapModal.classList.remove("hidden"); return; }
  const users = {}; const tracks = {}; music.forEach(m => { const u = m.nome || "Alguém"; users[u] = (users[u] || 0) + 1; const key = m.music.id || m.music.title; tracks[key] ||= { title: m.music.title, channel: m.music.channel, count: 0 }; tracks[key].count++; });
  const topUser = Object.entries(users).sort((a,b)=>b[1]-a[1])[0]; const topTrack = Object.values(tracks).sort((a,b)=>b.count-a.count)[0];
  recapContent.innerHTML = `<div class="recap-stat"><strong>${music.length}</strong><span>faixas adicionadas</span></div><div class="recap-stat"><strong>${topUser[0]}</strong><span>quem mais colocou música · ${topUser[1]} faixa${topUser[1]===1?'':'s'}</span></div><div class="recap-stat"><strong>${escapeHtml(topTrack.title)}</strong><span>faixa mais repetida · ${topTrack.count} vez${topTrack.count===1?'':'es'}</span></div><div class="recap-list">${Object.values(tracks).sort((a,b)=>b.count-a.count).slice(0,5).map((x,i)=>`<div class="recap-row"><span>${String(i+1).padStart(2,'0')} · ${escapeHtml(x.title)}</span><small>${x.count}x</small></div>`).join('')}</div>`;
  recapModal.classList.remove("hidden");
}
function escapeHtml(text) { const d = document.createElement("div"); d.textContent = text || ""; return d.innerHTML; }
async function fetchJsonSafe(url, options = {}) {
  const r = await fetch(url, options); const raw = await r.text(); let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { ok: false, error: "Resposta inválida do servidor." }; }
  return { r, data };
}
function openMusic() {
  ensureAudio();
  enableMusicAudio();
  musicModal.classList.remove("hidden"); musicSearch.value = ""; musicResults.innerHTML = ""; musicStatus.textContent = ""; setTimeout(() => musicSearch.focus(), 20); }
async function searchMusic() {
  ensureAudio(); enableMusicAudio();
  const q = musicSearch.value.trim(); if (!q) return;
  musicStatus.textContent = "Buscando músicas e playlists…"; musicResults.innerHTML = "";
  try {
    // Se o usuário colar uma URL de playlist do YouTube (ou apenas o ID),
    // carregamos a playlist diretamente, mesmo que ela não apareça na busca pública.
    const playlistMatch = q.match(/[?&]list=([A-Za-z0-9_-]{5,100})/) || q.match(/^[A-Za-z0-9_-]{5,100}$/);
    if (playlistMatch) {
      const playlistId = playlistMatch[1] || playlistMatch[0];
      const { r: pr, data: pd } = await fetchJsonSafe(`/api/playlist?id=${encodeURIComponent(playlistId)}`);
      if (pr.ok && pd.ok && Array.isArray(pd.results) && pd.results.length) {
        addMusicSection("PLAYLIST ENCONTRADA", "playlist");
        addPlaylistResult({ id: playlistId, title: "Playlist do YouTube", channel: "Playlist direta", thumbnail: pd.results[0]?.thumbnail || "", type: "playlist", itemCount: pd.results.length });
        musicStatus.textContent = `${pd.results.length} faixas encontradas na playlist`;
        return;
      }
    }
    const { r, data } = await fetchJsonSafe(`/api/music?q=${encodeURIComponent(q)}`);
    if (!r.ok || !data.ok) { musicStatus.textContent = data.error || "Não foi possível buscar."; return; }
    const videos = Array.isArray(data.videos) ? data.videos : [];
    const playlists = Array.isArray(data.playlists) ? data.playlists : [];
    const total = videos.length + playlists.length;
    musicStatus.textContent = total ? `${total} resultados · ${playlists.length} playlist${playlists.length === 1 ? "" : "s"}` : "Nenhum resultado.";
    if (playlists.length) {
      addMusicSection("PLAYLISTS", "playlist");
      playlists.forEach(addPlaylistResult);
    }
    if (videos.length) {
      addMusicSection("MÚSICAS", "video");
      videos.forEach(addSearchResult);
    }
  } catch { musicStatus.textContent = "Falha de rede."; }
}
async function searchAndQueue(q) {
  if (!q) return false;
  try {
    const { r, data } = await fetchJsonSafe(`/api/music?q=${encodeURIComponent(q)}`);
    const videos = Array.isArray(data.videos) ? data.videos : [];
    if (!r.ok || !data.ok || !videos.length) { toast(data.error || "Não encontrei essa música.", true); return false; }
    return queueTrack(videos[0]);
  } catch { toast("Falha ao buscar a música.", true); return false; }
}
function addMusicSection(label, type) {
  const section = document.createElement("div");
  section.className = `music-section music-section-${type}`;
  const title = document.createElement("div"); title.className = "music-section-title";
  title.innerHTML = `${type === "playlist" ? icon("queue", 13) : icon("music", 13)}<span>${label}</span>`;
  section.appendChild(title); musicResults.appendChild(section);
}
function appendToLastMusicSection(item) {
  const sections = musicResults.querySelectorAll(".music-section");
  const type = item.type === "playlist" ? "playlist" : "video";
  const section = [...sections].find(x => x.classList.contains(`music-section-${type}`));
  return section || musicResults;
}
function addSearchResult(item) {
  const row = document.createElement("button"); row.className = "music-result";
  const img = document.createElement("img"); img.src = item.thumbnail; img.alt = "";
  const info = document.createElement("div"); const b = document.createElement("strong"); b.textContent = item.title; const s = document.createElement("span"); s.textContent = item.channel || "YouTube"; info.append(b, s);
  const add = document.createElement("span"); add.className = "result-add"; add.innerHTML = icon("plus", 15);
  row.append(img, info, add);
  row.onclick = () => { if (queueTrack(item)) musicModal.classList.add("hidden"); };
  appendToLastMusicSection(item).appendChild(row);
}
function addPlaylistResult(item) {
  const row = document.createElement("button"); row.className = "music-result music-playlist-result";
  const img = document.createElement("img"); img.src = item.thumbnail; img.alt = "";
  const info = document.createElement("div");
  const b = document.createElement("strong"); b.textContent = item.title;
  const s = document.createElement("span"); s.textContent = `${item.channel || "YouTube"}${item.itemCount ? ` · ${item.itemCount} faixas` : ""}`;
  const badge = document.createElement("em"); badge.textContent = "PLAYLIST";
  info.append(b, s, badge);
  const add = document.createElement("span"); add.className = "result-add playlist-play-icon"; add.innerHTML = icon("play", 15);
  row.append(img, info, add);
  row.onclick = () => playPlaylist(item);
  appendToLastMusicSection(item).appendChild(row);
}
async function playPlaylist(item) {
  ensureAudio(); enableMusicAudio();
  toast("Carregando playlist…");
  try {
    const { r, data } = await fetchJsonSafe(`/api/playlist?id=${encodeURIComponent(item.id)}`);
    if (!r.ok || !data.ok) { toast(data.error || "Não foi possível carregar a playlist.", true); return; }
    const tracks = (data.results || []).filter(x => x.id && x.title).map(x => ({ id: x.id, title: x.title, channel: x.channel, thumbnail: x.thumbnail }));
    if (!tracks.length) { toast("Essa playlist não tem faixas disponíveis.", true); return; }
    if (sendWS({ type: "playlist_adicionar", playlistId: item.id, playlistTitle: item.title, tracks, autoUpdate: playlistAutoUpdate ? playlistAutoUpdate.checked : true })) {
      musicModal.classList.add("hidden");
      toast(`${tracks.length} faixas adicionadas${playlistAutoUpdate?.checked ? " · atualização automática ligada" : ""}`);
    }
  } catch { toast("Falha ao carregar a playlist.", true); }
}
function queueTrack(item) {
  ensureAudio();
  enableMusicAudio();
  const ok = sendWS({ type: "fila_adicionar", id: item.id, title: item.title, channel: item.channel, thumbnail: item.thumbnail });
  if (ok) toast("Música adicionada à fila");
  return ok;
}
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
    cover.classList.remove("vinyl-mode", "paused", "cover-transition");
    trackTitle.textContent = "Nenhuma música"; trackChannel.textContent = "Adicione uma faixa para começar"; cover.innerHTML = '<div class="cover-letter">S</div><div class="cover-shine"></div>';
    playPause.disabled = true; nextTrack.disabled = true; progressBar.style.width = "0%"; timeCurrent.textContent = "0:00"; timeTotal.textContent = "0:00"; syncLabel.textContent = "—";
    if (ytReady && yt?.stopVideo) try { yt.stopVideo(); } catch {} loadedVideoId = null; lastMusicId = null; return;
  }
  trackTitle.textContent = track.title; trackChannel.textContent = track.channel || "YouTube"; playPause.disabled = false; nextTrack.disabled = false; playIcon.innerHTML = icon(track.paused ? "play" : "pause", 18);
  cover.classList.add("vinyl-mode", "cover-transition"); cover.classList.toggle("paused", Boolean(track.paused));
  cover.innerHTML = ""; if (track.thumbnail) { const img = document.createElement("img"); img.src = track.thumbnail; img.alt = ""; cover.append(img); extractAmbientColor(track.thumbnail); } else cover.innerHTML = '<div class="cover-letter">S</div><div class="cover-shine"></div>';
  setTimeout(() => cover.classList.remove("cover-transition"), 500);
  const changed = oldId !== track.id;
  const pauseChanged = old && old.id === track.id && old.paused !== track.paused;
  if (changed || initial) loadTrack(track);
  else if (pauseChanged) applySameTrackState(track, true);
  else syncLabel.textContent = track.paused ? "pausado" : "ao vivo";
}
async function extractAmbientColor(url) {
  try { const img = new Image(); img.crossOrigin = "anonymous"; img.onload = () => { try { const canvas = document.createElement("canvas"); canvas.width = 24; canvas.height = 24; const ctx = canvas.getContext("2d", { willReadFrequently: true }); ctx.drawImage(img,0,0,24,24); const data = ctx.getImageData(0,0,24,24).data; let r=0,g=0,b=0,n=0; for(let i=0;i<data.length;i+=4){ if(data[i+3]<180) continue; r+=data[i];g+=data[i+1];b+=data[i+2];n++; } if(n){ document.body.style.setProperty("--ambient", `${Math.round(r/n)},${Math.round(g/n)},${Math.round(b/n)}`); } } catch {} }; img.src = url; } catch {}
}
function targetPosition(track) {
  if (track.paused) return Math.max(0, Number(track.position || 0));
  return Math.max(0, (Date.now() - Number(track.startedAt || Date.now())) / 1000);
}
function loadTrack(track) {
  if (!ytReady || !yt) { window.pendingTrack = track; return; }
  ensureAudio();
  const start = targetPosition(track);
  loadedVideoId = track.id;
  try {
    applyMusicVolume();
    yt.loadVideoById({ videoId: track.id, startSeconds: start });
    if (!track.paused) {
      applyMusicVolume();
    }
  } catch { return; }
  setTimeout(() => {
    if (currentTrack?.id !== track.id) return;
    try {
      yt.seekTo(targetPosition(track), true);
      if (track.paused) {
        yt.pauseVideo();
      } else {
        applyMusicVolume();
        yt.playVideo();
      }
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
    else {
      if (transition || Math.abs(now - target) > 4.5) yt.seekTo(target, true);
      applyMusicVolume();
      yt.playVideo();
    }
    playIcon.innerHTML = icon(track.paused ? "play" : "pause", 18); syncLabel.textContent = track.paused ? "pausado" : "ao vivo";
  } catch {}
}
function togglePlayback() {
  if (!currentTrack || !authenticated) return;
  ensureAudio();
  enableMusicAudio();
  if (currentTrack.paused) { if (sendWS({ type: "continuar_musica" })) syncLabel.textContent = "retomando…"; }
  else {
    let pos = targetPosition(currentTrack); try { if (yt && loadedVideoId === currentTrack.id) pos = yt.getCurrentTime(); yt?.pauseVideo?.(); } catch {}
    if (sendWS({ type: "pausar_musica", position: pos })) { currentTrack = { ...currentTrack, position: pos, paused: true }; playIcon.innerHTML = icon("play", 18); syncLabel.textContent = "pausado"; }
  }
}
function unlockYouTubeAudio() {
  audioUnlocked = true;
  ensureAudio();
  try {
    if (!yt || !ytReady) return;
    if (currentTrack && !currentTrack.paused) {
      yt.unMute();
      yt.setVolume(Math.max(0, Math.min(100, Number(musicVolume) || 0)));
      yt.playVideo();
    }
  } catch {}
}
function onYTReady() {
  ytReady = true;
  yt = window.__salaPlayer;
  if (audioOn) {
    try {
      applyMusicVolume();
      if (audioUnlocked && currentTrack && !currentTrack.paused) {
        yt.unMute();
        yt.playVideo();
      }
    } catch {}
  }
  if (window.pendingTrack) {
    const p = window.pendingTrack;
    window.pendingTrack = null;
    loadTrack(p);
  }
}
window.onYouTubeIframeAPIReady = function () {
  if (yt) return;
  window.__salaPlayer = new YT.Player("youtube-player", { height: "1", width: "1", playerVars: { autoplay: 1, playsinline: 1, controls: 0, rel: 0, modestbranding: 1, enablejsapi: 1, origin: location.origin }, events: {
    onReady: onYTReady,
    onError: e => {
      // 101/150 = vídeo não pode ser reproduzido no player incorporado;
      // 2/5 = erro de parâmetro/player. Não confundir isso com a cota da API.
      if (currentTrack && [101, 150].includes(Number(e.data))) {
        syncLabel.textContent = "vídeo indisponível";
        toast("Esta música não pode ser reproduzida incorporada.", true);
      }
    },
    onStateChange: e => {
      if (e.data === YT.PlayerState.ENDED && currentTrack && !currentTrack.paused) sendWS({ type: "proxima_musica", videoId: currentTrack.id });
      if (e.data === YT.PlayerState.PLAYING && currentTrack && !currentTrack.paused) {
        syncLabel.textContent = "ao vivo";
        try { applyMusicVolume(); } catch {}
      }
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