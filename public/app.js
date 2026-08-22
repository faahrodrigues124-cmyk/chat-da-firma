"use strict";

const SESSION_KEY = "salaSonoraSession";
const accents = ["#9b7cff","#5ea7ff","#ff7190","#42d3a0","#f5b45c","#67d6d0"];
let user = { id:"", nome:"", role:"user" }, token="", rooms=[], currentRoom=localStorage.getItem("ss-room")||"geral";
let socket=null, socketGeneration=0, authenticated=false, pendingPasswordRoom=null, roomPoll=null;
let queue=[], currentTrack=null, loadedVideoId=null, yt=null, ytReady=false, audioOn=false, progressTimer=null, applyingServerState=false;
let selectedAccent=accents[0], authRegister=false;

const $=id=>document.getElementById(id);
const auth=$("auth"), app=$("app"), authTitle=$("auth-title"), authSubtitle=$("auth-subtitle"), authUser=$("auth-user"), authPass=$("auth-pass"), authSubmit=$("auth-submit"), authToggle=$("auth-toggle"), authError=$("auth-error");
const roomModal=$("room-modal"), roomName=$("room-name"), roomPrivate=$("room-private"), roomPass=$("room-pass"), roomPassWrap=$("room-pass-wrap"), roomError=$("room-error"), roomsEl=$("rooms"), accentPicker=$("accent-picker");
const passwordModal=$("password-modal"), roomEnterPass=$("room-enter-pass"), passwordError=$("password-error");
const musicModal=$("music-modal"), musicSearch=$("music-search"), musicResults=$("music-results"), musicStatus=$("music-status");
const queueModal=$("queue-modal"), queueList=$("queue-list"), adminModal=$("admin-modal"), adminRooms=$("admin-rooms");
const settingsModal=$("settings-modal"), displayNameInput=$("display-name-input"), siteNameInput=$("site-name-input"), siteSettingsWrap=$("site-settings-wrap"), settingsError=$("settings-error");
const messages=$("messages"), messageInput=$("message-input"), presence=$("presence"), currentRoomEl=$("current-room"), roomBadge=$("room-badge"), clearRoom=$("clear-room");
const trackTitle=$("track-title"), trackChannel=$("track-channel"), cover=$("cover"), progressBar=$("progress-bar"), timeCurrent=$("time-current"), timeTotal=$("time-total"), playPause=$("play-pause"), playIcon=$("play-icon"), nextTrack=$("next-track"), sound=$("sound"), queueCount=$("queue-count"), miniQueue=$("mini-queue"), syncLabel=$("sync-label");

function toast(text,error=false){const d=document.createElement("div");d.className="toast"+(error?" error":"");d.textContent=text;$("toast-stack").appendChild(d);setTimeout(()=>d.remove(),3200)}
function initials(name){return String(name||"?").slice(0,2).toUpperCase()}
function saveSession(){localStorage.setItem(SESSION_KEY,JSON.stringify({token,...user}))}
function loadSession(){try{const s=JSON.parse(localStorage.getItem(SESSION_KEY));if(s?.token&&s?.id&&s?.nome){token=s.token;user={id:s.id,nome:s.nome,role:s.role||"user"};return true}}catch{}return false}
function clearSession(){localStorage.removeItem(SESSION_KEY);token="";user={id:"",nome:"",role:"user"}}
async function api(path,options={}){const h=new Headers(options.headers||{});h.set("content-type","application/json");if(token)h.set("authorization",`Bearer ${token}`);const r=await fetch(path,{...options,headers:h});const raw=await r.text();let data={};try{data=raw?JSON.parse(raw):{}}catch{data={ok:false,error:"Resposta inválida."}}return{r,data}}
function setAuthMode(register){authRegister=register;authTitle.textContent=register?"Criar conta":"Entrar";authSubtitle.textContent=register?"Seu perfil fica salvo neste dispositivo.":"Entre para conversar e ouvir com a sala.";authSubmit.textContent=register?"Criar conta":"Entrar";authToggle.textContent=register?"Já tenho uma conta":"Criar uma conta";authError.textContent=""}
async function authSubmitNow(){const nome=authUser.value.trim(),senha=authPass.value;if(nome.length<3)return authError.textContent="Use pelo menos 3 caracteres no usuário.";if(senha.length<6)return authError.textContent="A senha precisa ter pelo menos 6 caracteres.";authSubmit.disabled=true;authError.textContent=authRegister?"Criando...":"Entrando...";try{const {r,data}=await api(authRegister?"/api/auth/register":"/api/auth/login",{method:"POST",body:JSON.stringify({nome,senha})});if(!r.ok||!data.ok){authError.textContent=data.error||"Não foi possível entrar.";return}token=data.token;user=data.user;saveSession();await openApp()}catch{authError.textContent="Falha de conexão."}finally{authSubmit.disabled=false}}

