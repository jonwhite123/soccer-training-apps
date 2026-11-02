/* Soccer Training Kit: small helpers shared by every app, exposed as window.Kit.
   Audio cues (beep, speak), screen wake lock, abortable timing, randomness and
   localStorage preferences. Built for iPhone Safari first; no network, works from file://. */
(function () {
  'use strict';

  // ---- Preferences (localStorage, namespaced, never throws) -----------------
  const PREFIX = 'stk:';
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(PREFIX + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (e) { /* private mode, file:// quirks */ }
    },
  };

  // ---- Audio ----------------------------------------------------------------
  let ctx = null;
  let speechPrimed = false;

  function audio() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    // iOS suspends or "interrupts" the context after calls and app switches.
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    return ctx;
  }

  // Call inside a tap/click handler before the first cue: iOS won't start audio
  // or speech any other way. Safe to call repeatedly.
  function unlock() {
    // iOS 17+: behave like a media app so the ring/silent switch doesn't mute cues.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    const c = audio();
    const src = c.createBufferSource(); // a silent sample wakes the output route
    src.buffer = c.createBuffer(1, 1, 22050);
    src.connect(c.destination);
    src.start(0);
    if (!speechPrimed && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
      speechPrimed = true;
    }
  }

  // A short tone. Square waves carry best through phone speakers outdoors.
  // `delay` (ms) schedules on the audio clock, so patterns stay tight.
  function beep({ freq = 1000, ms = 150, volume = 0.5, type = 'square', delay = 0 } = {}) {
    const c = audio();
    const start = c.currentTime + delay / 1000;
    const end = start + ms / 1000;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start); // soft edges avoid clicks
    gain.gain.linearRampToValueAtTime(volume, start + 0.008);
    gain.gain.setValueAtTime(volume, Math.max(start + 0.008, end - 0.02));
    gain.gain.linearRampToValueAtTime(0, end);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(start);
    osc.stop(end + 0.05);
  }

  // n beeps in a row, e.g. beeps(3) for "go, go, go".
  function beeps(n, { gap = 100, ms = 150, delay = 0, ...opts } = {}) {
    for (let i = 0; i < n; i++) beep({ ...opts, ms, delay: delay + i * (ms + gap) });
  }

  // ---- Speech ---------------------------------------------------------------
  // Voice and speed are chosen in Sound check and shared by every app on the same origin.
  const speech = { voice: store.get('voice', null), rate: store.get('rate', 1.1) };

  function voices() {
    return 'speechSynthesis' in window ? speechSynthesis.getVoices() : [];
  }

  function setVoice(name) { speech.voice = name || null; store.set('voice', speech.voice); }
  function setRate(rate) { speech.rate = rate; store.set('rate', rate); }

  // Speak a cue, cutting off anything still being said. Resolves when done, or
  // after a timeout because iOS sometimes never fires `end`.
  function speak(text, { rate = speech.rate, pitch = 1, volume = 1, interrupt = true } = {}) {
    if (!('speechSynthesis' in window)) return Promise.resolve();
    if (interrupt && (speechSynthesis.speaking || speechSynthesis.pending)) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    u.pitch = pitch;
    u.volume = volume;
    const v = speech.voice && voices().find((x) => x.name === speech.voice);
    if (v) { u.voice = v; u.lang = v.lang; }
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 1500 + text.length * 150);
      u.onend = u.onerror = () => { clearTimeout(timer); resolve(); };
      speechSynthesis.speak(u);
    });
  }

  function hush() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  // ---- Screen wake lock -----------------------------------------------------
  let lock = null;
  let wantAwake = false;

  // Keep the screen on during a live session: page JS stops when the phone locks.
  // Resolves false when unavailable, so the app can tell the user to raise Auto-Lock.
  async function keepAwake(on = true) {
    wantAwake = on;
    if (!on) {
      if (lock) { lock.release().catch(() => {}); lock = null; }
      return false;
    }
    if (!('wakeLock' in navigator)) return false;
    if (lock && !lock.released) return true;
    try {
      lock = await navigator.wakeLock.request('screen');
      return true;
    } catch (e) { return false; }
  }

  // The browser drops the lock, and may suspend audio, whenever the page is hidden.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (wantAwake) keepAwake(true);
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
  });

  // ---- Timing ---------------------------------------------------------------
  const isAbort = (e) => !!e && e.name === 'AbortError';

  // Wait `ms`; rejects with AbortError as soon as `signal` aborts.
  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      let timer;
      const abort = () => { clearTimeout(timer); reject(new DOMException('Stopped', 'AbortError')); };
      if (signal && signal.aborted) return abort();
      timer = setTimeout(() => {
        if (signal) signal.removeEventListener('abort', abort);
        resolve();
      }, ms);
      if (signal) signal.addEventListener('abort', abort, { once: true });
    });
  }

  // Run an async drill(signal) until it returns or stop() is called.
  // `done` always resolves, so the UI can return to setup after either.
  function run(drill) {
    const ctrl = new AbortController();
    const done = drill(ctrl.signal).catch((e) => { if (!isAbort(e)) console.error(e); });
    return { stop() { ctrl.abort(); hush(); }, done };
  }

  // ---- Randomness -----------------------------------------------------------
  const rand = (min, max) => min + Math.random() * (max - min);
  const randInt = (min, max) => Math.floor(rand(min, max + 1));
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---- Environment ----------------------------------------------------------
  function support() {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return {
      ios,
      webAudio: !!(window.AudioContext || window.webkitAudioContext),
      speech: 'speechSynthesis' in window,
      wakeLock: 'wakeLock' in navigator,
      silentSwitchOverride: 'audioSession' in navigator,
      standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
      fromFile: location.protocol === 'file:',
    };
  }

  window.Kit = {
    unlock, beep, beeps,
    speak, hush, voices, setVoice, setRate, speech,
    keepAwake,
    sleep, run, isAbort,
    rand, randInt, pick, shuffle,
    store, support,
  };
})();
