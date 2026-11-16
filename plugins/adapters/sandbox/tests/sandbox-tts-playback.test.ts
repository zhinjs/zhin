import { createTtsPlayback, type TtsSpeechEnvironment } from '../pages/index/segments/tts.js';

/**
 * A fake `speechSynthesis`: one shared queue; `cancel()` interrupts the utterance being read and,
 * like browsers, reports it asynchronously through `onerror`.
 */
function fakeSpeech() {
  let speaking: SpeechSynthesisUtterance | undefined;
  const log: string[] = [];
  const synthesis = {
    speak(utterance: SpeechSynthesisUtterance) { speaking = utterance; log.push(`speak:${utterance.text}`); },
    cancel() {
      const interrupted = speaking;
      speaking = undefined;
      log.push('cancel');
      if (interrupted) queueMicrotask(() => interrupted.onerror?.call(interrupted, {} as SpeechSynthesisErrorEvent));
    },
  };
  const environment: TtsSpeechEnvironment = {
    synthesis: () => synthesis,
    utterance: (text) => ({ text, onend: null, onerror: null }) as unknown as SpeechSynthesisUtterance,
  };
  return { environment, log, speaking: () => speaking?.text };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('Sandbox TTS playback (ADR 0064 G6)', () => {
  it('reading another message does not get stopped by the interrupted one', async () => {
    const speech = fakeSpeech();
    const first = createTtsPlayback(speech.environment);
    const second = createTtsPlayback(speech.environment);
    const firstDone = vi.fn();
    expect(first.start('first', firstDone)).toBe(true);
    expect(second.start('second', () => undefined)).toBe(true);
    await flush();
    // The first message learns it was interrupted; its later cleanup / stop leaves the second alone.
    expect(firstDone).toHaveBeenCalledTimes(1);
    first.stop();
    expect(speech.speaking()).toBe('second');
    expect(speech.log.filter((entry) => entry === 'cancel')).toHaveLength(2);
  });

  it('stops its own reading, once', async () => {
    const speech = fakeSpeech();
    const playback = createTtsPlayback(speech.environment);
    const done = vi.fn();
    playback.start('hello', done);
    playback.stop();
    playback.stop();
    await flush();
    expect(speech.speaking()).toBeUndefined();
    expect(done).toHaveBeenCalledTimes(1);
    expect(speech.log).toEqual(['cancel', 'speak:hello', 'cancel']);
  });

  it('does nothing without speech synthesis or text', () => {
    expect(createTtsPlayback({ synthesis: () => undefined, utterance: () => ({}) as SpeechSynthesisUtterance })
      .start('x', () => undefined)).toBe(false);
    expect(createTtsPlayback(fakeSpeech().environment).start('', () => undefined)).toBe(false);
  });
});