async function boot(){
  buildAccentPicker();
  $("auth-submit").onclick=authSubmitNow; authToggle.onclick=()=>setAuthMode(!authRegister); authPass.onkeydown=e=>{if(e.key==="Enter")authSubmitNow()}; authUser.onkeydown=e=>{if(e.key==="Enter")authPass.focus()};
  $("logout").onclick=()=>{if(confirm("Sair desta conta neste dispositivo?")){if(socket)socket.close();clearSession();app.classList.add("hidden");auth.classList.remove("hidden");setAuthMode(false)}};
  $("new-room").onclick=()=>{roomName.value="";roomPass.value="";roomPrivate.checked=false;roomPassWrap.classList.add("hidden");roomError.textContent="";roomModal.classList.remove("hidden");roomName.focus()};
  $("room-close").onclick=()=>roomModal.classList.add("hidden");roomPrivate.onchange=()=>roomPassWrap.classList.toggle("hidden",!roomPrivate.checked);$("room-create").onclick=createRoom;
  $("password-close").onclick=()=>{passwordModal.classList.add("hidden");if(socket)socket.close()};$("password-enter").onclick=()=>sendRoomPassword(roomEnterPass.value);roomEnterPass.onkeydown=e=>{if(e.key==="Enter")sendRoomPassword(roomEnterPass.value)};
  $("open-music").onclick=openMusic;$("open-search-top").onclick=openMusic;$("music-close").onclick=()=>musicModal.classList.add("hidden");$("music-search-btn").onclick=searchMusic;musicSearch.onkeydown=e=>{if(e.key==="Enter")searchMusic()};
  $("open-queue").onclick=openQueue;$("open-queue-2").onclick=openQueue;$("queue-close").onclick=()=>queueModal.classList.add("hidden");
  $("admin-open").onclick=()=>{adminModal.classList.remove("hidden");loadAdmin()};$("admin-close").onclick=()=>adminModal.classList.add("hidden");$("admin-clear-all").onclick=adminClearAll;
  $("settings-open").onclick=openSettings;$("settings-close").onclick=()=>settingsModal.classList.add("hidden");$("settings-save").onclick=saveSettings;
  $("send").onclick=sendMessage;messageInput.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage()}};messageInput.oninput=resizeMessage;
  clearRoom.onclick=()=>sendWS({type:"limpar_mensagens"});playPause.onclick=togglePlayback;nextTrack.onclick=()=>{if(currentTrack)sendWS({type:"proxima_musica",videoId:currentTrack.id})};sound.onclick=activateAudio;
  $("mobile-menu").onclick=()=>document.body.classList.toggle("sidebar-open");
  document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openMusic()}});
  window.onYouTubeIframeAPIReady=onYTReady;
  if(loadSession()){const {r,data}=await api("/api/auth/me");if(r.ok&&data.ok){user=data.user;saveSession();await openApp()}else{clearSession();auth.classList.remove("hidden")}}else setAuthMode(false);
}
async function openApp(){auth.classList.add("hidden");app.classList.remove("hidden");$("user-name").textContent=user.displayName||user.nome;$("user-avatar").textContent=initials(user.displayName||user.nome);$("user-role").textContent=user.role==="admin"?"admin":"online";$("admin-open").classList.toggle("hidden",user.role!=="admin");await loadConfig();await loadRooms();if(!rooms.some(r=>r.nome===currentRoom))currentRoom="geral";renderRooms();connectRoom(currentRoom);clearInterval(roomPoll);roomPoll=setInterval(loadRooms,4000)}
async function loadConfig(){
  const {r,data}=await api("/api/config");
  if(!r.ok||!data.ok)return;
  const name=data.siteName||"Chat da Firma";
  $("site-name").textContent=name;
  $("brand-mark").textContent=initials(name).slice(0,1);
  $("auth-site-name").textContent=name.toUpperCase();
}

