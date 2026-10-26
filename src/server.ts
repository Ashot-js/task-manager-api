import { createApp } from './app';
import { config } from './config';
import { migrate } from './db';

async function main() {
  await migrate();
  createApp().listen(config.port, () => {
    console.log(`[api] listening on :${config.port} — docs at /docs`);
  });
}

main().catch((err) => {
  console.error('[api] failed to start:', err);
  process.exit(1);
});
