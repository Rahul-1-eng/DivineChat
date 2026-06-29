/* ===================== FX: aurora bg + sounds + theme ===================== */
(() => {
  /* ---------- Aurora / particle background ---------- */
  const canvas = document.getElementById('fx-bg');
  const ctx = canvas.getContext('2d');
  let w, h, blobs = [], particles = [];

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  const palettes = {
    dark:  [[0,168,132], [0,120,200], [90,60,180]],
    light: [[0,168,132], [80,180,255], [150,120,255]]
  };
  function curPalette() {
    return document.body.dataset.theme === 'light' ? palettes.light : palettes.dark;
  }

  function rand(a, b) { return a + Math.random() * (b - a); }
  function initScene() {
    blobs = Array.from({ length: 5 }, (_, i) => ({
      x: rand(0, w), y: rand(0, h),
      r: rand(180, 360),
      dx: rand(-0.25, 0.25), dy: rand(-0.25, 0.25),
      ci: i % 3, phase: rand(0, Math.PI * 2)
    }));
    particles = Array.from({ length: 60 }, () => ({
      x: rand(0, w), y: rand(0, h), r: rand(0.6, 2.2),
      dx: rand(-0.15, 0.15), dy: rand(-0.3, -0.05), a: rand(0.1, 0.5)
    }));
  }
  initScene();

  let t = 0;
  function draw() {
    t += 0.005;
    ctx.clearRect(0, 0, w, h);
    const pal = curPalette();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of blobs) {
      b.x += b.dx + Math.sin(t + b.phase) * 0.3;
      b.y += b.dy + Math.cos(t + b.phase) * 0.3;
      if (b.x < -b.r) b.x = w + b.r; if (b.x > w + b.r) b.x = -b.r;
      if (b.y < -b.r) b.y = h + b.r; if (b.y > h + b.r) b.y = -b.r;
      const [r, g, bl] = pal[b.ci];
      const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      const op = document.body.dataset.theme === 'light' ? 0.10 : 0.16;
      grad.addColorStop(0, `rgba(${r},${g},${bl},${op})`);
      grad.addColorStop(1, `rgba(${r},${g},${bl},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    }
    // floating particles
    for (const p of particles) {
      p.x += p.dx; p.y += p.dy;
      if (p.y < -5) { p.y = h + 5; p.x = rand(0, w); }
      if (p.x < -5) p.x = w + 5; if (p.x > w + 5) p.x = -5;
      ctx.fillStyle = `rgba(255,255,255,${p.a * (document.body.dataset.theme === 'light' ? 0.4 : 1)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    requestAnimationFrame(draw);
  }
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) draw();

  /* ---------- Sound effects (WebAudio, no files) ---------- */
  let actx = null;
  const ensureAudio = () => { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); return actx; };
  document.addEventListener('click', () => { ensureAudio(); if (actx?.state === 'suspended') actx.resume(); }, { once: true });

  function tone(freq, dur, { type = 'sine', vol = 0.18, sweep = 0, delay = 0 } = {}) {
    if (soundsOff) return;
    const a = ensureAudio(); if (!a) return;
    const now = a.currentTime + delay;
    const osc = a.createOscillator(), g = a.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, now);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(freq + sweep, now + dur);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g); g.connect(a.destination);
    osc.start(now); osc.stop(now + dur + 0.02);
  }

  let soundsOff = localStorage.getItem('dc_sound') === 'off';
  const sounds = {
    send:    () => tone(520, 0.12, { type: 'triangle', sweep: 260, vol: 0.14 }),
    receive: () => { tone(700, 0.10, { type: 'sine', vol: 0.13 }); tone(900, 0.12, { type: 'sine', vol: 0.10, delay: 0.07 }); },
    click:   () => tone(330, 0.05, { type: 'square', vol: 0.05 }),
    ring:    () => { tone(880, 0.18, { vol: 0.12 }); tone(660, 0.18, { vol: 0.12, delay: 0.22 }); },
    success: () => { [523,659,784].forEach((f,i)=>tone(f,0.18,{type:'triangle',vol:0.13,delay:i*0.1})); },
    start:   () => tone(440, 0.25, { type: 'sine', sweep: 440, vol: 0.12 })
  };
  window.fx = {
    sound: (name) => sounds[name]?.(),
    toggleSound: () => { soundsOff = !soundsOff; localStorage.setItem('dc_sound', soundsOff ? 'off' : 'on'); return !soundsOff; },
    soundOn: () => !soundsOff
  };

  /* ---------- Theme toggle ---------- */
  const saved = localStorage.getItem('dc_theme') || 'dark';
  document.body.dataset.theme = saved;
  document.documentElement.dataset.theme = saved;

  function applyToggleVisual(btn) {
    if (!btn) return;
    btn.textContent = document.body.dataset.theme === 'light' ? '🌙' : '☀️';
  }
  window.fx.toggleTheme = (btn) => {
    document.body.dataset.theme = document.body.dataset.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('dc_theme', document.body.dataset.theme);
    applyToggleVisual(btn);
    sounds.click();
  };
  window.fx.initThemeBtn = applyToggleVisual;
})();
