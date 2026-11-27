import { loadConfig } from './config.js';
import { openDb } from './db/index.js';
import { createApp } from './app.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const { app } = createApp({ config, db });
app.listen(config.port, () => console.log(`Salama Digital listening on :${config.port}`));