function openSettings(){
  displayNameInput.value=user.displayName||user.nome;
  siteNameInput.value=$("site-name").textContent||"Chat da Firma";
  siteSettingsWrap.classList.toggle("hidden",user.role!=="admin");
  settingsError.textContent="";
  settingsModal.classList.remove("hidden");
  setTimeout(()=>displayNameInput.focus(),20);
}

async function saveSettings(){
  const displayName=displayNameInput.value.trim();
  if(displayName.length<2||displayName.length>30){settingsError.textContent="Seu nome deve ter entre 2 e 30 caracteres.";return}
  settingsError.textContent="Salvando...";
  const profile=await api("/api/settings/profile",{method:"POST",body:JSON.stringify({displayName})});
  if(!profile.r.ok||!profile.data.ok){settingsError.textContent=profile.data.error||"Não foi possível salvar seu nome.";return}
  user={...user,...profile.data.user};saveSession();$("user-name").textContent=user.displayName;$("user-avatar").textContent=initials(user.displayName);
  if(user.role==="admin"){
    const siteName=siteNameInput.value.trim();
    if(siteName.length<2||siteName.length>40){settingsError.textContent="O nome do site deve ter entre 2 e 40 caracteres.";return}
    const site=await api("/api/admin/settings",{method:"POST",body:JSON.stringify({siteName})});
    if(!site.r.ok||!site.data.ok){settingsError.textContent=site.data.error||"Não foi possível salvar o nome do site.";return}
    $("site-name").textContent=site.data.siteName;$("brand-mark").textContent=initials(site.data.siteName).slice(0,1);$("auth-site-name").textContent=site.data.siteName.toUpperCase();
  }
  settingsModal.classList.add("hidden");
  toast("Ajustes salvos");
  if(socket?.readyState===1){socket.close();setTimeout(()=>connectRoom(currentRoom),120)}
}

