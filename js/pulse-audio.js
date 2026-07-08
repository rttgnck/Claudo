// pulse-audio.js — the Pulse audio engine. Kit-switchable synth drums + five
// synth engines (subtractive / FM / supersaw / pluck / organ), a master FX chain
// (drive → filter → compressor → limiter) with delay + reverb sends, a look-ahead
// scheduler with per-track probability, humanize and per-step ratchets, live
// preview, and offline bounce to WAV plus MIDI export.
import { TRACKS, trackNoteFreq, trackNoteMidi, TRACK_MAP, SCALES } from './pulse-defs.js';

const noiseCache = new WeakMap();
function noise(ctx) {
  let buf = noiseCache.get(ctx);
  if (!buf) { buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; noiseCache.set(ctx, buf); }
  const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; return s;
}
function env(g, t, peak, a, d) { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }

// ---- drum kits ----------------------------------------------------------
const KIT = {
  '808': { kf0: 150, kf1: 45, kdec: 0.5, snBody: 0.42, snNoise: 0.6, snDec: 0.18, hatDec: 0.045, hatHP: 7500, tomF: 200 },
  '909': { kf0: 175, kf1: 50, kdec: 0.3, snBody: 0.3, snNoise: 0.9, snDec: 0.14, hatDec: 0.038, hatHP: 8600, tomF: 220 },
  'LoFi': { kf0: 118, kf1: 42, kdec: 0.42, snBody: 0.5, snNoise: 0.4, snDec: 0.13, hatDec: 0.05, hatHP: 6000, tomF: 170 },
  'Acoustic': { kf0: 140, kf1: 62, kdec: 0.28, snBody: 0.55, snNoise: 0.72, snDec: 0.16, hatDec: 0.06, hatHP: 7000, tomF: 190 },
};
const DRUMS = {
  kick(ctx, d, t, v, k) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(k.kf0, t); o.frequency.exponentialRampToValueAtTime(k.kf1, t + 0.11); env(g, t, v, 0.004, k.kdec); o.connect(g); g.connect(d); o.start(t); o.stop(t + k.kdec + 0.1); },
  snare(ctx, d, t, v, k) { const n = noise(ctx), nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1800; nf.Q.value = 0.8; const ng = ctx.createGain(); env(ng, t, v * k.snNoise, 0.003, k.snDec); n.connect(nf); nf.connect(ng); ng.connect(d); const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 180; const og = ctx.createGain(); env(og, t, v * k.snBody, 0.003, k.snDec * 0.5); o.connect(og); og.connect(d); n.start(t); n.stop(t + k.snDec + 0.05); o.start(t); o.stop(t + k.snDec); },
  clap(ctx, d, t, v) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.9; f.connect(d); for (const off of [0, 0.012, 0.024, 0.04]) { const n = noise(ctx), ng = ctx.createGain(); env(ng, t + off, v * 0.55, 0.002, 0.055); n.connect(ng); ng.connect(f); n.start(t + off); n.stop(t + off + 0.09); } },
  chat(ctx, d, t, v, k) { const n = noise(ctx), f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = k.hatHP; const g = ctx.createGain(); env(g, t, v * 0.5, 0.002, k.hatDec); n.connect(f); f.connect(g); g.connect(d); n.start(t); n.stop(t + k.hatDec + 0.05); },
  ohat(ctx, d, t, v, k) { const n = noise(ctx), f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = k.hatHP - 500; const g = ctx.createGain(); env(g, t, v * 0.45, 0.002, 0.32); n.connect(f); f.connect(g); g.connect(d); n.start(t); n.stop(t + 0.4); },
  tom(ctx, d, t, v, k) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(k.tomF, t); o.frequency.exponentialRampToValueAtTime(k.tomF * 0.45, t + 0.18); const g = ctx.createGain(); env(g, t, v * 0.9, 0.004, 0.3); o.connect(g); g.connect(d); o.start(t); o.stop(t + 0.36); },
  rim(ctx, d, t, v) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1700; const g = ctx.createGain(); env(g, t, v * 0.5, 0.001, 0.03); o.connect(g); g.connect(d); o.start(t); o.stop(t + 0.05); const n = noise(ctx), nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 3000; const ng = ctx.createGain(); env(ng, t, v * 0.3, 0.001, 0.02); n.connect(nf); nf.connect(ng); ng.connect(d); n.start(t); n.stop(t + 0.04); },
  ride(ctx, d, t, v) { const g = ctx.createGain(); env(g, t, v * 0.26, 0.002, 0.5); g.connect(d); const n = noise(ctx), f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8500; n.connect(f); f.connect(g); n.start(t); n.stop(t + 0.55); for (const fr of [820, 1200, 1710]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = fr; const og = ctx.createGain(); og.gain.value = 0.04; o.connect(og); og.connect(g); o.start(t); o.stop(t + 0.5); } },
  crash(ctx, d, t, v) { const g = ctx.createGain(); env(g, t, v * 0.4, 0.002, 1.1); g.connect(d); const n = noise(ctx), f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000; n.connect(f); f.connect(g); n.start(t); n.stop(t + 1.2); },
  cowbell(ctx, d, t, v) { const g = ctx.createGain(); env(g, t, v * 0.4, 0.002, 0.25); g.connect(d); for (const fr of [560, 845]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = fr; const og = ctx.createGain(); og.gain.value = 0.5; o.connect(og); og.connect(g); o.start(t); o.stop(t + 0.3); } },
  shaker(ctx, d, t, v) { const n = noise(ctx), f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6500; const g = ctx.createGain(); env(g, t, v * 0.35, 0.005, 0.08); n.connect(f); f.connect(g); g.connect(d); n.start(t); n.stop(t + 0.13); },
};

