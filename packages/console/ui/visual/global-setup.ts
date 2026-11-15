import { buildDemo } from './build-demo.mjs';

export default async function globalSetup(): Promise<void> {
  await buildDemo();
}
