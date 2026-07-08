// pulse-audio.js — the Pulse audio engine. Synthesised drum kit + subtractive
// bass/lead synths, a master FX chain (drive → filter → compressor) with delay
// and reverb send busses, a look-ahead scheduler, live preview, and offline
// bounce-to-WAV. The same graph builder + step trigger power both realtime
// playback and the WAV export, so what you hear is what you download.
import { TRACKS, TRACK_MAP, trackNoteFreq, SCALES } from './pulse-defs.js';

const noiseCache = new WeakMap();
function noise(ctx) {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; return s;
}
function env(g, t, peak, a, d) {
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

// ---- drum voices --------------------------------------------------------
const DRUMS = {
  kick(ctx, dest, t, v) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.11);
    env(g, t, v, 0.004, 0.36); o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.42);
  },
  snare(ctx, dest, t, v) {
    const n = noise(ctx), nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1800; nf.Q.value = 0.8;
    const ng = ctx.createGain(); env(ng, t, v * 0.8, 0.003, 0.18); n.connect(nf); nf.connect(ng); ng.connect(dest);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 180; const og = ctx.createGain(); env(og, t, v * 0.4, 0.003, 0.09); o.connect(og); og.connect(dest);
    n.start(t); n.stop(t + 0.22); o.start(t); o.stop(t + 0.12);
  },
  clap(ctx, dest, t, v) {
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.9; f.connect(dest);
    for (const off of [0, 0.012, 0.024, 0.04]) { const n = noise(ctx), ng = ctx.createGain(); env(ng, t + off, v * 0.55, 0.002, 0.055); n.connect(ng); ng.connect(f); n.start(t + off); n.stop(t + off + 0.09); }
  },
  chat(ctx, dest, t, v) {
    const n = noise(ctx), f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500; const g = ctx.createGain(); env(g, t, v * 0.5, 0.002, 0.04); n.connect(f); f.connect(g); g.connect(dest); n.start(t); n.stop(t + 0.09);
  },
  ohat(ctx, dest, t, v) {
    const n = noise(ctx), f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000; const g = ctx.createGain(); env(g, t, v * 0.45, 0.002, 0.32); n.connect(f); f.connect(g); g.connect(dest); n.start(t); n.stop(t + 0.4);
  },
  tom(ctx, dest, t, v) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(90, t + 0.18); const g = ctx.createGain(); env(g, t, v * 0.9, 0.004, 0.3); o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.36);
  },
  rim(ctx, dest, t, v) {
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1700; const g = ctx.createGain(); env(g, t, v * 0.5, 0.001, 0.03); o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.05);
    const n = noise(ctx), nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 3000; const ng = ctx.createGain(); env(ng, t, v * 0.3, 0.001, 0.02); n.connect(nf); nf.connect(ng); ng.connect(dest); n.start(t); n.stop(t + 0.04);
  },
  ride(ctx, dest, t, v) {
    const g = ctx.createGain(); env(g, t, v * 0.28, 0.002, 0.5); g.connect(dest);
    const n = noise(ctx), f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8500; n.connect(f); f.connect(g); n.start(t); n.stop(t + 0.55);
    for (const fr of [820, 1200, 1710]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = fr; const og = ctx.createGain(); og.gain.value = 0.04; o.connect(og); og.connect(g); o.start(t); o.stop(t + 0.5); }
  },
};

// ---- subtractive synth voice -------------------------------------------
function synthVoice(ctx, dest, freq, t, dur, v, p, glideFrom) {
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
  o1.type = o2.type = p.wave;
  o2.detune.value = 8;
  if (p.glide && glideFrom) { o1.frequency.setValueAtTime(glideFrom, t); o1.frequency.exponentialRampToValueAtTime(freq, t + p.glide); o2.frequency.setValueAtTime(glideFrom, t); o2.frequency.exponentialRampToValueAtTime(freq, t + p.glide); }
  else { o1.frequency.setValueAtTime(freq, t); o2.frequency.setValueAtTime(freq, t); }
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = p.reso;
  const peakC = Math.min(p.cutoff * 3.5, 16000);
  f.frequency.setValueAtTime(peakC, t); f.frequency.exponentialRampToValueAtTime(Math.max(80, p.cutoff), t + p.decay + 0.02);
  const g = ctx.createGain();
  const peak = Math.max(0.0002, v), sus = Math.max(0.0002, v * p.sustain);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + p.attack);
  g.gain.exponentialRampToValueAtTime(sus, t + p.attack + p.decay);
  const off = t + Math.max(dur, p.attack + 0.02);
  g.gain.setValueAtTime(sus, off);
  g.gain.exponentialRampToValueAtTime(0.0001, off + p.release);
  o1.connect(f); o2.connect(f); f.connect(g); g.connect(dest);
  o1.start(t); o2.start(t); o1.stop(off + p.release + 0.05); o2.stop(off + p.release + 0.05);
}

