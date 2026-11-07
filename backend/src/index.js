import { loadConfig } from './config.js';
import { createStore } from './store.js';
import { createApp } from './app.js';

const cfg = loadConfig();
const store = await createStore(cfg);
const app = createApp({ cfg, store });

const server = app.listen(cfg.port, () => {
  console.log(`TMP Graphing Studio API listening on :${cfg.port} (${cfg.isProd ? 'production' : 'development'}, store=${cfg.databaseUrl ? 'postgres' : 'file'})`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
