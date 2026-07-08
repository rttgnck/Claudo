// pulse-defs.js — shared musical + track definitions for the Pulse groovebox.

export const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Scale interval sets (semitones within an octave).
export const SCALES = {
  minorPent: { name: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  majorPent: { name: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  minor: { name: 'Natural minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  major: { name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  dorian: { name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  harmonicMinor: { name: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  blues: { name: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  chromatic: { name: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

export const KITS = ['808', '909', 'LoFi', 'Acoustic'];
export const ENGINES = ['subtractive', 'fm', 'supersaw', 'pluck', 'organ'];

// Track roster. Drums are on/off+velocity lanes; synths are scale-locked note grids.
export const TRACKS = [
  { id: 'kick', name: 'Kick', kind: 'drum', voice: 'kick', color: '#ff5c7c' },
  { id: 'snare', name: 'Snare', kind: 'drum', voice: 'snare', color: '#ffd166' },
  { id: 'clap', name: 'Clap', kind: 'drum', voice: 'clap', color: '#fb923c' },
  { id: 'chat', name: 'Closed Hat', kind: 'drum', voice: 'chat', color: '#38bdf8' },
  { id: 'ohat', name: 'Open Hat', kind: 'drum', voice: 'ohat', color: '#22d3ee' },
  { id: 'tom', name: 'Tom', kind: 'drum', voice: 'tom', color: '#a78bfa' },
  { id: 'rim', name: 'Rim', kind: 'drum', voice: 'rim', color: '#f9a8d4' },
  { id: 'ride', name: 'Ride', kind: 'drum', voice: 'ride', color: '#94a3b8' },
  { id: 'crash', name: 'Crash', kind: 'drum', voice: 'crash', color: '#e2e8f0' },
  { id: 'cowbell', name: 'Cowbell', kind: 'drum', voice: 'cowbell', color: '#facc15' },
  { id: 'shaker', name: 'Shaker', kind: 'drum', voice: 'shaker', color: '#7dd3fc' },
  { id: 'bass', name: 'Bass', kind: 'synth', color: '#4ade80', poly: false, octave: -1, rows: 10 },
  { id: 'lead', name: 'Lead', kind: 'synth', color: '#60a5fa', poly: true, octave: 0, rows: 14 },
  { id: 'chords', name: 'Chords', kind: 'synth', color: '#c084fc', poly: true, octave: 0, rows: 14 },
];
export const TRACK_MAP = Object.fromEntries(TRACKS.map((t) => [t.id, t]));
export const DRUM_IDS = TRACKS.filter((t) => t.kind === 'drum').map((t) => t.id);
export const SYNTH_IDS = TRACKS.filter((t) => t.kind === 'synth').map((t) => t.id);

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function degreeSemis(steps, i) {
  const n = steps.length;
  return Math.floor(i / n) * 12 + steps[((i % n) + n) % n];
}
export function trackNoteFreq(track, pitchIndex, keyIdx, scaleSteps) {
  const root = 48 + keyIdx + (track.octave || 0) * 12;
  return midiToFreq(root + degreeSemis(scaleSteps, pitchIndex));
}
export function trackNoteMidi(track, pitchIndex, keyIdx, scaleSteps) {
  const root = 48 + keyIdx + (track.octave || 0) * 12;
  return Math.round(root + degreeSemis(scaleSteps, pitchIndex));
}
export function noteName(track, pitchIndex, keyIdx, scaleSteps) {
  const m = trackNoteMidi(track, pitchIndex, keyIdx, scaleSteps);
  return KEYS[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

// Default synth parameters per synth track.
export function defaultSynthParams(id) {
  if (id === 'bass') return { engine: 'subtractive', wave: 'sawtooth', attack: 0.005, decay: 0.18, sustain: 0.5, release: 0.14, cutoff: 900, reso: 6, glide: 0.04, gate: 0.9 };
  if (id === 'chords') return { engine: 'supersaw', wave: 'sawtooth', attack: 0.03, decay: 0.4, sustain: 0.6, release: 0.6, cutoff: 2600, reso: 3, glide: 0, gate: 3.5 };
  return { engine: 'subtractive', wave: 'square', attack: 0.005, decay: 0.22, sustain: 0.35, release: 0.28, cutoff: 3200, reso: 5, glide: 0, gate: 0.9 };
}
