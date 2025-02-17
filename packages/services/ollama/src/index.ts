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
}).default({
  host: 'http://localhost:11434',
});
const config = useConfig('ollama', Config);
const ollama = new Ollama(config);
provide('ollama', ollama);