// ---- synth engines ------------------------------------------------------
function ampEnv(g, t, v, p, dur) {
  const peak = Math.max(0.0002, v), sus = Math.max(0.0002, v * p.sustain);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + p.attack);
  g.gain.exponentialRampToValueAtTime(sus, t + p.attack + p.decay);
  const off = t + Math.max(dur, p.attack + 0.03);
  g.gain.setValueAtTime(Math.max(0.0002, g.gain.value || sus), off);
  g.gain.setValueAtTime(sus, off);
  g.gain.exponentialRampToValueAtTime(0.0001, off + p.release);
  return off + p.release + 0.05;
}
function glideFreq(osc, freq, t, p, from) { if (p.glide && from) { osc.frequency.setValueAtTime(from, t); osc.frequency.exponentialRampToValueAtTime(freq, t + p.glide); } else osc.frequency.setValueAtTime(freq, t); }

function synthVoice(ctx, dest, freq, t, dur, v, p, from) {
  const g = ctx.createGain();
  const stop = ampEnv(g, t, v, p, dur);
  const eng = p.engine || 'subtractive';
  if (eng === 'organ') {
    const drawbars = [1, 0.6, 0.4, 0.28, 0.16];
    drawbars.forEach((amp, i) => { const o = ctx.createOscillator(); o.type = 'sine'; glideFreq(o, freq * (i + 1), t, p, from && from * (i + 1)); const og = ctx.createGain(); og.gain.value = amp * 0.5; o.connect(og); og.connect(g); o.start(t); o.stop(stop); });
    g.connect(dest); return;
  }
  if (eng === 'fm') {
    const car = ctx.createOscillator(); car.type = 'sine'; glideFreq(car, freq, t, p, from);
    const mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.setValueAtTime(freq * (1 + Math.round(p.reso) % 4), t);
    const modGain = ctx.createGain(); modGain.gain.setValueAtTime(freq * (0.5 + p.cutoff / 4000) * 3, t); modGain.gain.exponentialRampToValueAtTime(freq * 0.4, t + p.decay + 0.05);
    mod.connect(modGain); modGain.connect(car.frequency); car.connect(g); mod.start(t); car.start(t); mod.stop(stop); car.stop(stop);
    g.connect(dest); return;
  }
  // subtractive / supersaw / pluck all go through a filter
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = p.reso;
  const peakC = Math.min(p.cutoff * (eng === 'pluck' ? 5 : 3.5), 16000);
  f.frequency.setValueAtTime(peakC, t); f.frequency.exponentialRampToValueAtTime(Math.max(80, p.cutoff), t + (eng === 'pluck' ? p.decay * 0.5 : p.decay) + 0.02);
  f.connect(g); g.connect(dest);
  if (eng === 'supersaw') {
    const spread = [-0.24, -0.14, -0.06, 0, 0.06, 0.14, 0.24];
    spread.forEach((det, i) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; glideFreq(o, freq, t, p, from); o.detune.setValueAtTime(det * 55, t); const og = ctx.createGain(); og.gain.value = 0.16; o.connect(og); og.connect(f); o.start(t); o.stop(stop); });
  } else {
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(); o1.type = o2.type = p.wave; o2.detune.value = 8;
    glideFreq(o1, freq, t, p, from); glideFreq(o2, freq, t, p, from);
    o1.connect(f); o2.connect(f); o1.start(t); o2.start(t); o1.stop(stop); o2.stop(stop);
    if (eng === 'pluck') { const n = noise(ctx), ng = ctx.createGain(); env(ng, t, v * 0.4, 0.001, 0.02); const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = freq * 2; n.connect(nf); nf.connect(ng); ng.connect(f); n.start(t); n.stop(t + 0.05); }
  }
}

