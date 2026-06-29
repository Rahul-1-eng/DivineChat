<div align="center">

# 💬 DivineChat

**A real-time chat app with an AI that actually talks back — and an AI recruiter that interviews you on camera.**

Built to run entirely on your own machine. No cloud bills, no API keys, your data stays yours.

[Features](#what-it-does) · [Quick start](#get-it-running-in-5-minutes) · [How it works](#whats-under-the-hood) · [Deploy](#putting-it-online) · [Roadmap](#whats-next)

</div>

---

## The short version

I wanted a chat app that didn't phone home to anyone. So this one runs a language model **locally** (through [Ollama](https://ollama.com)) and keeps everything — accounts, messages, files — on your own box.

Then it kind of grew. Now it does real-time messaging like WhatsApp, voice calls, an AI assistant you can chat with, and a full **AI interview recruiter** that runs a live on-camera mock interview and grades you on fluency, technical depth, and how well you'd fit a specific role and company.

It's a learning/portfolio project, but it's a *real* one — proper password auth, fingerprint login, the works.

---

## What it does

### 🗨️ Messaging that feels alive
- **1-on-1 DMs and group chats**, in real time over WebSockets
- Online/offline presence dots, **typing indicators**, and blue **read receipts**
- Unread badges and last-message previews in the sidebar
- A full **emoji picker**, **image sharing**, and **hold-to-record voice notes**

### 📞 Actual voice calls
- Peer-to-peer **WebRTC** audio calls between users — ringing, accept/decline, mute, hang up
- No media server in the middle; the audio goes straight between the two browsers

### 🤖 A local AI you can chat with
- There's an **AI Assistant** contact wired straight to your local model
- Ask it anything in a normal chat thread — it replies inline, with a typing indicator

### 💼 The AI Interview Recruiter (the fun one)
- Tell it your **field, target role, target company, and experience**
- It runs a **live, on-camera interview** — speaks each question out loud, listens to your spoken answers, and adapts the next question to what you said
- At the end you get a **scorecard**: technical, communication, **fluency** (measured from your actual speaking pace and filler words), role fit, company fit, and problem-solving — plus strengths, things to work on, and a hire verdict

### 🔐 Real accounts
- **Unique usernames** (case-insensitive — `Alice` and `alice` can't both exist)
- Passwords hashed with **bcrypt** (never stored in plain text)
- Optional **fingerprint / Face ID login** via WebAuthn — enroll your device's biometrics and skip the password next time

### ✨ And it looks the part
- Animated aurora background, light/dark themes, sound effects, spring-y micro-interactions, count-up score animations. It's meant to feel like a polished product, not a class assignment.

---

## Get it running in 5 minutes

You'll need **[Node.js](https://nodejs.org) 18+** and **[Ollama](https://ollama.com/download)**.

```bash
# 1. Clone and install
git clone https://github.com/YOUR_USERNAME/divinechat.git
cd divinechat
npm install

# 2. Set up your config
cp .env.example .env          # the defaults work as-is for local use

# 3. Pull a model for the AI features (≈2 GB, one time)
ollama pull llama3.2

# 4. Start it
npm start
```

Now open **http://localhost:3000**, click **Sign up**, and you're in.

> **Want to see two people chatting?** Open the site in a second browser (or an incognito window), sign up as a different user, and message between them. They'll show up in each other's sidebars instantly.

---

## A couple of things worth knowing

- **Use Chrome or Edge** for the full experience. The interview's live speech-to-text uses the Web Speech API, which is Chromium-only (other browsers fall back to typing your answers). Camera, calls, and TTS work everywhere.
- **Voice calls and microphone need `localhost` or HTTPS.** Browsers block the mic on plain `http://` over a network — that's a browser rule, not a bug. Locally you're fine.
- **Fingerprint login is per-device.** It's tied to the biometric hardware on the machine you enroll from — that's how WebAuthn is supposed to work.

---

## What's under the hood

```
Browser  ──HTTP──▶  Express        (login, signup, file uploads, interview API)
   │
   └──WebSocket──▶  Socket.IO       (messages, presence, typing, WebRTC signaling)
                       │
                       └──HTTP──▶   Ollama   (the local AI model)

Browser ◀──WebRTC (peer-to-peer)──▶ Browser   (voice call audio, no server in between)
```

| Piece | What it's doing |
|-------|-----------------|
| **Express** | Serves the app, handles auth + uploads, and the interview endpoints |
| **Socket.IO** | All the real-time stuff: messages, who's online, typing, and relaying WebRTC offers |
| **Ollama** | Runs the language model locally — powers the AI assistant and the interviewer |
| **bcryptjs** | Hashes passwords |
| **@simplewebauthn** | The fingerprint / biometric login |
| **WebRTC** | Direct browser-to-browser voice calls |
| **Vanilla JS + CSS** | The whole frontend — no framework, no build step |

Accounts and messages live in a simple `db.json` file. Easy to inspect, easy to reset (just delete it). For a bigger deployment you'd swap this for a real database — see below.

### Project layout

```
divinechat/
├── server.js            # the backend: auth, sockets, uploads, AI + interview APIs
├── public/
│   ├── index.html       # the whole UI
│   ├── app.js           # chat, calls, auth, presence
│   ├── interview.js     # the AI interview recruiter
│   ├── style.css        # base styles
│   ├── animations.css   # the motion layer
│   └── fx.js / fx.css   # aurora background, sounds, theme toggle
├── .env.example         # copy to .env
└── db.json              # created on first run (gitignored)
```

---

## Putting it online

Heads up: **this won't run on Vercel or Netlify.** Those are for static sites and short serverless functions — but DivineChat needs a server that stays running (for WebSockets) and can reach Ollama. So you want a host that runs a real Node process: **[Render](https://render.com), [Railway](https://railway.app), [Fly.io](https://fly.io)**, or any VPS.

The other catch: **the host needs the AI model too.** Two ways to handle that:
1. **Run Ollama on the same server** (a VPS with enough RAM is simplest), or
2. **Point `OLLAMA_URL` at a separate machine** running Ollama (your own box, or a GPU host).

### Deploying to Render (example)

1. Push this repo to GitHub (next section).
2. On Render: **New → Web Service**, connect your repo.
3. Set **Build command** `npm install` and **Start command** `npm start`.
4. Add environment variables (from your `.env`):
   - `OLLAMA_URL` → wherever your model is reachable
   - `OLLAMA_MODEL` → `llama3.2`
   - `RP_ID` → your domain, e.g. `divinechat.onrender.com`
   - `ORIGIN` → `https://divinechat.onrender.com`
5. Deploy. Render gives you HTTPS automatically — which is exactly what voice calls and fingerprint login need. 🎉

> **Going to production for real?** Swap `db.json` for a proper database (Postgres, Mongo, etc.) and move uploaded files to object storage like S3. The current file-based setup is great for development and demos, not for scale.

---

## Pushing to GitHub

First time with this repo? From the project folder:

```bash
# make sure secrets won't be committed (the .gitignore already handles this)
git init
git add .
git commit -m "Initial commit: DivineChat"
```

Then create an **empty** repo on github.com (don't add a README — you already have one), and connect it:

```bash
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/divinechat.git
git push -u origin main
```

After that, the usual loop:

```bash
git add .
git commit -m "describe what you changed"
git push
```

> **Double-check before your first push:** run `git status` and make sure `.env` and `db.json` are **not** in the list. They're gitignored, so they shouldn't be — but it's worth a glance, because those hold your secrets and user data.

---

## What's next

Ideas I haven't built yet (forks and PRs welcome):

- [ ] **Video** calls (the WebRTC plumbing is already there — it's a small step from voice)
- [ ] Send the AI an **image to analyze** (needs a vision model like `llava`)
- [ ] **Offline** speech-to-text with local Whisper, so the interview needs zero internet
- [ ] Message reactions, replies, and deletion
- [ ] A real database + cloud file storage for production
- [ ] Body-language scoring in the interview (eye contact, posture) via a vision model

---

## License

MIT — do whatever you like with it. If it helps you land a job or learn something, that's the whole point.

<div align="center">
<sub>Runs on your machine. Powered by <a href="https://ollama.com">Ollama</a>. No clouds were billed in the making of this app.</sub>
</div>