async function loadRooms(){const {r,data}=await api("/api/rooms");if(!r.ok||!data.ok)return;const old=rooms;rooms=data.rooms||[];renderRooms();if(!rooms.some(x=>x.nome===currentRoom)){currentRoom="geral";connectRoom("geral")}const oldCurrent=old.find(x=>x.nome===currentRoom),newCurrent=rooms.find(x=>x.nome===currentRoom);if(oldCurrent&&newCurrent&&oldCurrent.protegida!==newCurrent.protegida)connectRoom(currentRoom)}
function renderRooms(){roomsEl.innerHTML="";for(const room of rooms){const b=document.createElement("button");b.className="room-item"+(room.nome===currentRoom?" active":"");const dot=document.createElement("span");dot.className="room-dot";dot.style.color=roomColor(room);dot.textContent=initials(room.nome).slice(0,1);const label=document.createElement("span");label.textContent=room.nome;b.append(dot,label);if(room.protegida){const lock=document.createElement("span");lock.className="room-lock";lock.textContent="•";b.append(lock)}b.onclick=()=>selectRoom(room.nome);roomsEl.appendChild(b)}}
function roomColor(room){const map={violet:"#9b7cff",blue:"#5ea7ff",pink:"#ff7190",green:"#42d3a0",amber:"#f5b45c",cyan:"#67d6d0"};return map[room?.accent]||map.violet}
function selectRoom(name){if(name===currentRoom&&socket?.readyState===1)return;currentRoom=name;localStorage.setItem("ss-room",name);renderRooms();document.body.classList.remove("sidebar-open");connectRoom(name)}
function connectRoom(name){if(socket)try{socket.close()}catch{}authenticated=false;messages.innerHTML="";currentTrack=null;queue=[];loadedVideoId=null;updateRadio();presence.textContent="conectando...";const gen=++socketGeneration;const proto=location.protocol==="https:"?"wss":"ws";const wsUrl=`${proto}://${location.host}/ws?room=${encodeURIComponent(name)}&token=${encodeURIComponent(token)}`;socket=new WebSocket(wsUrl);socket.onopen=()=>{if(gen!==socketGeneration)return;presence.textContent="autenticando..."};socket.onmessage=e=>{try{handleServer(JSON.parse(e.data))}catch{}};socket.onerror=()=>{if(gen===socketGeneration)presence.textContent="falha na conexão"};socket.onclose=()=>{if(gen!==socketGeneration)return;authenticated=false;presence.textContent="reconectando...";setTimeout(()=>{if(gen===socketGeneration&&token)connectRoom(name)},1200)}}
function sendWS(obj){if(socket?.readyState===1)socket.send(JSON.stringify(obj));else toast("A sala ainda está conectando.",true)}
async function hashLocal(text){const bytes=new TextEncoder().encode(text);const d=await crypto.subtle.digest("SHA-256",bytes);return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,"0")).join("")}
function handleServer(d){
  if(d.type==="autenticacao_necessaria"){if(d.protegida){pendingPasswordRoom=currentRoom;passwordError.textContent="";roomEnterPass.value="";passwordModal.classList.remove("hidden");roomEnterPass.focus()}else sendWS({type:"entrar",senhaHash:""});return}
  if(d.type==="estado_inicial"){authenticated=true;passwordModal.classList.add("hidden");const room=rooms.find(x=>x.nome===currentRoom);currentRoomEl.textContent=currentRoom;roomBadge.textContent=initials(currentRoom).slice(0,1);roomBadge.style.color=roomColor(room);clearRoom.classList.toggle("hidden",d.ownerId!==user.id&&user.role!=="admin");messages.innerHTML="";(d.mensagens||[]).forEach(renderMessage);queue=d.fila||[];applyRadioState(d.tocandoAgora,d.fila,true);scrollBottom();return}
  if(d.type==="mensagem"){renderMessage(d.mensagem);scrollBottom();return}
  if(d.type==="mensagens_limpas"){messages.innerHTML="";systemMessage("O histórico desta sala foi limpo.");return}
  if(d.type==="reacao"){updateReaction(d.messageId,d.emoji,d.total);return}
  if(d.type==="presenca"){presence.textContent=`${d.total} ${d.total===1?"pessoa":"pessoas"} na sala`;return}
  if(d.type==="tocando_agora"){applyRadioState(d.tocandoAgora,d.fila,false);return}
  if(d.type==="sala_excluida"){toast("Esta sala foi removida.",true);connectRoom("geral");loadRooms();return}
  if(d.type==="erro"){if(d.code==="SENHA_INCORRETA"){passwordError.textContent=d.message;passwordModal.classList.remove("hidden")}else toast(d.message||"Algo deu errado.",true)}
}
function sendRoomPassword(pass){if(!pass)return passwordError.textContent="Digite a senha.";hashLocal(pass).then(h=>sendWS({type:"entrar",senhaHash:h}))}
function renderMessage(m){const row=document.createElement("article");row.className="message-row"+(m.autorId===user.id?" mine":"");row.dataset.id=m.id;const av=document.createElement("div");av.className="message-avatar";av.textContent=initials(m.nome);const c=document.createElement("div");c.className="message-content";const head=document.createElement("div");head.className="message-head";const name=document.createElement("span");name.className="message-name";name.textContent=m.autorId===user.id?"Você":m.nome;const time=document.createElement("span");time.className="message-time";time.textContent=new Date(m.ts).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});head.append(name,time);const bubble=document.createElement("div");bubble.className="bubble";bubble.textContent=m.text;const reactions=document.createElement("div");reactions.className="reactions";for(const x of ["+1","♡","⌁"]){const b=document.createElement("button");b.className="reaction";b.textContent=m.reacoes?.[x]?`${x} ${m.reacoes[x]}`:x;b.onclick=()=>sendWS({type:"reacao",messageId:m.id,emoji:x});reactions.appendChild(b)}c.append(head,bubble,reactions);row.append(av,c);messages.appendChild(row)}
function updateReaction(id,emoji,total){const row=messages.querySelector(`[data-id="${CSS.escape(id)}"]`);if(!row)return;const buttons=[...row.querySelectorAll(".reaction")];const b=buttons.find(x=>x.textContent.startsWith(emoji));if(b)b.textContent=total?`${emoji} ${total}`:emoji}
function systemMessage(t){const d=document.createElement("div");d.className="system-message";d.textContent=t;messages.appendChild(d);scrollBottom()}
function scrollBottom(){requestAnimationFrame(()=>messages.scrollTop=messages.scrollHeight)}
function sendMessage(){const text=messageInput.value.trim();if(!text||!authenticated)return;if(text.toLowerCase().startsWith("!play ")){messageInput.value="";resizeMessage();searchAndQueue(text.slice(6).trim());return}sendWS({type:"mensagem",text});messageInput.value="";resizeMessage()}
function resizeMessage(){messageInput.style.height="auto";messageInput.style.height=Math.min(messageInput.scrollHeight,120)+"px"}
function openMusic(){musicModal.classList.remove("hidden");musicSearch.value="";musicResults.innerHTML="";musicStatus.textContent="";setTimeout(()=>musicSearch.focus(),20)}
async function searchMusic(){const q=musicSearch.value.trim();if(!q)return;musicStatus.textContent="Buscando...";musicResults.innerHTML="";try{const r=await fetch(`/api/music?q=${encodeURIComponent(q)}`);const d=await r.json();if(!r.ok||!d.ok){musicStatus.textContent=d.error||"Não foi possível buscar.";return}musicStatus.textContent=d.results.length?"":"Nenhum resultado.";d.results.forEach(addSearchResult)}catch{musicStatus.textContent="Falha de rede."}}
async function searchAndQueue(q){const r=await fetch(`/api/music?q=${encodeURIComponent(q)}`);const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok||!d.results?.length){toast("Não encontrei essa música.",true);return}queueTrack(d.results[0])}
function addSearchResult(item){const row=document.createElement("div");row.className="music-result";const img=document.createElement("img");img.src=item.thumbnail;const info=document.createElement("div");const b=document.createElement("strong");b.textContent=item.title;const s=document.createElement("span");s.textContent=item.channel;info.append(b,s);row.append(img,info);row.onclick=()=>{queueTrack(item);musicModal.classList.add("hidden")};musicResults.appendChild(row)}
function queueTrack(item){sendWS({type:"fila_adicionar",id:item.id,title:item.title,channel:item.channel,thumbnail:item.thumbnail});toast("Adicionada à fila")}
function openQueue(){renderQueue();queueModal.classList.remove("hidden")}
function renderQueue(){queueList.innerHTML="";if(!queue.length){queueList.innerHTML='<div class="queue-empty">Nenhuma música aguardando.</div>';return}queue.forEach((m,i)=>{const row=document.createElement("div");row.className="queue-row";const n=document.createElement("b");n.textContent=String(i+1).padStart(2,"0");const img=document.createElement("img");img.src=m.thumbnail||"";const info=document.createElement("div");const title=document.createElement("strong");title.textContent=m.title;const channel=document.createElement("span");channel.textContent=m.channel||"";info.append(title,channel);row.append(n,img,info);queueList.appendChild(row)})}
function updateMiniQueue(){queueCount.textContent=queue.length;miniQueue.innerHTML="";if(!queue.length){miniQueue.innerHTML='<div class="queue-empty">Fila vazia</div>';return}queue.slice(0,3).forEach(m=>{const d=document.createElement("div");d.className="mini-item";const img=document.createElement("img");img.src=m.thumbnail||"";const info=document.createElement("div");info.className="mini-info";const b=document.createElement("strong");b.textContent=m.title;const s=document.createElement("span");s.textContent=m.channel||"";info.append(b,s);d.append(img,info);miniQueue.appendChild(d)})}

