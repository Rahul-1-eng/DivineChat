/* ===================== DivineChat client ===================== */
const $ = (id) => document.getElementById(id);
const socket = io({ autoConnect: false });
socket.on('connect_error', (err) => { if (err.message === 'unauthorized') logout(); });

let me = null, myColor = '#888';
let contacts = [];                 // [{type,id,username/name,color,bot,members}]
let active = null;                 // current contact object
const previews = {};               // conversationId -> {text, ts}
const unread = {};                 // conversationId -> count
const onlineSet = new Set();

const initial = (s) => (s || '?').trim().charAt(0).toUpperCase();
const esc = (s) => s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/* ===================== Auth ===================== */
let mode = 'login';                // 'login' | 'register'
const authErr = (m) => { $('auth-error').textContent = m || ''; };

function setMode(m) {
  mode = m;
  $('tab-login').classList.toggle('active', m === 'login');
  $('tab-register').classList.toggle('active', m === 'register');
  $('auth-submit').textContent = m === 'login' ? 'Log in' : 'Create account';
  $('auth-pass').setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password');
  $('auth-hint').textContent = m === 'login'
    ? 'New here? Tap “Sign up”. Your username is unique to you.'
    : 'Pick a unique username (3–24 chars) and a password (6+ chars).';
  $('fp-login').style.display = m === 'login' ? '' : 'none';
  authErr('');
}
$('tab-login').onclick = () => setMode('login');
$('tab-register').onclick = () => setMode('register');
$('auth-submit').onclick = submitAuth;
$('auth-pass').addEventListener('keydown', e => { if (e.key === 'Enter') submitAuth(); });
$('auth-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('auth-pass').focus(); });

const savedName = localStorage.getItem('dc_name');
if (savedName) $('auth-name').value = savedName;

async function submitAuth() {
  const username = $('auth-name').value.trim();
  const password = $('auth-pass').value;
  if (!username || !password) return authErr('Enter a username and password.');
  authErr('');
  $('auth-submit').disabled = true;
  try {
    const r = await fetch('/api/' + (mode === 'register' ? 'register' : 'login'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed');
    onAuthed(data.token, data.user);
  } catch (e) { authErr(e.message); window.fx?.sound('click'); }
  finally { $('auth-submit').disabled = false; }
}

/* ---- fingerprint login ---- */
$('fp-login').onclick = async () => {
  const username = $('auth-name').value.trim();
  if (!username) return authErr('Enter your username first, then use fingerprint.');
  if (!window.SimpleWebAuthnBrowser) return authErr('Fingerprint not supported in this browser.');
  authErr('');
  try {
    const optRes = await fetch('/api/webauthn/login/options', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username })
    });
    const options = await optRes.json();
    if (!optRes.ok) throw new Error(options.error || 'No fingerprint on file');
    const asseResp = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });
    const vRes = await fetch('/api/webauthn/login/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, response: asseResp })
    });
    const data = await vRes.json();
    if (!vRes.ok) throw new Error(data.error || 'Verification failed');
    onAuthed(data.token, data.user);
  } catch (e) { authErr(e.message || 'Fingerprint failed'); }
};

function onAuthed(token, user) {
  localStorage.setItem('dc_token', token);
  localStorage.setItem('dc_name', user.username);
  me = user.username; myColor = user.color;
  $('login').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('me-name').textContent = me;
  setAvatar($('me-avatar'), me, myColor);
  connectSocket(token);
  window.fx?.sound('success');
}

function connectSocket(token) {
  socket.auth = { token };
  socket.connect();
}

function logout() {
  localStorage.removeItem('dc_token');
  try { socket?.disconnect(); } catch {}
  location.reload();
}

// auto-login if we have a valid token
(async function tryResume() {
  const token = localStorage.getItem('dc_token');
  if (!token) return;
  try {
    const r = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw 0;
    const { user } = await r.json();
    onAuthed(token, user);
  } catch { localStorage.removeItem('dc_token'); }
})();

function setAvatar(el, name, color, showDot = false, online = false) {
  el.textContent = initial(name);
  el.style.background = color || '#888';
  el.querySelector('.dot')?.remove();
  if (showDot && online) { const d = document.createElement('span'); d.className = 'dot'; el.appendChild(d); }
}

/* ---------- Contacts ---------- */
socket.on('contacts', (list) => { contacts = list; renderContacts(); });
socket.on('presence', ({ online }) => {
  onlineSet.clear(); online.forEach(u => onlineSet.add(u));
  renderContacts();
  if (active && active.type === 'dm') updateRoomStatus();
});

$('search').addEventListener('input', renderContacts);

