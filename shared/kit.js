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
  const Audio = window.AudioContext || window.webkitAudioContext;
  const audioLead = 0.05; // let the output route wake before the first sample
  let ctx = null;
  let resetAudioOnTap = false;
  let speechPrimed = false;

  function audio() {
    if (!Audio) return null;
    if (!ctx || ctx.state === 'closed') ctx = new Audio();
    // iOS suspends or "interrupts" the context after calls and app switches.
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    return ctx;
  }

  // Call inside a tap/click handler before the first cue: iOS won't start audio
  // or speech any other way. Skip priming when the tap itself speaks a phrase.
  function unlock({ primeSpeech = Boolean(speech.voice) } = {}) {
    const recover = resetAudioOnTap || ctx?.state === 'interrupted';
    if (recover) {
      stopFieldSpeech();
      if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
      ctx = null;
      resetAudioOnTap = false;
    }
    // iOS 17+: behave like a media app so the ring/silent switch doesn't mute cues.
    try {
      const session = navigator.audioSession;
      if (session) {
        // Reapply the playback category after iOS interrupts the output route.
        if (recover && session.type === 'playback') session.type = 'auto';
        if (session.type !== 'playback') session.type = 'playback';
      }
    } catch (e) {}
    const c = audio();
    if (c) {
      const src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, c.sampleRate);
      src.connect(c.destination);
      src.onended = () => src.disconnect();
      src.start();
    }
    if (primeSpeech && !speechPrimed) {
      const voice = selectedVoice();
      if (voice || !speech.voice) speakDevice('Go', { rate: speech.rate, pitch: 1, volume: 0 }, voice);
    }
  }

  // A short tone. Square waves carry best through phone speakers outdoors.
  // `delay` (ms) schedules on the audio clock, so patterns stay tight.
  function beep({ freq = 1000, ms = 150, volume = 0.5, type = 'square', delay = 0 } = {}) {
    const c = audio();
    if (!c) return;
    const start = c.currentTime + audioLead + delay / 1000;
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
  // A device voice is an explicit opt-in. Older saved selections used device
  // speech even when it was silent, so start those installs on Field voice too.
  const speech = { voice: store.get('cue-voice', null), rate: store.get('rate', 1.1) };
  const fieldCalls = new Set();

  function voices() {
    return 'speechSynthesis' in window ? speechSynthesis.getVoices().filter((voice) => voice.localService) : [];
  }

  function selectedVoice() {
    return speech.voice ? voices().find((voice) => voice.name === speech.voice) : undefined;
  }

  function setVoice(name) { speech.voice = name || null; store.set('cue-voice', speech.voice); }
  function setRate(rate) { speech.rate = rate; store.set('rate', rate); }

  // Speak a cue, cutting off anything still being said. Resolves with whether
  // the browser reported completion. Other phrases can use device speech.
  function speak(text, { rate = speech.rate, pitch = 1, volume = 1, interrupt = true } = {}) {
    if (interrupt) hush();
    const options = { rate, pitch, volume };
    const voice = selectedVoice();
    const field = !voice && Audio ? FieldVoice.render(text, options) : null;
    if (field) return speakField(field, volume);
    return speakDevice(text, options, voice);
  }

  function speakField({ samples, sampleRate }, volume) {
    const c = audio();
    const buffer = c.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);

    const source = c.createBufferSource();
    const gain = c.createGain();
    source.buffer = buffer;
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(c.destination);

    return new Promise((resolve) => {
      const finish = (ok) => {
        clearTimeout(timer);
        fieldCalls.delete(stop);
        source.onended = null;
        source.disconnect();
        gain.disconnect();
        resolve(ok);
      };
      const stop = () => {
        source.onended = null;
        source.stop();
        finish(false);
      };
      const timer = setTimeout(stop, buffer.duration * 1000 + 1200);
      fieldCalls.add(stop);
      source.onended = () => finish(true);
      source.start(c.currentTime + audioLead);
    });
  }

  function speakDevice(text, { rate, pitch, volume }, selected) {
    if (!('speechSynthesis' in window)) return Promise.resolve(false);
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    u.pitch = pitch;
    u.volume = volume;
    // Safari can stay silent with an implicit voice when the exact device locale
    // is unavailable. Pick an installed voice that matches the app language.
    const lang = (document.documentElement.lang || 'en').toLowerCase();
    const baseLang = lang.split('-')[0];
    const local = voices();
    const matching = local.filter((v) => v.lang.toLowerCase().split('-')[0] === baseLang);
    const locale = (navigator.language || lang).toLowerCase();
    const voice = selected
      ?? matching.find((v) => v.lang.toLowerCase() === lang)
      ?? matching.find((v) => v.default)
      ?? matching.find((v) => v.lang.toLowerCase() === locale)
      ?? matching[0];
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? (lang === 'en' ? 'en-US' : lang);

    return new Promise((resolve) => {
      let started = false;
      const finish = (ok) => {
        clearTimeout(timer);
        u.onstart = u.onend = u.onerror = null;
        resolve(ok);
      };
      const timer = setTimeout(() => finish(started), 1500 + text.length * 150);
      u.onstart = () => { started = speechPrimed = true; };
      u.onend = () => { speechPrimed = true; finish(true); };
      u.onerror = () => finish(false);
      try { speechSynthesis.speak(u); } catch (e) { finish(false); }
    });
  }

  function stopFieldSpeech() {
    for (const stop of fieldCalls) stop();
  }

  function hush() {
    stopFieldSpeech();
    if (window.speechSynthesis?.speaking || window.speechSynthesis?.pending) speechSynthesis.cancel();
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
    if (document.visibilityState !== 'visible') {
      if (ctx && isIOS()) resetAudioOnTap = true;
      return;
    }
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
  function isIOS() {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function support() {
    return {
      ios: isIOS(),
      webAudio: Boolean(Audio),
      speech: Boolean(Audio) || 'speechSynthesis' in window,
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
