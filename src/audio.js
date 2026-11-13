// Tiny WebAudio sample player for the Kenney interface sounds.
const URL_BASE = new URL('../assets/audio/', import.meta.url).href;
const NAMES = ['drop_001', 'drop_002', 'drop_003', 'drop_004', 'pluck_001', 'pluck_002', 'confirmation_002',
  'confirmation_004', 'maximize_008', 'error_006', 'bong_001', 'tick_001', 'select_005', 'click_001', 'question_003'];

export class Sound {
  constructor() {
    this.ctx = null; this.buffers = {}; this.last = {};
    try { this.muted = localStorage.getItem('gulp-muted') === '1'; } catch { this.muted = false; }
  }

  // Must be called from a user gesture.
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.out = this.ctx.createGain();
    this.out.gain.value = this.muted ? 0 : 0.8;
    this.out.connect(this.ctx.destination);
    for (const n of NAMES) {
      fetch(`${URL_BASE}${n}.mp3`)
        .then((r) => r.arrayBuffer())
        .then((b) => this.ctx.decodeAudioData(b))
        .then((buf) => { this.buffers[n] = buf; })
        .catch(() => {});
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.out) this.out.gain.value = m ? 0 : 0.8;
    try { localStorage.setItem('gulp-muted', m ? '1' : '0'); } catch { /* private mode */ }
  }

  play(name, { rate = 1, gain = 1, gap = 0 } = {}) {
    const buf = this.buffers[name];
    if (!buf || this.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    if (gap && now - (this.last[name] || 0) < gap) return;
    this.last[name] = now;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(g).connect(this.out);
    src.start();
  }
}