// ---- reverb / drive -----------------------------------------------------
function makeIR(ctx, seconds = 2.4, decay = 3.2) { const len = Math.floor(ctx.sampleRate * seconds); const buf = ctx.createBuffer(2, len, ctx.sampleRate); for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); } return buf; }
function driveCurve(a) { const k = a * 80, n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); } return c; }

function buildGraph(ctx, withAnalyser) {
  const masterIn = ctx.createGain();
  const drive = ctx.createWaveShaper(); drive.curve = driveCurve(0);
  const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 20000;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
  const limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = -1.5; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
  const outGain = ctx.createGain();
  masterIn.connect(drive); drive.connect(filter); filter.connect(comp); comp.connect(limiter); limiter.connect(outGain);
  let analyser = null;
  if (withAnalyser) { analyser = ctx.createAnalyser(); analyser.fftSize = 2048; outGain.connect(analyser); analyser.connect(ctx.destination); } else outGain.connect(ctx.destination);
  const delay = ctx.createDelay(1.5); const dfb = ctx.createGain(); dfb.gain.value = 0.35; const dfilt = ctx.createBiquadFilter(); dfilt.type = 'lowpass'; dfilt.frequency.value = 2600; delay.connect(dfilt); dfilt.connect(dfb); dfb.connect(delay); const delayReturn = ctx.createGain(); delayReturn.gain.value = 0; delay.connect(delayReturn); delayReturn.connect(masterIn);
  const conv = ctx.createConvolver(); conv.buffer = makeIR(ctx); const revReturn = ctx.createGain(); revReturn.gain.value = 0; conv.connect(revReturn); revReturn.connect(masterIn);
  const SENDS = { kick: [0, 0], snare: [0.08, 0.12], clap: [0.12, 0.2], chat: [0.05, 0.06], ohat: [0.06, 0.1], tom: [0.1, 0.14], rim: [0.15, 0.18], ride: [0.06, 0.18], crash: [0.05, 0.25], cowbell: [0.14, 0.14], shaker: [0.05, 0.08], bass: [0.04, 0.05], lead: [0.22, 0.28], chords: [0.18, 0.4] };
  const tracks = {};
  for (const t of TRACKS) { const g = ctx.createGain(); const pan = ctx.createStereoPanner(); g.connect(pan); pan.connect(masterIn); const ds = ctx.createGain(); ds.gain.value = SENDS[t.id][0]; pan.connect(ds); ds.connect(delay); const rs = ctx.createGain(); rs.gain.value = SENDS[t.id][1]; pan.connect(rs); rs.connect(conv); tracks[t.id] = { in: g, pan, ds, rs }; }
  return { masterIn, drive, filter, comp, outGain, analyser, delay, dfb, delayReturn, conv, revReturn, tracks, lastFreq: {} };
}
function applyMaster(ctx, nodes, project) {
  const m = project.master;
  nodes.outGain.gain.setTargetAtTime(m.vol, ctx.currentTime, 0.02);
  nodes.drive.curve = driveCurve(m.drive);
  nodes.filter.frequency.setTargetAtTime(200 + m.cutoff * 19800, ctx.currentTime, 0.02);
  nodes.delay.delayTime.value = (60 / project.bpm) * 0.75;
  nodes.delayReturn.gain.setTargetAtTime(m.delay, ctx.currentTime, 0.02);
  nodes.revReturn.gain.setTargetAtTime(m.reverb, ctx.currentTime, 0.02);
  const soloOn = TRACKS.some((t) => project.mixer[t.id].solo);
  for (const t of TRACKS) { const mx = project.mixer[t.id]; const audible = !mx.mute && (!soloOn || mx.solo); nodes.tracks[t.id].in.gain.setTargetAtTime(audible ? mx.vol : 0, ctx.currentTime, 0.02); nodes.tracks[t.id].pan.pan.setTargetAtTime(mx.pan, ctx.currentTime, 0.02); }
}

