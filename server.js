import express from 'express';
import dotenv from 'dotenv';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { maxHttpBufferSize: 1e7 });
const port = process.env.PORT || 3000;

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const AI_USER = 'AI Assistant';

// WebAuthn (fingerprint) config — override via .env in production
const RP_ID = process.env.RP_ID || 'localhost';
const RP_NAME = 'DivineChat';
const ORIGIN = process.env.ORIGIN || `http://localhost:${port}`;

// ---------- persistence (simple JSON db) ----------
const DB_PATH = join(__dirname, 'db.json');
const UPLOAD_DIR = join(__dirname, 'public', 'uploads');
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

let db = { users: {}, messages: {}, groups: {} };
if (existsSync(DB_PATH)) {
  try { db = JSON.parse(readFileSync(DB_PATH, 'utf8')); } catch { /* keep default */ }
}
// guarantee shape
db.users ||= {};
db.messages ||= {};   // conversationId -> [msg]
db.groups ||= {};     // groupId -> { id, name, members: [usernames], avatar }
// AI is always present as a contact
db.users[AI_USER] ||= { username: AI_USER, color: '#10a37f', bot: true };

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); } catch (e) { console.error('persist', e); }
  }, 200);
}

const COLORS = ['#e74c3c','#3498db','#9b59b6','#e67e22','#1abc9c','#f39c12','#2ecc71','#fd79a8','#0984e3'];
function colorFor(name) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

function dmId(a, b) { return 'dm:' + [a, b].sort().join('|'); }
function pushMessage(conversationId, msg) {
  (db.messages[conversationId] ||= []).push(msg);
  if (db.messages[conversationId].length > 500) db.messages[conversationId].shift();
  persist();
}

// ---------- uploads ----------
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const safe = 'f' + Math.abs(hashStr(file.originalname + file.size)) + Date.now().toString(36) + extname(file.originalname || '.bin');
    cb(null, safe);
  }
});
function hashStr(s){let h=0;for(const c of s)h=(h*31+c.charCodeAt(0))|0;return h;}
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json({ limit: '12mb' }));
app.use(express.static(join(__dirname, 'public')));

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  res.json({ url: '/uploads/' + req.file.filename, name: req.file.originalname, size: req.file.size });
});

// ==================== Authentication ====================
const tokens = new Map();                    // token -> username
const challenges = new Map();                // username -> current webauthn challenge
const VALID_NAME = /^[a-zA-Z0-9_.]{3,24}$/;

function findUser(name) {                     // case-insensitive lookup
  const key = Object.keys(db.users).find(u => u.toLowerCase() === String(name).toLowerCase());
  return key ? db.users[key] : null;
}
function issueToken(username) {
  const tok = randomBytes(24).toString('hex');
  tokens.set(tok, username);
  return tok;
}
function userFromToken(tok) { return tok && tokens.get(tok); }
function authREST(req, res, next) {
  const tok = (req.headers.authorization || '').replace('Bearer ', '');
  const u = userFromToken(tok);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  req.username = u;
  next();
}
const publicUser = (u) => ({ username: u.username, color: u.color, hasFingerprint: (u.credentials || []).length > 0 });

