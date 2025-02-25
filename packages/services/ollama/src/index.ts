import { Ollama } from 'ollama';
import { Schema, useConfig, provide, defineMetadata } from 'zhin';
declare module 'zhin' {
  namespace App {
    interface Services {
      ollama: Ollama;
    }
  }
}
defineMetadata({
  name: 'Ollama',
});
const Config = Schema.object({
  host: Schema.string('host'),
  model: Schema.string('model'),
  max_history: Schema.number('max_history'),
}).default({
  host: 'http://localhost:11434',
  model: 'deepseek-r1:1.5b',
  max_history: 10,
});
const config = useConfig('ollama', Config);
const ollama = new Ollama(config);
provide('ollama', ollama);
