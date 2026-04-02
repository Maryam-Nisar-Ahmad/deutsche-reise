import { useState, useCallback, useEffect } from 'react'
import { germanVoice } from '../lib/voice'

export function useVoice() {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [rate, setRateState] = useState(germanVoice.rate)
  const [voices, setVoices] = useState([])
  const [selectedVoiceURI, setSelectedVoiceURIState] = useState(germanVoice.selectedVoiceURI)

  useEffect(() => {
    const timer = setTimeout(() => {
      const v = germanVoice.getVoices()
      setVoices(v)
      if (v.length === 0) {
        // Retry after voices load
        const retry = setTimeout(() => {
          setVoices(germanVoice.reloadVoices())
        }, 1000)
        return () => clearTimeout(retry)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [])

  const speak = useCallback((text) => {
    setIsSpeaking(true)
    germanVoice.speak(text, { onEnd: () => setIsSpeaking(false) })
  }, [])

  const speakWord = useCallback((word) => {
    germanVoice.speakWord(word)
  }, [])

  const speakSentence = useCallback((sentence, { onEnd } = {}) => {
    setIsSpeaking(true)
    germanVoice.speakSentence(sentence, {
      onEnd: () => {
        setIsSpeaking(false)
        onEnd?.()
      }
    })
  }, [])

  const stop = useCallback(() => {
    germanVoice.stop()
    setIsSpeaking(false)
  }, [])

  const changeRate = useCallback((r) => {
    germanVoice.setRate(r)
    setRateState(r)
  }, [])

  const changeVoice = useCallback((uri) => {
    germanVoice.setVoice(uri)
    setSelectedVoiceURIState(uri)
  }, [])

  return {
    isSpeaking,
    speak,
    speakWord,
    speakSentence,
    stop,
    rate,
    changeRate,
    voices,
    selectedVoiceURI,
    changeVoice,
  }
}