function triggerStep(ctx, nodes, project, step, time) {
  const pat = project.patterns[project.patternIndex];
  const scale = SCALES[project.scale].steps;
  const soloOn = TRACKS.some((t) => project.mixer[t.id].solo);
  const stepDur = (60 / project.bpm) / 4;
  const kit = KIT[project.kit] || KIT['808'];
  const hum = project.humanize || 0;
  for (const t of TRACKS) {
    const mx = project.mixer[t.id];
    if (mx.mute || (soloOn && !mx.solo)) continue;
    if (mx.prob != null && mx.prob < 1 && Math.random() > mx.prob) continue;
    const seq = pat.seq[t.id];
    const jitter = (Math.random() - 0.5) * hum * 0.03;
    const at = time + jitter;
    if (t.kind === 'drum') {
      const v0 = seq[step]; if (v0 <= 0) continue;
      const v = Math.max(0.05, Math.min(1, v0 * (1 - hum * 0.3 + Math.random() * hum * 0.3)));
      const r = (pat.ratchet && pat.ratchet[t.id]) ? pat.ratchet[t.id][step] : 1;
      const rr = Math.max(1, r);
      for (let i = 0; i < rr; i++) DRUMS[t.voice](ctx, nodes.tracks[t.id].in, at + i * (stepDur / rr), v * (i === 0 ? 1 : 0.8), kit);
    } else {
      const notes = seq[step]; if (!notes || !notes.length) continue;
      const p = project.synth[t.id]; const dur = stepDur * (p.gate || 0.9);
      const gf = nodes.lastFreq[t.id];
      for (let k = 0; k < notes.length; k++) { const freq = trackNoteFreq(t, notes[k], project.key, scale); synthVoice(ctx, nodes.tracks[t.id].in, freq, at, dur, 0.8, p, k === 0 ? gf : null); if (k === 0) nodes.lastFreq[t.id] = freq; }
    }
  }
}

// ---- Engine -------------------------------------------------------------
export class Engine {
  constructor(getProject) { this.getP = getProject; this.ctx = null; this.nodes = null; this.playing = false; this.currentStep = 0; this.nextTime = 0; this.timer = null; this.stepQueue = []; }
  ensure() { if (this.ctx) return; this.ctx = new (window.AudioContext || window.webkitAudioContext)(); this.nodes = buildGraph(this.ctx, true); applyMaster(this.ctx, this.nodes, this.getP()); }
  get analyser() { return this.nodes && this.nodes.analyser; }
  refresh() { if (this.ctx) applyMaster(this.ctx, this.nodes, this.getP()); }
  play() { this.ensure(); if (this.ctx.state === 'suspended') this.ctx.resume(); this.playing = true; this.currentStep = 0; this.nextTime = this.ctx.currentTime + 0.06; this.stepQueue = []; this.timer = setInterval(() => this._sched(), 25); }
  stop() { this.playing = false; clearInterval(this.timer); this.timer = null; this.stepQueue = []; }
  _sched() {
    const p = this.getP(); const stepDur = (60 / p.bpm) / 4;
    while (this.nextTime < this.ctx.currentTime + 0.1) {
      const swung = (this.currentStep % 2 === 1) ? p.swing * stepDur : 0; const at = this.nextTime + swung;
      triggerStep(this.ctx, this.nodes, p, this.currentStep, at);
      if (p.metronome) this._click(at, this.currentStep % 4 === 0);
      this.stepQueue.push({ step: this.currentStep, t: at });
      this.currentStep = (this.currentStep + 1) % p.steps; this.nextTime += stepDur;
    }
  }
  _click(t, hi) { const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.frequency.value = hi ? 1600 : 900; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03); o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + 0.04); }
  drawStep() { if (!this.playing || !this.ctx) return -1; let s = -1; while (this.stepQueue.length && this.stepQueue[0].t <= this.ctx.currentTime) s = this.stepQueue.shift().step; return s; }
  previewDrum(voice, v = 0.9) { this.ensure(); if (this.ctx.state !== 'running') return; const p = this.getP(); DRUMS[voice](this.ctx, this.nodes.tracks[voiceToTrack(voice)].in, this.ctx.currentTime, v, KIT[p.kit] || KIT['808']); }
  previewNote(trackId, freq) { this.ensure(); if (this.ctx.state !== 'running') return; synthVoice(this.ctx, this.nodes.tracks[trackId].in, freq, this.ctx.currentTime, 0.3, 0.8, this.getP().synth[trackId], null); }
  unlock() { this.ensure(); if (this.ctx.state === 'suspended') this.ctx.resume(); }
  async exportWav(loops = 2) {
    const p = this.getP(); const stepDur = (60 / p.bpm) / 4; const total = p.steps * loops; const seconds = total * stepDur + 2.5; const rate = 44100;
    const octx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
    const nodes = buildGraph(octx, false); applyMaster(octx, nodes, p);
    const start = 0.05;
    for (let s = 0; s < total; s++) { const step = s % p.steps; const swung = (step % 2 === 1) ? p.swing * stepDur : 0; triggerStep(octx, nodes, p, step, start + s * stepDur + swung); }
    return encodeWav(await octx.startRendering());
  }
}
function voiceToTrack(voice) { return TRACKS.find((t) => t.voice === voice).id; }

