// audio.js - Web Audio API 音效合成
let audioCtx = null;
let volume = 0.6;
let muted = false;

function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function gainNode() {
  const g = getCtx().createGain();
  g.gain.value = muted ? 0 : volume;
  g.connect(getCtx().destination);
  return g;
}

const sounds = {
  pop() {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const g = gainNode();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.1);
    g.gain.setValueAtTime(muted ? 0 : volume * 0.3, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.connect(g);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  },

  thinking() {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const g = gainNode();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.setValueAtTime(260, ctx.currentTime + 0.08);
    osc.frequency.setValueAtTime(220, ctx.currentTime + 0.16);
    g.gain.setValueAtTime(muted ? 0 : volume * 0.1, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(g);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
  },

  done() {
    const ctx = getCtx();
    [0, 0.12, 0.24].forEach((delay, i) => {
      const osc = ctx.createOscillator();
      const g = gainNode();
      osc.type = 'sine';
      osc.frequency.setValueAtTime([523, 659, 784][i], ctx.currentTime + delay);
      g.gain.setValueAtTime(0, ctx.currentTime + delay);
      g.gain.linearRampToValueAtTime(muted ? 0 : volume * 0.25, ctx.currentTime + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.3);
      osc.connect(g);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.3);
    });
  },

  error() {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const g = gainNode();
    osc.type = 'square';
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.setValueAtTime(120, ctx.currentTime + 0.1);
    g.gain.setValueAtTime(muted ? 0 : volume * 0.12, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.connect(g);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  },

  drop() {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const g = gainNode();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.12);
    g.gain.setValueAtTime(muted ? 0 : volume * 0.35, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.connect(g);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
  },

  click() {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const g = gainNode();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, ctx.currentTime);
    g.gain.setValueAtTime(muted ? 0 : volume * 0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    osc.connect(g);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.06);
  }
};

function playSound(name) {
  if (sounds[name]) sounds[name]();
}

function setVolume(v) { volume = v / 100; }
function setMuted(m) { muted = m; }