app.post('/api/register', async (req, res) => {
  let { username, password } = req.body || {};
  username = String(username || '').trim();
  if (!VALID_NAME.test(username)) return res.status(400).json({ error: 'Username must be 3-24 chars: letters, numbers, _ or .' });
  if (username.toLowerCase() === AI_USER.toLowerCase()) return res.status(400).json({ error: 'That name is reserved' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (findUser(username)) return res.status(409).json({ error: 'Username already taken' });
  const passHash = await bcrypt.hash(password, 10);
  db.users[username] = { username, color: colorFor(username), passHash, credentials: [], createdAt: Date.now() };
  persist();
  const token = issueToken(username);
  res.json({ token, user: publicUser(db.users[username]) });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = findUser(username);
  if (!user || !user.passHash) return res.status(401).json({ error: 'Invalid username or password' });
  const ok = await bcrypt.compare(String(password || ''), user.passHash);
  if (!ok) return res.status(401).json({ error: 'Invalid username or password' });
  res.json({ token: issueToken(user.username), user: publicUser(user) });
});

app.get('/api/me', authREST, (req, res) => res.json({ user: publicUser(db.users[req.username]) }));

// ---- WebAuthn: enroll a fingerprint (must be logged in) ----
app.post('/api/webauthn/register/options', authREST, async (req, res) => {
  const user = db.users[req.username];
  const options = await generateRegistrationOptions({
    rpName: RP_NAME, rpID: RP_ID,
    userName: user.username,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    excludeCredentials: (user.credentials || []).map(c => ({ id: c.id })),
  });
  challenges.set(user.username, options.challenge);
  res.json(options);
});

app.post('/api/webauthn/register/verify', authREST, async (req, res) => {
  const user = db.users[req.username];
  try {
    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: challenges.get(user.username),
      expectedOrigin: ORIGIN, expectedRPID: RP_ID,
    });
    if (!verification.verified || !verification.registrationInfo) return res.status(400).json({ error: 'verification failed' });
    const { credential } = verification.registrationInfo;
    (user.credentials ||= []).push({
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64'),
      counter: credential.counter,
    });
    persist();
    res.json({ verified: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ---- WebAuthn: log in with fingerprint ----
app.post('/api/webauthn/login/options', async (req, res) => {
  const user = findUser(req.body?.username);
  if (!user || !(user.credentials || []).length) return res.status(404).json({ error: 'No fingerprint registered for this user' });
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: user.credentials.map(c => ({ id: c.id })),
    userVerification: 'preferred',
  });
  challenges.set(user.username, options.challenge);
  res.json(options);
});

app.post('/api/webauthn/login/verify', async (req, res) => {
  const user = findUser(req.body?.username);
  if (!user) return res.status(404).json({ error: 'unknown user' });
  const cred = (user.credentials || []).find(c => c.id === req.body.response?.id || c.id === req.body.id);
  const stored = cred || (user.credentials || [])[0];
  if (!stored) return res.status(400).json({ error: 'no credential' });
  try {
    const verification = await verifyAuthenticationResponse({
      response: req.body.response || req.body,
      expectedChallenge: challenges.get(user.username),
      expectedOrigin: ORIGIN, expectedRPID: RP_ID,
      credential: {
        id: stored.id,
        publicKey: new Uint8Array(Buffer.from(stored.publicKey, 'base64')),
        counter: stored.counter,
      },
    });
    if (!verification.verified) return res.status(401).json({ error: 'fingerprint not verified' });
    stored.counter = verification.authenticationInfo.newCounter;
    persist();
    res.json({ token: issueToken(user.username), user: publicUser(user) });
  } catch (e) { res.status(401).json({ error: e.message }); }
});

// ---------- presence ----------
const online = new Map();   // username -> Set(socketId)
function isOnline(u) { return online.has(u) && online.get(u).size > 0; }
function setOnline(u, sid, on) {
  if (on) { (online.get(u) || online.set(u, new Set()).get(u)).add(sid); }
  else { online.get(u)?.delete(sid); if (online.get(u)?.size === 0) online.delete(u); }
}
function broadcastPresence() {
  io.emit('presence', { online: [...online.keys()] });
}

// contact list for a user: all known users (except self) + their groups
function contactsFor(username) {
  const dms = Object.values(db.users)
    .filter(u => u.username !== username)
    .map(u => ({ type: 'dm', id: dmId(username, u.username), username: u.username, color: u.color, bot: !!u.bot }));
  const groups = Object.values(db.groups)
    .filter(g => g.members.includes(username))
    .map(g => ({ type: 'group', id: g.id, name: g.name, color: g.color, members: g.members }));
  return [...groups, ...dms];
}

// Only authenticated sockets may connect
io.use((socket, next) => {
  const u = userFromToken(socket.handshake.auth?.token);
  if (!u || !db.users[u]) return next(new Error('unauthorized'));
  socket.data.username = u;
  next();
});

io.on('connection', (socket) => {
  const me = socket.data.username;
  socket.join('user:' + me);
  setOnline(me, socket.id, true);
  socket.emit('ready', { me, color: db.users[me].color });
  socket.emit('contacts', contactsFor(me));
  broadcastPresence();

  socket.on('history', (conversationId, ack) => {
    ack?.({ messages: db.messages[conversationId] || [] });
  });

  socket.on('createGroup', ({ name, members }, ack) => {
    if (!me) return;
    const id = 'group:' + Math.abs(hashStr(name + Date.now())) .toString(36);
    const all = Array.from(new Set([me, ...(members || [])]));
    db.groups[id] = { id, name: String(name).slice(0, 40) || 'Group', members: all, color: colorFor(id) };
    persist();
    all.forEach(u => io.to('user:' + u).emit('contacts', contactsFor(u)));
    ack?.({ id });
  });

  socket.on('typing', ({ conversationId, to, isGroup }) => {
    if (!me) return;
    relay(conversationId, to, isGroup, 'typing', { conversationId, from: me });
  });

  socket.on('message', async (payload, ack) => {
    if (!me) return;
    const { conversationId, to, isGroup, type, content, meta } = payload;
    const msg = {
      id: 'm' + Math.abs(hashStr(me + content + (db.messages[conversationId]?.length || 0))) + Date.now().toString(36),
      conversationId, from: me, type: type || 'text', content, meta: meta || null,
      ts: Date.now(), status: 'sent'
    };
    pushMessage(conversationId, msg);
    ack?.({ msg });
    relay(conversationId, to, isGroup, 'message', msg);

    // AI assistant auto-reply (text only)
    if (!isGroup && to === AI_USER) {
      handleAi(conversationId, me);
    }
  });

  socket.on('read', ({ conversationId, to, isGroup }) => {
    if (!me) return;
    relay(conversationId, to, isGroup, 'read', { conversationId, by: me });
  });

  // ---- WebRTC signaling (1:1 voice calls) ----
  ['call:offer', 'call:answer', 'call:ice', 'call:hangup', 'call:reject', 'call:ringing'].forEach(ev => {
    socket.on(ev, (data) => {
      if (!me || !data?.to) return;
      io.to('user:' + data.to).emit(ev, { ...data, from: me });
    });
  });

  socket.on('disconnect', () => {
    if (me) { setOnline(me, socket.id, false); broadcastPresence(); }
  });

  function relay(conversationId, to, isGroup, event, data) {
    if (isGroup) {
      const g = db.groups[conversationId];
      g?.members.forEach(u => { if (u !== me) io.to('user:' + u).emit(event, data); });
    } else if (to) {
      io.to('user:' + to).emit(event, data);   // peer
    }
  }
});

async function handleAi(conversationId, human) {
  try {
    io.to('user:' + human).emit('typing', { conversationId, from: AI_USER });
    const hist = (db.messages[conversationId] || [])
      .filter(m => m.type === 'text')
      .slice(-20)
      .map(m => ({ role: m.from === AI_USER ? 'assistant' : 'user', content: m.content }));

    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: hist, stream: false })
    });
    const data = await r.json();
    const text = data?.message?.content || '(no response)';
    const msg = {
      id: 'm' + Date.now().toString(36), conversationId, from: AI_USER,
      type: 'text', content: text, ts: Date.now(), status: 'sent'
    };
    pushMessage(conversationId, msg);
    io.to('user:' + human).emit('message', msg);
  } catch (e) {
    io.to('user:' + human).emit('message', {
      id: 'e' + Date.now().toString(36), conversationId, from: AI_USER,
      type: 'text', content: 'AI error: ' + e.message, ts: Date.now()
    });
  }
}

