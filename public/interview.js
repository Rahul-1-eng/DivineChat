/* ===================== AI Interview Recruiter ===================== */
(() => {
  const $ = (id) => document.getElementById(id);
  const overlay = $('interview');

  let profile = null;
  let total = 5, index = 0;
  let transcript = [];           // [{question, answer}]
  let currentQ = '';
  let stream = null;
  let recog = null, listening = false, answerBuf = '';
  let answerStart = 0;
  const speakStats = { totalWords: 0, totalSec: 0, fillers: 0 };
  const FILLERS = /\b(um|uh|like|you know|er|hmm|basically|actually|literally)\b/gi;

  const show = (id) => { ['iv-intake','iv-live','iv-report'].forEach(s => $(s).classList.toggle('hidden', s !== id)); };
  const openOverlay = () => { overlay.classList.remove('hidden'); show('iv-intake'); };
  const closeOverlay = () => { stopEverything(); overlay.classList.add('hidden'); };

  $('interview-btn').onclick = openOverlay;
  overlay.querySelectorAll('[data-close]').forEach(b => b.onclick = closeOverlay);
  $('iv-restart').onclick = () => { resetState(); show('iv-intake'); };

  /* ---------- Stage 1: intake ---------- */
  $('iv-start').onclick = async () => {
    const field = $('iv-field').value.trim();
    const role = $('iv-role').value.trim();
    if (!field || !role) return alert('Please enter at least a field and a target role.');
    profile = {
      field, role,
      company: $('iv-company').value.trim(),
      experience: $('iv-exp').value,
      focus: $('iv-focus').value.trim()
    };
    total = parseInt($('iv-count').value, 10);
    index = 0; transcript = [];
    $('iv-qtotal').textContent = total;

    const ok = await startCamera();
    if (!ok) return;
    show('iv-live');
    window.fx?.sound('start');
    await nextQuestion();
  };

  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      $('iv-video').srcObject = stream;
      return true;
    } catch (e) {
      alert('Camera & microphone access is required for the interview.\n' + e.message);
      return false;
    }
  }

  /* ---------- Stage 2: questions ---------- */
  async function nextQuestion() {
    $('iv-answer').disabled = true;
    $('iv-next').disabled = true;
    $('iv-question').textContent = 'Thinking of the next question…';
    $('iv-transcript').textContent = '';
    answerBuf = '';
    try {
      const r = await fetch('/api/interview/question', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, history: transcript, index, total })
      });
      const data = await r.json();
      currentQ = data.question || 'Tell me about yourself.';
    } catch {
      currentQ = 'Tell me about a project you are proud of.';
    }
    $('iv-qnum').textContent = 'Question ' + (index + 1);
    $('iv-question').textContent = currentQ;
    $('iv-answer').disabled = false;
    speak(currentQ);
  }

  let voicesReady = false;
  if ('speechSynthesis' in window) {
    const load = () => { if (window.speechSynthesis.getVoices().length) voicesReady = true; };
    load();
    window.speechSynthesis.onvoiceschanged = load;
  }
  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    synth.cancel();                              // clear any queued speech
    const utter = () => {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1; u.pitch = 1; u.volume = 1; u.lang = 'en-US';
      const v = synth.getVoices().find(x => /en[-_]/i.test(x.lang));
      if (v) u.voice = v;
      synth.speak(u);
      // Chrome sometimes pauses synthesis; nudge it
      setTimeout(() => { try { synth.resume(); } catch {} }, 250);
    };
    // speak() right after cancel() can be dropped in Chrome — give it a tick
    if (voicesReady) setTimeout(utter, 120);
    else setTimeout(() => { voicesReady = true; utter(); }, 350);
  }

  /* ---------- Speech recognition (answers) ---------- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  $('iv-answer').onclick = () => listening ? stopAnswer() : startAnswer();
  $('iv-next').onclick = () => { if (listening) stopAnswer(); commitAnswer(); };
  $('iv-end').onclick = () => { if (listening) stopAnswer(); finish(); };

  function startAnswer() {
    answerBuf = '';
    answerStart = performance.now();
    if (SR) {
      recog = new SR();
      recog.continuous = true; recog.interimResults = true; recog.lang = 'en-US';
      recog.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) answerBuf += t + ' ';
          else interim += t;
        }
        $('iv-transcript').textContent = (answerBuf + interim).trim();
      };
      recog.onerror = (e) => {
        // network / not-allowed / service-not-allowed -> let them type instead
        if (['not-allowed', 'service-not-allowed', 'network', 'audio-capture'].includes(e.error)) {
          enableTypeFallback('Speech recognition unavailable (' + e.error + '). Type your answer here.');
        }
      };
      recog.onend = () => { if (listening && !$('iv-transcript').dataset.fallback) { try { recog.start(); } catch {} } };
      try { recog.start(); } catch { enableTypeFallback('Type your answer here.'); }
    } else {
      enableTypeFallback('Voice typing not supported in this browser — type your answer here.');
    }
    listening = true;
    $('iv-answer').textContent = '⏹ Stop answering';
    $('iv-answer').classList.add('recording');
    $('iv-next').disabled = false;
  }

  function stopAnswer() {
    listening = false;
    if (recog) { try { recog.stop(); } catch {} recog = null; }
    $('iv-answer').textContent = '🎙 Resume answering';
    $('iv-answer').classList.remove('recording');
    const secs = (performance.now() - answerStart) / 1000;
    speakStats.totalSec += secs;
  }

  function enableTypeFallback(msg) {
    if (recog) { try { recog.stop(); } catch {} recog = null; }
    const box = $('iv-transcript');
    box.dataset.fallback = '1';
    box.contentEditable = 'true';
    if (!box.textContent.trim()) box.setAttribute('data-placeholder', msg || 'Type your answer here.');
    box.focus();
    $('iv-transcript-label') && ($('iv-transcript-label').textContent = '');
  }

  function currentAnswerText() {
    if ($('iv-transcript').dataset.fallback) return $('iv-transcript').textContent.trim();
    return answerBuf.trim();
  }

  function commitAnswer() {
    const answer = currentAnswerText();
    const words = answer ? answer.split(/\s+/).length : 0;
    speakStats.totalWords += words;
    speakStats.fillers += (answer.match(FILLERS) || []).length;
    transcript.push({ question: currentQ, answer });
    index++;
    if (index >= total) finish();
    else nextQuestion();
  }

  /* ---------- Stage 3: evaluation ---------- */
  async function finish() {
    // capture any in-progress answer
    if (currentQ && transcript.length < index + 1 && transcript[transcript.length - 1]?.question !== currentQ) {
      const answer = currentAnswerText();
      if (answer || currentQ) {
        speakStats.totalWords += answer ? answer.split(/\s+/).length : 0;
        transcript.push({ question: currentQ, answer });
      }
    }
    stopCamera();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    show('iv-report');
    $('iv-report-body').innerHTML = '<div class="iv-loading">Evaluating your performance…</div>';

    const wpm = speakStats.totalSec > 0 ? Math.round(speakStats.totalWords / (speakStats.totalSec / 60)) : null;
    const answered = transcript.filter(t => t.answer).length || 1;
    const metrics = { wpm, fillers: speakStats.fillers, avgWords: Math.round(speakStats.totalWords / answered) };

    try {
      const r = await fetch('/api/interview/evaluate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, transcript, metrics })
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      renderReport(data, metrics);
    } catch (e) {
      $('iv-report-body').innerHTML = `<div class="iv-loading">Evaluation failed: ${e.message}</div>`;
    }
  }

  function bar(label, val) {
    const v = Math.max(0, Math.min(100, val || 0));
    const hue = Math.round(v * 1.2);   // red->green
    return `<div class="iv-metric">
      <div class="iv-metric-top"><span>${label}</span><b data-count="${v}">0</b></div>
      <div class="iv-track"><div class="iv-fill" data-w="${v}" style="width:0%;background:hsl(${hue},70%,45%)"></div></div>
    </div>`;
  }

  // count-up + bar fill animation
  function animateNumber(el, to, dur = 900) {
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(to * eased);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function playReportAnimations() {
    const ring = document.querySelector('#iv-report .iv-score-ring span[data-count]');
    if (ring) animateNumber(ring, +ring.dataset.count, 1100);
    document.querySelectorAll('#iv-report .iv-metric b[data-count]').forEach(b => animateNumber(b, +b.dataset.count));
    requestAnimationFrame(() => {
      document.querySelectorAll('#iv-report .iv-fill[data-w]').forEach(f => { f.style.width = f.dataset.w + '%'; });
    });
  }

  const num = (v) => { const n = Number(String(v).replace(/[^\d.]/g, '')); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null; };
  const toArr = (x) => Array.isArray(x) ? x : (x ? [x] : []);

  function renderReport(d, metrics) {
    const names = {
      technical: 'Technical', communication: 'Communication', fluency: 'Fluency',
      roleFit: 'Role Fit', companyFit: 'Company Fit', problemSolving: 'Problem Solving'
    };
    // normalize scores -> numbers
    const s = {};
    Object.keys(names).forEach(k => { s[k] = num(d.scores?.[k]) ?? 0; });
    // overall: use numeric field if it really is a number, else average the scores
    let overall = num(d.overall);
    if (overall == null) {
      const vals = Object.values(s);
      overall = Math.round(vals.reduce((a, b) => a + b, 0) / (vals.length || 1));
    }
    const verdict = (typeof d.verdict === 'string' && d.verdict) || (overall >= 75 ? 'Hire' : overall >= 55 ? 'Lean Hire' : 'No Hire');
    const verdictClass = /no hire/i.test(verdict) ? 'bad' : /lean/i.test(verdict) ? 'mid' : 'good';
    let html = `
      <div class="iv-overall">
        <div class="iv-score-ring ${verdictClass}"><span data-count="${overall}">0</span><small>/100</small></div>
        <div>
          <div class="iv-verdict ${verdictClass}">${esc(verdict)}</div>
          <p class="iv-summary">${(d.summary || '').replace(/</g,'&lt;')}</p>
          <div class="iv-speakmetrics">🗣 ${metrics.wpm ?? 'n/a'} wpm · ${metrics.fillers} fillers · ~${metrics.avgWords} words/answer</div>
        </div>
      </div>
      <div class="iv-metrics">${Object.keys(names).map(k => bar(names[k], s[k])).join('')}</div>`;

    if (d.perParameter) {
      html += '<div class="iv-detail"><h4>Parameter notes</h4>';
      for (const k of Object.keys(names)) if (d.perParameter[k])
        html += `<div class="iv-note"><b>${names[k]}:</b> ${String(d.perParameter[k]).replace(/</g,'&lt;')}</div>`;
      html += '</div>';
    }
    const list = (arr) => (arr || []).map(x => `<li>${String(x).replace(/</g,'&lt;')}</li>`).join('');
    html += `<div class="iv-two">
      <div><h4>✅ Strengths</h4><ul>${list(d.strengths)}</ul></div>
      <div><h4>🎯 Improvements</h4><ul>${list(d.improvements)}</ul></div>
    </div>`;
    $('iv-report-body').innerHTML = html;
    playReportAnimations();
    window.fx?.sound('success');
  }

  /* ---------- cleanup ---------- */
  function stopCamera() {
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    $('iv-video').srcObject = null;
  }
  function stopEverything() {
    listening = false;
    if (recog) { try { recog.stop(); } catch {} recog = null; }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    stopCamera();
  }
  function resetState() {
    stopEverything();
    index = 0; transcript = []; currentQ = '';
    speakStats.totalWords = 0; speakStats.totalSec = 0; speakStats.fillers = 0;
    $('iv-transcript').textContent = ''; delete $('iv-transcript').dataset.fallback;
    $('iv-transcript').contentEditable = 'false';
  }
})();