// ---- reverb impulse -----------------------------------------------------
function makeIR(ctx, seconds = 2.4, decay = 3.2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
  return buf;
}
function driveCurve(amount) {
  const k = amount * 80, n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
  return c;
}

// ---- graph builder (shared by live + offline) --------------------------
function buildGraph(ctx, withAnalyser) {
  const masterIn = ctx.createGain();
  const drive = ctx.createWaveShaper(); drive.curve = driveCurve(0);
  const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 20000;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
  const outGain = ctx.createGain();
  masterIn.connect(drive); drive.connect(filter); filter.connect(comp); comp.connect(outGain);
  let analyser = null;
  if (withAnalyser) { analyser = ctx.createAnalyser(); analyser.fftSize = 2048; outGain.connect(analyser); analyser.connect(ctx.destination); }
  else outGain.connect(ctx.destination);

  const delay = ctx.createDelay(1.5); const dfb = ctx.createGain(); dfb.gain.value = 0.35;
  const dfilt = ctx.createBiquadFilter(); dfilt.type = 'lowpass'; dfilt.frequency.value = 2600;
  delay.connect(dfilt); dfilt.connect(dfb); dfb.connect(delay);
  const delayReturn = ctx.createGain(); delayReturn.gain.value = 0; delay.connect(delayReturn); delayReturn.connect(masterIn);

  const conv = ctx.createConvolver(); conv.buffer = makeIR(ctx);
  const revReturn = ctx.createGain(); revReturn.gain.value = 0; conv.connect(revReturn); revReturn.connect(masterIn);

  const SENDS = { kick: [0, 0], snare: [0.08, 0.12], clap: [0.12, 0.2], chat: [0.05, 0.06], ohat: [0.06, 0.1], tom: [0.1, 0.14], rim: [0.15, 0.18], ride: [0.06, 0.18], bass: [0.04, 0.05], lead: [0.22, 0.28] };
  const tracks = {};
  for (const t of TRACKS) {
    const g = ctx.createGain();
    const pan = ctx.createStereoPanner();
    g.connect(pan); pan.connect(masterIn);
    const ds = ctx.createGain(); ds.gain.value = SENDS[t.id][0]; pan.connect(ds); ds.connect(delay);
    const rs = ctx.createGain(); rs.gain.value = SENDS[t.id][1]; pan.connect(rs); rs.connect(conv);
    tracks[t.id] = { in: g, pan, ds, rs };
  }
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
  // per-track mixer
  const soloOn = TRACKS.some((t) => project.mixer[t.id].solo);
  for (const t of TRACKS) {
    const mx = project.mixer[t.id];
    const audible = !mx.mute && (!soloOn || mx.solo);
    nodes.tracks[t.id].in.gain.setTargetAtTime(audible ? mx.vol : 0, ctx.currentTime, 0.02);
    nodes.tracks[t.id].pan.pan.setTargetAtTime(mx.pan, ctx.currentTime, 0.02);
  }
}

// Trigger everything on `step` at absolute time `time`.
function triggerStep(ctx, nodes, project, step, time) {
  const pat = project.patterns[project.patternIndex];
  const scale = SCALES[project.scale].steps;
  const soloOn = TRACKS.some((t) => project.mixer[t.id].solo);
  const stepDur = (60 / project.bpm) / 4;
  for (const t of TRACKS) {
    const mx = project.mixer[t.id];
    if (mx.mute || (soloOn && !mx.solo)) continue;
    const seq = pat.seq[t.id];
    if (t.kind === 'drum') {
      const v = seq[step];
      if (v > 0) DRUMS[t.voice](ctx, nodes.tracks[t.id].in, time, v);
    } else {
      const notes = seq[step];
      if (notes && notes.length) {
        const p = project.synth[t.id];
        const gf = nodes.lastFreq[t.id];
        for (let k = 0; k < notes.length; k++) {
          const freq = trackNoteFreq(t, notes[k], project.key, scale);
          synthVoice(ctx, nodes.tracks[t.id].in, freq, time, stepDur * 0.92, 0.85, p, k === 0 ? gf : null);
          if (k === 0) nodes.lastFreq[t.id] = freq;
        }
      }
    }
  }
}

