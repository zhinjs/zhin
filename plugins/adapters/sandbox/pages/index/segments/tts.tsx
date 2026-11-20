import type { ConsoleLocale } from '@zhin.js/client';
import React, { useEffect, useMemo, useState } from 'react';
import { Volume2, Square } from 'lucide-react';
import { Button } from '@zhin.js/console-ui';
import { sandboxText } from '../messages.js';
import { stringField, type SandboxSegmentRenderer } from './context.js';

function speechSynthesisOf(): SpeechSynthesis | undefined {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : undefined;
}

/** What a TTS playback needs from the browser (injected in tests). */
export interface TtsSpeechEnvironment {
  readonly synthesis: () => Pick<SpeechSynthesis, 'speak' | 'cancel'> | undefined;
  readonly utterance: (text: string) => SpeechSynthesisUtterance;
}

const browserSpeech: TtsSpeechEnvironment = {
  synthesis: speechSynthesisOf,
  utterance: (text) => new SpeechSynthesisUtterance(text),
};

/** The utterance the page is reading now; `speechSynthesis` is one queue shared by every message. */
let currentUtterance: SpeechSynthesisUtterance | undefined;

/**
 * One message's read-aloud control. `speechSynthesis.cancel()` stops whatever is being read, so a
 * message only cancels while its own utterance is the current one: a message that was interrupted
 * by another one (or unmounted later) never stops the other message's reading.
 */
export function createTtsPlayback(environment: TtsSpeechEnvironment = browserSpeech) {
  let own: SpeechSynthesisUtterance | undefined;
  const stop = () => {
    if (own && currentUtterance === own) {
      currentUtterance = undefined;
      environment.synthesis()?.cancel();
    }
    own = undefined;
  };
  return {
    /** Starts reading `text`; `onDone` runs once it ends, fails or is interrupted. */
    start(text: string, onDone: () => void): boolean {
      const synthesis = environment.synthesis();
      if (!synthesis || !text) return false;
      const utterance = environment.utterance(text);
      const done = () => {
        if (currentUtterance === utterance) currentUtterance = undefined;
        if (own === utterance) own = undefined;
        onDone();
      };
      utterance.onend = done;
      utterance.onerror = done;
      own = utterance;
      currentUtterance = utterance;
      synthesis.cancel();
      synthesis.speak(utterance);
      return true;
    },
    stop,
  };
}

/** ADR 0064 G6: a `tts` segment shows its text and reads it aloud with the browser's speech synthesis. */
function TtsMessage({ text, locale }: { readonly text: string; readonly locale: ConsoleLocale }) {
  const [speaking, setSpeaking] = useState(false);
  const [available, setAvailable] = useState(false);
  const playback = useMemo(() => createTtsPlayback(), []);
  useEffect(() => { setAvailable(Boolean(speechSynthesisOf())); }, []);
  // Unmounting stops only this message's own reading (never another message's).
  useEffect(() => () => playback.stop(), [playback]);
  const toggle = () => {
    if (speaking) { playback.stop(); setSpeaking(false); return; }
    if (playback.start(text, () => setSpeaking(false))) setSpeaking(true);
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
