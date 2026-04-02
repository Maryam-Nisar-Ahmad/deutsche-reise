export class GermanVoice {
  constructor() {
    this.synth = window.speechSynthesis
    this._playbackToken = 0
    this.currentUtterance = null
    this.voices = []
    this.selectedVoiceURI = localStorage.getItem('dr_voice_uri') || null
    this.selectedVoice = null
    this.rate = parseFloat(localStorage.getItem('dr_speech_rate') || '0.85')
    this.onBoundary = null
    this.onEnd = null
    this.onSentenceEnd = null
    this._loadVoices()
  }

  _loadVoices() {
    const load = () => {
      this.voices = this.synth.getVoices().filter(v => v.lang.startsWith('de'))
      if (this.selectedVoiceURI) {
        this.selectedVoice = this.voices.find(v => v.voiceURI === this.selectedVoiceURI)
      }
      if (!this.selectedVoice && this.voices.length > 0) {
        this.selectedVoice = this.voices[0]
      }
    }
    load()
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = load
    }
  }

  getVoices() { return this.voices }

  reloadVoices() {
    this._loadVoices()
    return this.voices
  }

  setVoice(voiceURI) {
    this.selectedVoice = this.voices.find(v => v.voiceURI === voiceURI) || this.voices[0]
    this.selectedVoiceURI = voiceURI
    localStorage.setItem('dr_voice_uri', voiceURI)
  }

  setRate(rate) {
    this.rate = rate
    localStorage.setItem('dr_speech_rate', rate.toString())
  }

  /** Same chunking as full-chapter speak(); use for snapshot + resume. */
  getSpeakChunks(text) {
    return this._chunkBySentence(text, 220)
  }

  /**
   * Speak pre-split chunks from startIndex. Cancels any prior playback.
   * onUtteranceStart(idx) — when chunk idx begins (for pause/resume cursor).
   * onAfterUtterance(idx) — after chunk idx finishes (next index is idx + 1).
   */
  speakChunks(chunks, startIndex = 0, { onEnd, onUtteranceStart, onAfterUtterance } = {}) {
    if (!chunks?.length) {
      onEnd?.()
      this.onEnd?.()
      return
    }
    this.stop()
    const token = this._playbackToken

    const speakAt = (at) => {
      if (token !== this._playbackToken) return
      if (at >= chunks.length) {
        onEnd?.()
        this.onEnd?.()
        return
      }
      onUtteranceStart?.(at)
      const chunk = chunks[at]
      const u = new SpeechSynthesisUtterance(chunk)
      u.voice = this.selectedVoice
      u.lang = 'de-DE'
      u.rate = this.rate
      u.onboundary = (e) => this.onBoundary?.(e.charIndex, e.charLength)
      u.onend = () => {
        if (token !== this._playbackToken) return
        onAfterUtterance?.(at)
        speakAt(at + 1)
      }
      this.currentUtterance = u
      this.synth.speak(u)
    }

    speakAt(Math.max(0, startIndex))
  }

  speak(text, { onEnd } = {}) {
    const chunks = this._chunkBySentence(text, 220)
    this.speakChunks(chunks, 0, { onEnd })
  }

  speakSentence(sentence, { onEnd } = {}) {
    this.stop()
    const u = new SpeechSynthesisUtterance(sentence)
    u.voice = this.selectedVoice
    u.lang = 'de-DE'
    u.rate = this.rate
    u.onend = () => { onEnd?.() }
    this.currentUtterance = u
    this.synth.speak(u)
  }

  speakWord(word) {
    this.stop()
    const u = new SpeechSynthesisUtterance(word)
    u.voice = this.selectedVoice
    u.lang = 'de-DE'
    u.rate = 0.8
    this.synth.speak(u)
  }

  stop() {
    this._playbackToken++
    this.synth.cancel()
    this.currentUtterance = null
  }

  isPaused() { return this.synth.paused }
  isSpeaking() { return this.synth.speaking }

  _chunkBySentence(text, maxLen) {
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text]
    const chunks = []
    let current = ''
    for (const s of sentences) {
      if ((current + s).length > maxLen) {
        if (current) chunks.push(current.trim())
        current = s
      } else {
        current += s
      }
    }
    if (current) chunks.push(current.trim())
    return chunks
  }

  getSentences(text) {
    return text.match(/[^.!?]+[.!?]+/g)?.map(s => s.trim()).filter(Boolean) || [text]
  }
}

export const germanVoice = new GermanVoice()
