/**
 * Short “ready” chime after async story generation.
 * Call unlockStoryReadyAudio() synchronously from the same user gesture as “Generate”
 * so browsers allow playback when generation finishes later.
 */

let sharedCtx = null

export function unlockStoryReadyAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    if (!sharedCtx) sharedCtx = new AC()
    void sharedCtx.resume()
  } catch {
    /* ignore */
  }
}

function playTone(ctx, freq, when, durationSec, peakGain) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, when)
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(Math.max(peakGain, 0.0002), when + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + durationSec)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(when)
  osc.stop(when + durationSec + 0.03)
}

export function playStoryReadyChime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    if (!sharedCtx) sharedCtx = new AC()
    const run = () => {
      const t0 = sharedCtx.currentTime + 0.05
      playTone(sharedCtx, 784, t0, 0.14, 0.1)
      playTone(sharedCtx, 1046.5, t0 + 0.11, 0.2, 0.11)
    }
    if (sharedCtx.state === 'suspended') {
      sharedCtx.resume().then(run).catch(() => {})
    } else {
      run()
    }
  } catch {
    /* ignore */
  }
}
