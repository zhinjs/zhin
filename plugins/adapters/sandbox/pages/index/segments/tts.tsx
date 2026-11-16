import React, { useEffect, useState } from 'react';
import { Volume2, Square } from 'lucide-react';
import { Button } from '@zhin.js/console-ui';
import { sandboxText, type SandboxLocale } from '../messages.js';
import { stringField, type SandboxSegmentRenderer } from './context.js';

function speechSynthesisOf(): SpeechSynthesis | undefined {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : undefined;
}

/** ADR 0064 G6: a `tts` segment shows its text and reads it aloud with the browser's speech synthesis. */
function TtsMessage({ text, locale }: { readonly text: string; readonly locale: SandboxLocale }) {
  const [speaking, setSpeaking] = useState(false);
  const [available, setAvailable] = useState(false);
  useEffect(() => { setAvailable(Boolean(speechSynthesisOf())); }, []);
  useEffect(() => () => { if (speaking) speechSynthesisOf()?.cancel(); }, [speaking]);
  const toggle = () => {
    const synthesis = speechSynthesisOf();
    if (!synthesis) return;
    if (speaking) { synthesis.cancel(); setSpeaking(false); return; }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    synthesis.cancel();
    synthesis.speak(utterance);
    setSpeaking(true);
  };
  return (
    <div className="sandbox-tts">
      <Button type="button" size="sm" variant="outline" onClick={toggle} disabled={!available || !text}
        title={available ? undefined : sandboxText(locale, "当前浏览器不支持语音朗读")}>
        {speaking ? <Square size={14} aria-hidden="true" /> : <Volume2 size={14} aria-hidden="true" />}
        {speaking ? sandboxText(locale, "停止朗读") : sandboxText(locale, "朗读")}
      </Button>
      <span className="sandbox-tts-text">{text}</span>
    </div>
  );
}

export const renderTts: SandboxSegmentRenderer = (data, { locale }, key) => (
  <TtsMessage key={key} text={stringField(data, 'text', 'content')} locale={locale} />
);