// ===================== AI Interview Recruiter =====================
async function ollamaChat(messages, { json = false } = {}) {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, stream: false, ...(json ? { format: 'json' } : {}) })
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return d?.message?.content || '';
}
function safeJson(txt, fallback) {
  try { return JSON.parse(txt); } catch {}
  const m = txt.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return fallback;
}
function profileLine(p) {
  return `Field: ${p.field}; Target role: ${p.role}; Target company: ${p.company || 'general'}; ` +
         `Experience: ${p.experience || 'unspecified'}; Focus areas: ${p.focus || 'general'}.`;
}

// Generate the next interview question (adaptive, role + company specific)
app.post('/api/interview/question', async (req, res) => {
  try {
    const { profile, history = [], index = 0, total = 5 } = req.body;
    const sys = `You are a senior technical interviewer and recruiter conducting a REAL job interview.
Candidate profile -> ${profileLine(profile)}
Ask ONE interview question at a time, tailored to the role AND the specific company's known interview style and values.
Progress naturally: start lighter, then go deeper (technical depth, behavioral, role-specific, company-specific).
This is question ${index + 1} of ${total}. Do NOT repeat earlier questions. Keep it concise (1-3 sentences).
Return JSON: {"question": "...", "rationale": "what this probes"}.`;
    const msgs = [{ role: 'system', content: sys }];
    history.forEach(h => {
      msgs.push({ role: 'assistant', content: 'Q: ' + h.question });
      if (h.answer) msgs.push({ role: 'user', content: 'A: ' + h.answer });
    });
    msgs.push({ role: 'user', content: index === 0 ? 'Begin the interview with your first question.' : 'Ask the next question.' });
    const out = safeJson(await ollamaChat(msgs, { json: true }), { question: 'Tell me about a challenging project you worked on.', rationale: 'general' });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Evaluate the full interview across multiple parameters
app.post('/api/interview/evaluate', async (req, res) => {
  try {
    const { profile, transcript = [], metrics = {} } = req.body;
    const sys = `You are an expert interview evaluator. Score this candidate STRICTLY and fairly.
Candidate profile -> ${profileLine(profile)}
Speaking metrics (from speech analysis): words/min=${metrics.wpm || 'n/a'}, filler words=${metrics.fillers ?? 'n/a'}, avg answer length=${metrics.avgWords || 'n/a'} words.
Evaluate these parameters, each scored 0-100 with a one-line justification:
- technical: correctness & depth for the role
- communication: clarity & structure of answers
- fluency: use the speaking metrics + answer quality (penalize many fillers / very low wpm)
- roleFit: suitability for the target role
- companyFit: alignment with the target company's values/bar
- problemSolving: reasoning quality
Return JSON exactly:
{"scores":{"technical":n,"communication":n,"fluency":n,"roleFit":n,"companyFit":n,"problemSolving":n},
 "overall":n,"verdict":"Strong Hire|Hire|Lean Hire|No Hire",
 "strengths":["..."],"improvements":["..."],
 "perParameter":{"technical":"...","communication":"...","fluency":"...","roleFit":"...","companyFit":"...","problemSolving":"..."},
 "summary":"2-3 sentence overall summary"}`;
    const qa = transcript.map((t, i) => `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.answer || '(no answer)'}`).join('\n\n');
    const out = safeJson(
      await ollamaChat([{ role: 'system', content: sys }, { role: 'user', content: qa || 'No answers given.' }], { json: true }),
      null
    );
    if (!out) return res.status(500).json({ error: 'evaluation failed' });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

httpServer.listen(port, () => console.log(`Chat running at http://localhost:${port}`));
