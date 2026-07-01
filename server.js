import express from 'express';
import dotenv from 'dotenv';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import { randomBytes } from 'crypto';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', true);
const httpServer = createServer(app);
const io = new Server(httpServer, { maxHttpBufferSize: 1e7 });
const port = process.env.PORT || 3000;

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const AI_USER = 'AI Assistant';

const RP_NAME = 'DivineChat';
function rpFromReq(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${port}`;
  const hostname = host.split(':')[0];
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
  return { rpID: process.env.RP_ID || hostname, origin: process.env.ORIGIN || `${proto}://${host}` };
}

// ===================== MONGODB CONFIG =====================
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('MongoDB connected successfully');
    const ai = await User.findOne({ username: AI_USER });
    if (!ai) await User.create({ username: AI_USER, color: '#10a37f', bot: true, credentials: [], createdAt: Date.now() });
  })
  .catch(err => console.error('MongoDB connection error:', err));

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true }, color: String, passHash: String,
  profilePic: String, 
  credentials: Array, bot: { type: Boolean, default: false }, createdAt: Number
});
const User = mongoose.model('User', UserSchema);

const MessageSchema = new mongoose.Schema({
  id: String, conversationId: String, from: String, type: String,
  content: String, meta: mongoose.Schema.Types.Mixed, ts: Number, status: String
});
const Message = mongoose.model('Message', MessageSchema);

const GroupSchema = new mongoose.Schema({
  id: { type: String, unique: true }, name: String, members: [String], color: String
});
const Group = mongoose.model('Group', GroupSchema);

// ===================== CLOUDINARY CONFIG =====================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: { folder: 'divinechat_uploads', resource_type: 'auto' },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ===================== UTILS =====================
const COLORS = ['#e74c3c','#3498db','#9b59b6','#e67e22','#1abc9c','#f39c12','#2ecc71','#fd79a8','#0984e3'];
function colorFor(name) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}
function dmId(a, b) { return 'dm:' + [a, b].sort().join('|'); }
function hashStr(s){let h=0;for(const c of s)h=(h*31+c.charCodeAt(0))|0;return h;}

app.use(express.json({ limit: '12mb' }));
app.use(express.static(join(__dirname, 'public')));

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  res.json({ url: req.file.path, name: req.file.originalname, size: req.file.size });
});

// ===================== AUTH & USERS =====================
const tokens = new Map();
const challenges = new Map();
const VALID_NAME = /^[a-zA-Z0-9_.]{3,24}$/;

async function findUser(name) {
  if (!name) return null;
  return await User.findOne({ username: new RegExp('^' + name + '$', 'i') });
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
const publicUser = (u) => ({ username: u.username, color: u.color, profilePic: u.profilePic, hasFingerprint: (u.credentials || []).length > 0 });

app.post('/api/register', async (req, res) => {
  let { username, password } = req.body || {};
  username = String(username || '').trim();
  if (!VALID_NAME.test(username)) return res.status(400).json({ error: 'Username must be 3-24 chars.' });
  if (username.toLowerCase() === AI_USER.toLowerCase()) return res.status(400).json({ error: 'Name reserved' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password too short' });
  if (await findUser(username)) return res.status(409).json({ error: 'Username taken' });
  
  const passHash = await bcrypt.hash(password, 10);
  const newUser = await User.create({ username, color: colorFor(username), passHash, credentials: [], createdAt: Date.now() });
  res.json({ token: issueToken(newUser.username), user: publicUser(newUser) });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = await findUser(username);
  if (!user || !user.passHash) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(String(password || ''), user.passHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ token: issueToken(user.username), user: publicUser(user) });
});

app.get('/api/me', authREST, async (req, res) => {
  const u = await User.findOne({ username: req.username });
  res.json({ user: publicUser(u) });
});

app.post('/api/user/avatar', authREST, async (req, res) => {
  await User.updateOne({ username: req.username }, { $set: { profilePic: req.body.url } });
  res.json({ success: true, url: req.body.url });
  // Broadcast contact update so others see the new picture
  const allOnline = [...online.keys()];
  for (const user of allOnline) {
      io.to('user:' + user).emit('contacts', await contactsFor(user));
  }
});

app.post('/api/webauthn/register/options', authREST, async (req, res) => {
  const user = await User.findOne({ username: req.username });
  const { rpID } = rpFromReq(req);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME, rpID, userName: user.username, attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    excludeCredentials: (user.credentials || []).map(c => ({ id: c.id })),
  });
  challenges.set(user.username, options.challenge);
  res.json(options);
});