function renderContacts() {
  const q = $('search').value.toLowerCase();
  const box = $('contacts');
  box.innerHTML = '';
  contacts
    .map(c => ({ c, label: c.type === 'dm' ? c.username : c.name }))
    .filter(({ label }) => label.toLowerCase().includes(q))
    .sort((a, b) => (previews[b.c.id]?.ts || 0) - (previews[a.c.id]?.ts || 0))
    .forEach(({ c, label }) => {
      const el = document.createElement('div');
      el.className = 'contact' + (active?.id === c.id ? ' active' : '');
      const av = document.createElement('span');
      av.className = 'avatar';
      const isOn = c.type === 'dm' && (c.bot || onlineSet.has(c.username));
      setAvatar(av, label, c.color, c.type === 'dm', isOn);
      const pv = previews[c.id];
      const info = document.createElement('div');
      info.className = 'info';
      info.innerHTML = `<div class="row"><span class="name">${esc(label)}${c.bot ? ' 🤖' : ''}</span>
        <span class="time">${pv ? fmtTime(pv.ts) : ''}</span></div>
        <div class="row"><span class="preview">${pv ? esc(pv.text) : (c.type==='group' ? c.members.length+' members' : '')}</span>
        ${unread[c.id] ? `<span class="badge">${unread[c.id]}</span>` : ''}</div>`;
      el.append(av, info);
      el.onclick = (e) => { rippleAt(el, e); openChat(c); };
      box.appendChild(el);
    });
}

/* ---------- Open a chat ---------- */
function openChat(c) {
  active = c;
  unread[c.id] = 0;
  $('empty').classList.add('hidden');
  $('room').classList.remove('hidden');
  $('app').classList.add('in-room');
  const label = c.type === 'dm' ? c.username : c.name;
  setAvatar($('room-avatar'), label, c.color);
  $('room-name').textContent = label + (c.bot ? ' 🤖' : '');
  $('call-btn').style.display = (c.type === 'dm' && !c.bot) ? '' : 'none';
  const wipe = document.createElement('div'); wipe.className = 'wipe-fx';
  $('room').appendChild(wipe); setTimeout(() => wipe.remove(), 600);
  updateRoomStatus();
  renderContacts();
  $('messages').innerHTML = '';
  socket.emit('history', c.id, ({ messages }) => {
    messages.forEach(addMessage);
    scrollDown();
    socket.emit('read', { conversationId: c.id, to: peerOf(c), isGroup: c.type === 'group' });
  });
}

function peerOf(c) { return c.type === 'dm' ? c.username : null; }

function updateRoomStatus() {
  if (!active) return;
  if (active.type === 'group') { $('room-status').textContent = active.members.join(', '); return; }
  if (active.bot) { $('room-status').textContent = 'AI • always online'; return; }
  $('room-status').textContent = onlineSet.has(active.username) ? 'online' : 'offline';
}

/* ---------- Render a message ---------- */
function addMessage(m) {
  const mine = m.from === me;
  const div = document.createElement('div');
  div.className = 'msg ' + (mine ? 'out' : 'in');
  div.dataset.id = m.id;
  let body = '';
  if (active?.type === 'group' && !mine) body += `<div class="sender" style="color:${colorOf(m.from)}">${esc(m.from)}</div>`;
  if (m.type === 'image') body += `<img src="${m.content}" onclick="window.open('${m.content}')">`;
  else if (m.type === 'audio') body += `<audio controls src="${m.content}"></audio>`;
  else body += esc(m.content);
  const tick = mine ? `<span class="tick ${m.status==='read'?'read':''}">✓✓</span>` : '';
  body += `<div class="meta">${fmtTime(m.ts)} ${tick}</div>`;
  div.innerHTML = body;
  $('messages').appendChild(div);
}
function colorOf(name) {
  const c = contacts.find(x => x.username === name);
  return c?.color || '#aaa';
}
function scrollDown() { const m = $('messages'); m.scrollTop = m.scrollHeight; }

function rippleAt(el, e) {
  const r = document.createElement('span');
  r.className = 'ripple';
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  r.style.width = r.style.height = size + 'px';
  r.style.left = (e.clientX - rect.left - size / 2) + 'px';
  r.style.top = (e.clientY - rect.top - size / 2) + 'px';
  el.appendChild(r);
  setTimeout(() => r.remove(), 600);
}

/* ---------- Sending ---------- */
const input = $('input');
input.addEventListener('input', () => {
  input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  if (active) socket.emit('typing', { conversationId: active.id, to: peerOf(active), isGroup: active.type==='group' });
});
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
});
$('send-btn').onclick = sendText;

