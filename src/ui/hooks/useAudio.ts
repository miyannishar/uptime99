/**
 * Programmatic sound effects via Web Audio API.
 * No audio files needed - all sounds are synthesised from oscillators.
 * Respects the browser's autoplay policy: the AudioContext is created on first
 * user interaction and suspended until then.
 */

let ctx: AudioContext | null = null

function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext()
    // Resume on any user gesture - browsers suspend AudioContext by default
    const resume = () => { ctx?.resume(); window.removeEventListener('click', resume) }
    window.addEventListener('click', resume)
  }
  return ctx
}

/** Play a sequence of notes. Each note: [freq, startSec, durationSec, volume] */
function playNotes(notes: [number, number, number, number][], type: OscillatorType = 'sine') {
  try {
    const ac = getCtx()
    const master = ac.createGain()
    master.gain.setValueAtTime(0.18, ac.currentTime)
    master.connect(ac.destination)

    for (const [freq, start, dur, vol] of notes) {
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = type
      osc.frequency.setValueAtTime(freq, ac.currentTime + start)
      gain.gain.setValueAtTime(0, ac.currentTime + start)
      gain.gain.linearRampToValueAtTime(vol, ac.currentTime + start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + start + dur)
      osc.connect(gain)
      gain.connect(master)
      osc.start(ac.currentTime + start)
      osc.stop(ac.currentTime + start + dur + 0.05)
    }
  } catch {
    // AudioContext may be blocked - fail silently
  }
}

export const sfx = {
  /** Incident just arrived on the board - urgent descending alarm */
  incidentArrived() {
    playNotes([
      [880, 0,    0.12, 1.0],
      [660, 0.13, 0.12, 0.8],
      [440, 0.26, 0.20, 0.9],
    ], 'sawtooth')
  },

  /** Player submitted a correct answer - satisfying rising chord */
  correct() {
    playNotes([
      [523, 0,    0.10, 0.7],   // C5
      [659, 0.08, 0.10, 0.7],   // E5
      [784, 0.16, 0.20, 0.8],   // G5
    ], 'sine')
  },

  /** Player submitted a wrong answer - low buzz */
  wrong() {
    playNotes([
      [220, 0,    0.08, 0.6],
      [196, 0.09, 0.15, 0.5],
    ], 'square')
  },

  /** Pending action resolved - incident cleared, health restored */
  resolved() {
    playNotes([
      [784, 0,    0.08, 0.5],   // G5
      [1047,0.07, 0.10, 0.6],   // C6
      [1319,0.15, 0.25, 0.7],   // E6
    ], 'sine')
  },

  /** Session ended (debrief) */
  sessionEnd() {
    playNotes([
      [523, 0,    0.15, 0.6],
      [523, 0.18, 0.15, 0.5],
      [392, 0.36, 0.30, 0.7],
    ], 'sine')
  },

  /** Minigame opened */
  open() {
    playNotes([
      [880, 0, 0.06, 0.4],
      [1109,0.06, 0.10, 0.3],
    ], 'sine')
  },
}