// ---- Engine -------------------------------------------------------------
export class Engine {
  constructor(getProject) { this.getP = getProject; this.ctx = null; this.nodes = null; this.playing = false; this.currentStep = 0; this.nextTime = 0; this.timer = null; this.onStep = null; }

  ensure() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.nodes = buildGraph(this.ctx, true);
    applyMaster(this.ctx, this.nodes, this.getP());
  }
  get analyser() { return this.nodes && this.nodes.analyser; }
  refresh() { if (this.ctx) applyMaster(this.ctx, this.nodes, this.getP()); }

  play() {
    this.ensure();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.playing = true; this.currentStep = 0; this.nextTime = this.ctx.currentTime + 0.06;
    this.stepQueue = [];
    this.timer = setInterval(() => this._sched(), 25);
  }
  stop() { this.playing = false; clearInterval(this.timer); this.timer = null; this.stepQueue = []; }

  _sched() {
    const p = this.getP();
    const stepDur = (60 / p.bpm) / 4;
    while (this.nextTime < this.ctx.currentTime + 0.1) {
      const swung = (this.currentStep % 2 === 1) ? p.swing * stepDur : 0;
      const at = this.nextTime + swung;
      triggerStep(this.ctx, this.nodes, p, this.currentStep, at);
      if (p.metronome) this._click(at, this.currentStep % 4 === 0);
      (this.stepQueue = this.stepQueue || []).push({ step: this.currentStep, t: at });
      this.currentStep = (this.currentStep + 1) % p.steps;
      this.nextTime += stepDur;
    }
  }
  _click(t, hi) { const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.frequency.value = hi ? 1600 : 900; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03); o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + 0.04); }

  // Which step is sounding right now (for the playhead)? Pull from the queue.
  drawStep() {
    if (!this.playing || !this.ctx || !this.stepQueue) return -1;
    let s = -1;
    while (this.stepQueue.length && this.stepQueue[0].t <= this.ctx.currentTime) s = this.stepQueue.shift().step;
    return s;
  }

  previewDrum(voice, v = 0.9) { this.ensure(); if (this.ctx.state !== 'running') return; DRUMS[voice](this.ctx, this.nodes.tracks[voiceToTrack(voice)].in, this.ctx.currentTime, v); }
  previewNote(trackId, freq) { this.ensure(); if (this.ctx.state !== 'running') return; const p = this.getP().synth[trackId]; synthVoice(this.ctx, this.nodes.tracks[trackId].in, freq, this.ctx.currentTime, 0.25, 0.85, p, null); }
  unlock() { this.ensure(); if (this.ctx.state === 'suspended') this.ctx.resume(); }

  async exportWav(bars = 2) {
    const p = this.getP();
    const stepDur = (60 / p.bpm) / 4;
    const totalSteps = p.steps * bars;
    const seconds = totalSteps * stepDur + 2.0; // tail for reverb/release
    const rate = 44100;
    const octx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
    const nodes = buildGraph(octx, false);
    applyMaster(octx, nodes, p);
    const start = 0.05;
    for (let s = 0; s < totalSteps; s++) {
      const step = s % p.steps;
      const swung = (step % 2 === 1) ? p.swing * stepDur : 0;
      triggerStep(octx, nodes, p, step, start + s * stepDur + swung);
    }
    const rendered = await octx.startRendering();
    return encodeWav(rendered);
  }
}
function voiceToTrack(voice) { return TRACKS.find((t) => t.voice === voice).id; }

// ---- WAV encoder (16-bit PCM) ------------------------------------------
function encodeWav(buffer) {
  const nch = buffer.numberOfChannels, len = buffer.length, rate = buffer.sampleRate;
  const bytes = 44 + len * nch * 2;
  const ab = new ArrayBuffer(bytes), view = new DataView(ab);
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); view.setUint32(4, bytes - 8, true); wr(8, 'WAVE'); wr(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, nch, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * nch * 2, true); view.setUint16(32, nch * 2, true); view.setUint16(34, 16, true);
  wr(36, 'data'); view.setUint32(40, len * nch * 2, true);
  const chans = []; for (let c = 0; c < nch; c++) chans.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < nch; c++) { let s = Math.max(-1, Math.min(1, chans[c][i])); view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2; }
  return new Blob([ab], { type: 'audio/wav' });
}