app.post('/api/webauthn/register/verify', authREST, async (req, res) => {
  const user = await User.findOne({ username: req.username });
  const { rpID, origin } = rpFromReq(req);
  try {
    const verification = await verifyRegistrationResponse({
      response: req.body, expectedChallenge: challenges.get(user.username), expectedOrigin: origin, expectedRPID: rpID,
    });
    if (!verification.verified || !verification.registrationInfo) return res.status(400).json({ error: 'failed' });
    const { credential } = verification.registrationInfo;
    user.credentials.push({ id: credential.id, publicKey: Buffer.from(credential.publicKey).toString('base64'), counter: credential.counter });
    await user.save();
    res.json({ verified: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/webauthn/login/options', async (req, res) => {
  const user = await findUser(req.body?.username);
  if (!user || !(user.credentials || []).length) return res.status(404).json({ error: 'No fingerprint' });
  const { rpID } = rpFromReq(req);
  const options = await generateAuthenticationOptions({ rpID, allowCredentials: user.credentials.map(c => ({ id: c.id })), userVerification: 'preferred' });
  challenges.set(user.username, options.challenge);
  res.json(options);
});

app.post('/api/webauthn/login/verify', async (req, res) => {
  const user = await findUser(req.body?.username);
  if (!user) return res.status(404).json({ error: 'unknown user' });
  const cred = (user.credentials || []).find(c => c.id === req.body.response?.id || c.id === req.body.id);
  const stored = cred || (user.credentials || [])[0];
  if (!stored) return res.status(400).json({ error: 'no credential' });
  const { rpID, origin } = rpFromReq(req);
  try {
    const verification = await verifyAuthenticationResponse({
      response: req.body.response || req.body, expectedChallenge: challenges.get(user.username),
      expectedOrigin: origin, expectedRPID: rpID,
      credential: { id: stored.id, publicKey: new Uint8Array(Buffer.from(stored.publicKey, 'base64')), counter: stored.counter },
    });
    if (!verification.verified) return res.status(401).json({ error: 'fingerprint not verified' });
    await User.updateOne({ username: user.username, "credentials.id": stored.id }, { $set: { "credentials.$.counter": verification.authenticationInfo.newCounter } });
    res.json({ token: issueToken(user.username), user: publicUser(user) });
  } catch (e) { res.status(401).json({ error: e.message }); }
});

// ===================== WEBSOCKETS =====================
const online = new Map();
function setOnline(u, sid, on) {
  if (on) { (online.get(u) || online.set(u, new Set()).get(u)).add(sid); }
  else { online.get(u)?.delete(sid); if (online.get(u)?.size === 0) online.delete(u); }
}
function broadcastPresence() { io.emit('presence', { online: [...online.keys()] }); }

async function contactsFor(username) {
  const users = await User.find({ username: { $ne: username } }).lean();
  const dms = users.map(u => ({ type: 'dm', id: dmId(username, u.username), username: u.username, color: u.color, profilePic: u.profilePic, bot: !!u.bot }));
  const groups = await Group.find({ members: username }).lean();
  const formattedGroups = groups.map(g => ({ type: 'group', id: g.id, name: g.name, color: g.color, members: g.members }));
  return [...formattedGroups, ...dms];
}

io.use(async (socket, next) => {
  const u = userFromToken(socket.handshake.auth?.token);
  if (!u) return next(new Error('unauthorized'));
  const user = await User.findOne({ username: u });
  if (!user) return next(new Error('unauthorized'));
  socket.data.username = u;
  socket.data.color = user.color;
  next();
});

io.on('connection', async (socket) => {
  const me = socket.data.username;
  socket.join('user:' + me);
  setOnline(me, socket.id, true);
  socket.emit('ready', { me, color: socket.data.color });
  socket.emit('contacts', await contactsFor(me));
  broadcastPresence();

  socket.on('history', async (conversationId, ack) => {
    const messages = await Message.find({ conversationId }).sort({ ts: 1 }).limit(100).lean();
    ack?.({ messages });
  });

  socket.on('createGroup', async ({ name, members }, ack) => {
    if (!me) return;
    const id = 'group:' + Math.abs(hashStr(name + Date.now())).toString(36);
    const all = Array.from(new Set([me, ...(members || [])]));
    await Group.create({ id, name: String(name).slice(0, 40) || 'Group', members: all, color: colorFor(id) });
    all.forEach(async u => io.to('user:' + u).emit('contacts', await contactsFor(u)));
    ack?.({ id });
  });

  socket.on('typing', async ({ conversationId, to, isGroup }) => {
    if (!me) return;
    await relay(conversationId, to, isGroup, 'typing', { conversationId, from: me });
  });

  socket.on('message', async (payload, ack) => {
    if (!me) return;
    const { conversationId, to, isGroup, type, content, meta } = payload;
    const msgCount = await Message.countDocuments({ conversationId });
    const msg = {
      id: 'm' + Math.abs(hashStr(me + content + msgCount)) + Date.now().toString(36),
      conversationId, from: me, type: type || 'text', content, meta: meta || null,
      ts: Date.now(), status: 'sent'
    };
    
    await Message.create(msg);
    ack?.({ msg });
    await relay(conversationId, to, isGroup, 'message', msg);

    if (to !== AI_USER && !isGroup) {
      const sceneContext = keywordScene(content);
      const userDoc = await User.findOne({username: me}).lean();
      const sceneEvent = { environment: sceneContext.preset, mood: sceneContext.mood, actor: me, actorPic: userDoc?.profilePic, animation: 'talk' };
      await relay(conversationId, to, isGroup, 'scene_update', sceneEvent);
      socket.emit('scene_update', sceneEvent); 
    }

    if (!isGroup && to === AI_USER) handleAi(conversationId, me);
  });

  socket.on('read', async ({ conversationId, to, isGroup }) => {
    if (!me) return;
    await relay(conversationId, to, isGroup, 'read', { conversationId, by: me });
  });

  ['call:offer', 'call:answer', 'call:ice', 'call:hangup', 'call:reject', 'call:ringing'].forEach(ev => {
    socket.on(ev, (data) => {
      if (!me || !data?.to) return;
      io.to('user:' + data.to).emit(ev, { ...data, from: me });
    });
  });

  socket.on('disconnect', () => {
    if (me) { setOnline(me, socket.id, false); broadcastPresence(); }
  });

  async function relay(conversationId, to, isGroup, event, data) {
    if (isGroup) {
      const g = await Group.findOne({ id: conversationId });
      g?.members.forEach(u => { if (u !== me) io.to('user:' + u).emit(event, data); });
    } else if (to) {
      io.to('user:' + to).emit(event, data);   
    }
  }
});

// ===================== THE AI SCENE DIRECTOR =====================
async function handleAi(conversationId, human) {
  try {
    io.to('user:' + human).emit('typing', { conversationId, from: AI_USER });
    const histDocs = await Message.find({ conversationId, type: 'text' }).sort({ts: 1}).limit(20).lean();
    const hist = histDocs.map(m => ({ role: m.from === AI_USER ? 'assistant' : 'user', content: m.content }));

    const sysPrompt = {
      role: 'system',
      content: `You are an AI chat assistant and a 3D Scene Director. 
      Respond to the user naturally, but you MUST output your response in JSON format.
      Included in the JSON should be your text reply, the environment setting, and your avatar's animation.
      Allowed environments: ${DREAM_PRESETS.join(', ')}.
      Allowed animations: idle, wave, nod, shake_head, laugh, think, point, talk.
      Format EXACTLY as: {"reply": "your text here", "environment": "forest", "animation": "wave"}`
    };
    
    const messages = [sysPrompt, ...hist];
    const aiResponseStr = await ollamaChat(messages, { json: true });
    const aiResponse = safeJson(aiResponseStr, { reply: aiResponseStr || "(no response)", environment: "clouds", animation: "idle" });

    const msg = {
      id: 'm' + Date.now().toString(36), conversationId, from: AI_USER,
      type: 'text', content: aiResponse.reply, 
      meta: { environment: aiResponse.environment, animation: aiResponse.animation }, ts: Date.now(), status: 'sent'
    };
    
    await Message.create(msg);
    io.to('user:' + human).emit('message', msg);
    
    const aiDoc = await User.findOne({username: AI_USER}).lean();
    io.to('user:' + human).emit('scene_update', {
       environment: aiResponse.environment, animation: aiResponse.animation, actor: AI_USER, actorPic: aiDoc?.profilePic
    });
  } catch (e) {
    const errMsg = { id: 'e' + Date.now().toString(36), conversationId, from: AI_USER, type: 'text', content: 'AI error: ' + e.message, ts: Date.now() };
    await Message.create(errMsg);
    io.to('user:' + human).emit('message', errMsg);
  }
}

// ===================== AI HELPERS & RECRUITER =====================
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
  return `Field: ${p.field}; Target role: ${p.role}; Target company: ${p.company || 'general'}; Experience: ${p.experience || 'unspecified'}; Focus areas: ${p.focus || 'general'}.`;
}

app.post('/api/interview/question', async (req, res) => {
  try {
    const { profile, history = [], index = 0, total = 5 } = req.body;
    const sys = `You are a senior technical interviewer and recruiter conducting a REAL job interview. Candidate profile -> ${profileLine(profile)}\nAsk ONE interview question at a time. Progress naturally: start lighter, then go deeper. This is question ${index + 1} of ${total}. Return JSON: {"question": "...", "rationale": "what this probes"}.`;
    const msgs = [{ role: 'system', content: sys }];
    history.forEach(h => { msgs.push({ role: 'assistant', content: 'Q: ' + h.question }); if (h.answer) msgs.push({ role: 'user', content: 'A: ' + h.answer }); });
    msgs.push({ role: 'user', content: index === 0 ? 'Begin the interview.' : 'Ask the next question.' });
    const out = safeJson(await ollamaChat(msgs, { json: true }), { question: 'Tell me about a challenging project.', rationale: 'general' });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/interview/evaluate', async (req, res) => {
  try {
    const { profile, transcript = [], metrics = {} } = req.body;
    const sys = `You are an expert interview evaluator. Score this candidate STRICTLY. Candidate profile -> ${profileLine(profile)}\nSpeaking metrics: wpm=${metrics.wpm || 'n/a'}, fillers=${metrics.fillers ?? 'n/a'}, avg len=${metrics.avgWords || 'n/a'} words. Evaluate parameters (0-100): technical, communication, fluency, roleFit, companyFit, problemSolving.\nReturn JSON exactly: {"scores":{"technical":n,"communication":n,"fluency":n,"roleFit":n,"companyFit":n,"problemSolving":n},"overall":n,"verdict":"Hire|No Hire","strengths":["..."],"improvements":["..."],"perParameter":{...},"summary":"..."}`;
    const qa = transcript.map((t, i) => `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.answer || '(no answer)'}`).join('\n\n');
    const out = safeJson(await ollamaChat([{ role: 'system', content: sys }, { role: 'user', content: qa || 'No answers given.' }], { json: true }), null);
    if (!out) return res.status(500).json({ error: 'evaluation failed' });
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const DREAM_PRESETS = ['space', 'forest', 'rain-city', 'beach', 'snow', 'underwater', 'fire', 'clouds'];
function keywordScene(text = '') {
  const t = text.toLowerCase();
  const has = (...w) => w.some(x => t.includes(x));
  let preset = 'clouds';
  if (has('space', 'star', 'galaxy', 'moon', 'planet', 'universe')) preset = 'space';
  else if (has('forest', 'tree', 'jungle', 'nature', 'green')) preset = 'forest';
  else if (has('rain', 'city', 'street', 'tokyo', 'neon', 'cyber', 'sad')) preset = 'rain-city';
  else if (has('beach', 'ocean', 'sea', 'sand', 'sunset')) preset = 'beach';
  else if (has('snow', 'winter', 'cold', 'ice', 'frozen')) preset = 'snow';
  else if (has('water', 'underwater', 'fish', 'dive', 'deep')) preset = 'underwater';
  else if (has('fire', 'angry', 'rage', 'burn', 'hot')) preset = 'fire';
  const moods = { space: 'dreamy', forest: 'calm', 'rain-city': 'melancholic', beach: 'happy', snow: 'serene', underwater: 'mysterious', fire: 'intense', clouds: 'peaceful' };
  return { preset, mood: moods[preset], caption: text.slice(0, 60) };
}

app.post('/api/dream/scene', async (req, res) => {
  const { text = '' } = req.body || {};
  const fallback = keywordScene(text);
  try {
    const sys = `You turn a chat message into a 3D dream scene. Pick the single best preset that matches the message's setting OR emotion. Allowed presets: ${DREAM_PRESETS.join(', ')}. Return JSON exactly: {"preset":"one-of-allowed","mood":"one word","caption":"<=8 word poetic line about the scene"}`;
    const out = safeJson(await ollamaChat([{ role: 'system', content: sys }, { role: 'user', content: text || 'a quiet moment' }], { json: true }), fallback);
    if (!DREAM_PRESETS.includes(out.preset)) out.preset = fallback.preset;
    res.json({ preset: out.preset, mood: out.mood || fallback.mood, caption: out.caption || fallback.caption });
  } catch { res.json(fallback); }
});

httpServer.listen(port, () => console.log(`Chat running at http://localhost:${port}`));