function applyRadioState(track,newQueue,initial=false){
  queue=Array.isArray(newQueue)?newQueue:[];updateMiniQueue();
  const oldId=currentTrack?.id||null;currentTrack=track||null;
  if(!track){trackTitle.textContent="Nenhuma música";trackChannel.textContent="Adicione uma faixa para começar";cover.innerHTML='<div class="cover-letter">S</div><div class="cover-shine"></div>';playPause.disabled=true;nextTrack.disabled=true;progressBar.style.width="0%";timeCurrent.textContent="0:00";timeTotal.textContent="0:00";syncLabel.textContent="—";if(ytReady&&yt?.stopVideo)yt.stopVideo();loadedVideoId=null;return}
  trackTitle.textContent=track.title;trackChannel.textContent=track.channel||"YouTube";playPause.disabled=false;nextTrack.disabled=false;playIcon.textContent=track.paused?"▶":"Ⅱ";cover.innerHTML="";if(track.thumbnail){const img=document.createElement("img");img.src=track.thumbnail;img.alt="";cover.append(img)}else{cover.innerHTML='<div class="cover-letter">S</div><div class="cover-shine"></div>'};sound.classList.toggle("hidden",audioOn);
  const changed=oldId!==track.id;
  if(changed||initial)loadTrack(track);else applySameTrackState(track);
}
function targetPosition(track){if(track.paused)return Math.max(0,Number(track.position||0));return Math.max(0,(Date.now()-Number(track.startedAt||Date.now()))/1000)}
function loadTrack(track){if(!ytReady){window.pendingTrack=track;return}loadedVideoId=track.id;const start=targetPosition(track);yt.loadVideoById({videoId:track.id,startSeconds:start});setTimeout(()=>{if(currentTrack?.id!==track.id)return;if(track.paused){yt.seekTo(Number(track.position||0),true);yt.pauseVideo()}else{if(!audioOn)yt.mute();yt.playVideo()}},250)}
function applySameTrackState(track){
  if(!ytReady||!yt||loadedVideoId!==track.id)return;
  const target=targetPosition(track);
  try{const now=Number(yt.getCurrentTime?.()||0);if(track.paused){yt.pauseVideo();if(Math.abs(now-target)>1.25)yt.seekTo(target,true)}else{if(Math.abs(now-target)>3.2)yt.seekTo(target,true);if(audioOn)yt.unMute();yt.playVideo()}syncLabel.textContent=track.paused?"pausado":"sincronizado";playIcon.textContent=track.paused?"▶":"Ⅱ"}catch{}
}
function togglePlayback(){if(!currentTrack)return;if(currentTrack.paused){playIcon.textContent="Ⅱ";sendWS({type:"continuar_musica"})}else{let pos=0;try{pos=yt?.getCurrentTime?.()||0;yt?.pauseVideo?.()}catch{};currentTrack={...currentTrack,position:pos,paused:true};playIcon.textContent="▶";sendWS({type:"pausar_musica",position:pos})}}
function activateAudio(){audioOn=true;sound.classList.add("hidden");if(yt){yt.unMute();if(currentTrack?.paused)yt.pauseVideo();else yt.playVideo()}}
function onYTReady(){ytReady=true;yt=window.__salaPlayer;if(window.pendingTrack){const p=window.pendingTrack;window.pendingTrack=null;loadTrack(p)}}
window.onYouTubeIframeAPIReady=function(){window.__salaPlayer=new YT.Player("youtube-player",{height:"1",width:"1",playerVars:{autoplay:1,playsinline:1,controls:0,rel:0},events:{onReady:onYTReady,onStateChange:e=>{if(e.data===YT.PlayerState.ENDED&&currentTrack&&!currentTrack.paused)sendWS({type:"proxima_musica",videoId:currentTrack.id});if(e.data===YT.PlayerState.PLAYING&&currentTrack&&!currentTrack.paused){syncLabel.textContent="sincronizado";if(!audioOn)sound.classList.remove("hidden")}}}})};
function updateProgress(){if(!currentTrack||!ytReady||loadedVideoId!==currentTrack.id)return;try{const cur=Number(yt.getCurrentTime?.()||0),dur=Number(yt.getDuration?.()||0);if(dur){progressBar.style.width=Math.min(100,cur/dur*100)+"%";timeTotal.textContent=fmt(dur)}timeCurrent.textContent=fmt(cur)}catch{}}
function fmt(sec){sec=Math.max(0,Math.floor(sec||0));const m=Math.floor(sec/60),s=String(sec%60).padStart(2,"0");return `${m}:${s}`}
setInterval(updateProgress,500);

