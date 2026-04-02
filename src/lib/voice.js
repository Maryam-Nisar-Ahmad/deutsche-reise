export class GermanVoice {
  constructor() {
    this.synth = window.speechSynthesis
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

  speak(text, { onEnd } = {}) {
    this.stop()
    const chunks = this._chunkBySentence(text, 220)
    let i = 0

    const speakNext = () => {
      if (i >= chunks.length) {
        onEnd?.()
        this.onEnd?.()
        return
      }
      const chunk = chunks[i]
      const u = new SpeechSynthesisUtterance(chunk)
      u.voice = this.selectedVoice
      u.lang = 'de-DE'
      u.rate = this.rate
      u.onend = () => { i++; speakNext() }
      u.onboundary = (e) => this.onBoundary?.(e.charIndex, e.charLength)
      this.currentUtterance = u
      this.synth.speak(u)
      i++
    }
    speakNext()
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
    this.synth.cancel()
    const u = new SpeechSynthesisUtterance(word)
    u.voice = this.selectedVoice
    u.lang = 'de-DE'
    u.rate = 0.8
    this.synth.speak(u)
  }

  stop() {
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