function send(type, content, meta) {
  if (!active) return;
  socket.emit('message', {
    conversationId: active.id, to: peerOf(active), isGroup: active.type === 'group',
    type, content, meta
  }, ({ msg }) => { addMessage(msg); scrollDown(); bumpPreview(msg); window.fx?.sound('send'); });
}
function sendText() {
  const t = input.value.trim();
  if (!t) return;
  input.value = ''; input.style.height = 'auto';
  send('text', t);
  $('emoji-picker').classList.add('hidden');
}
function bumpPreview(m) {
  previews[m.conversationId] = { text: previewText(m), ts: m.ts };
  renderContacts();
}
function previewText(m) {
  return m.type === 'image' ? '📷 Photo' : m.type === 'audio' ? '🎤 Voice message' : m.content;
}

/* ---------- Incoming ---------- */
socket.on('message', (m) => {
  bumpPreview(m);
  if (m.from !== me) window.fx?.sound('receive');
  if (active && m.conversationId === active.id) {
    addMessage(m); scrollDown();
    socket.emit('read', { conversationId: active.id, to: peerOf(active), isGroup: active.type==='group' });
  } else {
    unread[m.conversationId] = (unread[m.conversationId] || 0) + 1;
    renderContacts();
  }
  hideTyping(m.conversationId);
});
socket.on('read', ({ conversationId, by }) => {
  if (active && conversationId === active.id) {
    $('messages').querySelectorAll('.msg.out .tick').forEach(t => t.classList.add('read'));
  }
});

let typingTimers = {};
socket.on('typing', ({ conversationId, from }) => {
  if (active && conversationId === active.id) {
    $('typing-row').classList.remove('hidden'); scrollDown();
    clearTimeout(typingTimers[conversationId]);
    typingTimers[conversationId] = setTimeout(() => hideTyping(conversationId), 2500);
  }
});
function hideTyping(cid) { if (active && cid === active.id) $('typing-row').classList.add('hidden'); }

/* ---------- Emoji ---------- */
$('emoji-btn').onclick = () => $('emoji-picker').classList.toggle('hidden');
$('emoji-picker').addEventListener('emoji-click', e => {
  input.value += e.detail.unicode; input.focus();
});

/* ---------- Image upload ---------- */
$('attach-btn').onclick = () => $('file-input').click();
$('file-input').onchange = async () => {
  const file = $('file-input').files[0];
  if (!file) return;
  const url = await uploadFile(file);
  if (url) send('image', url);
  $('file-input').value = '';
};
async function uploadFile(file) {
  const fd = new FormData(); fd.append('file', file);
  try {
    const r = await fetch('/api/upload', { method: 'POST', body: fd });
    const d = await r.json();
    return d.url;
  } catch { alert('Upload failed'); return null; }
}

/* ---------- Voice messages (record) ---------- */
let mediaRecorder = null, chunks = [], recording = false;
const mic = $('mic-btn');
mic.addEventListener('mousedown', startRec);
mic.addEventListener('touchstart', e => { e.preventDefault(); startRec(); });
mic.addEventListener('mouseup', stopRec);
mic.addEventListener('mouseleave', stopRec);
mic.addEventListener('touchend', stopRec);

async function startRec() {
  if (recording || !active) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    chunks = [];
    mediaRecorder.ondataavailable = e => chunks.push(e.data);
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const file = new File([blob], 'voice.webm', { type: 'audio/webm' });
      const url = await uploadFile(file);
      if (url) send('audio', url);
    };
    mediaRecorder.start();
    recording = true;
    mic.classList.add('mic-recording');
  } catch { alert('Mic permission needed'); }
}
function stopRec() {
  if (recording && mediaRecorder) {
    mediaRecorder.stop(); recording = false; mic.classList.remove('mic-recording');
  }
}

/* ===================== WebRTC voice calls ===================== */
let pc = null, localStream = null, callPeer = null, callIncoming = null, muted = false;
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

$('call-btn').onclick = () => startCall(active.username);
$('call-hangup').onclick = endCall;
$('call-accept').onclick = acceptCall;
$('call-mute').onclick = toggleMute;

async function getMic() {
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return localStream;
}
function newPeer(peer) {
  callPeer = peer;
  pc = new RTCPeerConnection(ICE);
  pc.onicecandidate = e => { if (e.candidate) socket.emit('call:ice', { to: peer, candidate: e.candidate }); };
  pc.ontrack = e => { $('remote-audio').srcObject = e.streams[0]; };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') $('call-state').textContent = 'Connected';
    if (['disconnected','failed','closed'].includes(pc.connectionState)) endCall(true);
  };
  return pc;
}
function showCall(name, state, { accept = false } = {}) {
  $('call').classList.remove('hidden');
  setAvatar($('call-avatar'), name, colorOf(name) || '#00a884');
  $('call-name').textContent = name;
  $('call-state').textContent = state;
  $('call-accept').classList.toggle('hidden', !accept);
  $('call-mute').classList.toggle('hidden', accept);
}