function buildAccentPicker(){accentPicker.innerHTML="";const names=["violet","blue","pink","green","amber","cyan"];names.forEach((name,i)=>{const b=document.createElement("button");b.className="accent";b.style.background=accents[i];b.classList.toggle("selected",selectedAccent===accents[i]);b.onclick=()=>{selectedAccent=accents[i];[...accentPicker.children].forEach((x,j)=>x.classList.toggle("selected",j===i))};accentPicker.appendChild(b)})}
async function createRoom(){const nome=roomName.value.trim();const senha=roomPrivate.checked?roomPass.value:"";if(nome.length<2)return roomError.textContent="Dê um nome para a sala.";if(roomPrivate.checked&&senha.length<4)return roomError.textContent="A senha precisa ter pelo menos 4 caracteres.";roomError.textContent="Criando...";const names={"#":"violet"};const accentName=accents.indexOf(selectedAccent)===0?"violet":accents.indexOf(selectedAccent)===1?"blue":accents.indexOf(selectedAccent)===2?"pink":accents.indexOf(selectedAccent)===3?"green":accents.indexOf(selectedAccent)===4?"amber":"cyan";const {r,data}=await api("/api/rooms",{method:"POST",body:JSON.stringify({nome,senha,accent:accentName})});if(!r.ok||!data.ok){roomError.textContent=data.error||"Não foi possível criar.";return}roomModal.classList.add("hidden");await loadRooms();selectRoom(data.room.nome);toast(`Sala ${data.room.nome} criada`)}