// ---- WAV ----------------------------------------------------------------
function encodeWav(buffer) {
  const nch = buffer.numberOfChannels, len = buffer.length, rate = buffer.sampleRate, bytes = 44 + len * nch * 2;
  const ab = new ArrayBuffer(bytes), view = new DataView(ab);
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); view.setUint32(4, bytes - 8, true); wr(8, 'WAVE'); wr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, nch, true); view.setUint32(24, rate, true); view.setUint32(28, rate * nch * 2, true); view.setUint16(32, nch * 2, true); view.setUint16(34, 16, true); wr(36, 'data'); view.setUint32(40, len * nch * 2, true);
  const chans = []; for (let c = 0; c < nch; c++) chans.push(buffer.getChannelData(c)); let off = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < nch; c++) { let s = Math.max(-1, Math.min(1, chans[c][i])); view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2; }
  return new Blob([ab], { type: 'audio/wav' });
}

// ---- MIDI export --------------------------------------------------------
const GM_DRUM = { kick: 36, snare: 38, clap: 39, chat: 42, ohat: 46, tom: 45, rim: 37, ride: 51, crash: 49, cowbell: 56, shaker: 70 };
const SYNTH_CH = { bass: 0, lead: 1, chords: 2 };
export function exportMidi(project) {
  const scale = SCALES[project.scale].steps; const tpqn = 480, tps = tpqn / 4;
  const events = []; // {tick, on, ch, note, vel}
  const pat = project.patterns[project.patternIndex];
  for (const t of TRACKS) {
    const seq = pat.seq[t.id];
    for (let s = 0; s < project.steps; s++) {
      if (t.kind === 'drum') { if (seq[s] > 0) { const note = GM_DRUM[t.id]; events.push({ tick: s * tps, on: 1, ch: 9, note, vel: Math.round(seq[s] * 110) }); events.push({ tick: s * tps + tps * 0.5, on: 0, ch: 9, note, vel: 0 }); } }
      else { const notes = seq[s]; if (notes && notes.length) { const dur = Math.max(1, Math.round((project.synth[t.id].gate || 1) * tps)); for (const n of notes) { const m = trackNoteMidi(t, n, project.key, scale); events.push({ tick: s * tps, on: 1, ch: SYNTH_CH[t.id], note: m, vel: 96 }); events.push({ tick: s * tps + dur, on: 0, ch: SYNTH_CH[t.id], note: m, vel: 0 }); } } }
    }
  }
  events.sort((a, b) => a.tick - b.tick || a.on - b.on);
  const track = [];
  const vlq = (n) => { const b = [n & 0x7f]; n >>= 7; while (n > 0) { b.unshift((n & 0x7f) | 0x80); n >>= 7; } return b; };
  const tempo = Math.round(60000000 / project.bpm);
  track.push(...vlq(0), 0xff, 0x51, 0x03, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255);
  let last = 0;
  for (const e of events) { const dt = Math.round(e.tick - last); last = e.tick; track.push(...vlq(dt), (e.on ? 0x90 : 0x80) | e.ch, e.note & 127, e.vel & 127); }
  track.push(...vlq(Math.round(project.steps * tps - last)), 0xff, 0x2f, 0x00);
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (tpqn >> 8) & 255, tpqn & 255];
  const tlen = track.length; const trk = [0x4d, 0x54, 0x72, 0x6b, (tlen >> 24) & 255, (tlen >> 16) & 255, (tlen >> 8) & 255, tlen & 255, ...track];
  return new Blob([new Uint8Array([...head, ...trk])], { type: 'audio/midi' });
}