async function startCall(peer) {
  try {
    await getMic();
    newPeer(peer);
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    showCall(peer, 'Calling…');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('call:offer', { to: peer, sdp: offer });
  } catch (e) { alert('Could not start call: ' + e.message); endCall(true); }
}

socket.on('call:offer', async ({ from, sdp }) => {
  if (pc) { socket.emit('call:reject', { to: from }); return; }   // busy
  callIncoming = { from, sdp };
  showCall(from, 'Incoming call…', { accept: true });
  window.fx?.sound('ring');
  ringTimer = setInterval(() => window.fx?.sound('ring'), 2500);
});
let ringTimer = null;
function stopRing() { clearInterval(ringTimer); ringTimer = null; }
async function acceptCall() {
  stopRing();
  const { from, sdp } = callIncoming; callIncoming = null;
  await getMic();
  newPeer(from);
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('call:answer', { to: from, sdp: answer });
  showCall(from, 'Connecting…');
}
socket.on('call:answer', async ({ sdp }) => {
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
});
socket.on('call:ice', async ({ candidate }) => {
  try { await pc?.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
});
socket.on('call:reject', () => { $('call-state').textContent = 'Call declined'; setTimeout(() => endCall(true), 1200); });
socket.on('call:hangup', () => endCall(true));

function toggleMute() {
  muted = !muted;
  localStream?.getAudioTracks().forEach(t => t.enabled = !muted);
  $('call-mute').textContent = muted ? 'Unmute' : 'Mute';
}
function endCall(remote = false) {
  stopRing();
  if (!remote && callPeer) socket.emit('call:hangup', { to: callPeer });
  pc?.close(); pc = null;
  localStream?.getTracks().forEach(t => t.stop()); localStream = null;
  callPeer = null; callIncoming = null; muted = false;
  $('call').classList.add('hidden');
  $('call-mute').textContent = 'Mute';
}

/* ---------- Groups ---------- */
$('new-group-btn').onclick = () => {
  const box = $('group-members');
  box.innerHTML = '';
  contacts.filter(c => c.type === 'dm' && !c.bot).forEach(c => {
    const l = document.createElement('label');
    l.innerHTML = `<input type="checkbox" value="${esc(c.username)}"> ${esc(c.username)}`;
    box.appendChild(l);
  });
  $('group-name').value = '';
  $('group-modal').classList.remove('hidden');
};
$('group-cancel').onclick = () => $('group-modal').classList.add('hidden');
$('group-create').onclick = () => {
  const name = $('group-name').value.trim();
  const members = [...$('group-members').querySelectorAll('input:checked')].map(i => i.value);
  if (!name || !members.length) return alert('Name and at least one member required');
  socket.emit('createGroup', { name, members }, () => $('group-modal').classList.add('hidden'));
};

/* ---------- Account: fingerprint enroll + logout ---------- */
$('logout-btn').onclick = () => { if (confirm('Log out of DivineChat?')) logout(); };

$('fp-enroll').onclick = async () => {
  if (!window.SimpleWebAuthnBrowser) return alert('Fingerprint/biometrics are not supported in this browser.');
  const token = localStorage.getItem('dc_token');
  try {
    const optRes = await fetch('/api/webauthn/register/options', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    const options = await optRes.json();
    if (!optRes.ok) throw new Error(options.error || 'Failed');
    const attResp = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: options });
    const vRes = await fetch('/api/webauthn/register/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(attResp)
    });
    const data = await vRes.json();
    if (!vRes.ok || !data.verified) throw new Error(data.error || 'Verification failed');
    window.fx?.sound('success');
    alert('✅ Fingerprint added! You can now log in with your fingerprint on this device.');
  } catch (e) { alert('Could not add fingerprint: ' + (e.message || e)); }
};

/* ---------- FX: theme + sound toggles ---------- */
const themeBtn = $('theme-btn'), soundBtn = $('sound-btn');
window.fx?.initThemeBtn(themeBtn);
themeBtn.onclick = () => window.fx?.toggleTheme(themeBtn);
soundBtn.textContent = window.fx?.soundOn() ? '🔊' : '🔇';
soundBtn.onclick = () => { const on = window.fx?.toggleSound(); soundBtn.textContent = on ? '🔊' : '🔇'; if (on) window.fx?.sound('click'); };