async function loadAdmin(){const {r,data}=await api("/api/admin/rooms");if(!r.ok||!data.ok){toast(data.error||"Acesso negado",true);return}adminRooms.innerHTML="";for(const room of data.rooms||[]){const row=document.createElement("div");row.className="admin-room";const info=document.createElement("div");info.className="admin-room-info";const b=document.createElement("strong");b.textContent=room.nome;const s=document.createElement("span");s.textContent=room.protegida?"Sala privada":"Sala pública";info.append(b,s);const clear=document.createElement("button");clear.textContent="Limpar";clear.onclick=async()=>{if(confirm(`Limpar o chat de #${room.nome}?`)){const x=await api(`/api/admin/rooms/${encodeURIComponent(room.nome)}/clear`,{method:"POST"});if(x.r.ok){toast("Conversa limpa");loadAdmin()}}};row.append(info,clear);if(room.nome!=="geral"){const del=document.createElement("button");del.className="delete";del.textContent="Excluir";del.onclick=async()=>{if(confirm(`Excluir a sala #${room.nome}?`)){const x=await api(`/api/admin/rooms/${encodeURIComponent(room.nome)}`,{method:"DELETE"});if(x.r.ok){if(currentRoom===room.nome){currentRoom="geral";connectRoom("geral")}await loadRooms();loadAdmin();toast("Sala excluída")}}};row.append(del)}adminRooms.appendChild(row)}}
async function adminClearAll(){if(!confirm("Limpar as conversas de TODAS as salas?"))return;const {r,data}=await api("/api/admin/rooms/clear-all",{method:"POST"});if(r.ok&&data.ok){toast("Todos os chats foram limpos");adminModal.classList.add("hidden")}else toast(data.error||"Não foi possível limpar.",true)}

boot();
