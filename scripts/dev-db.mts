// Local development database: a real PostgreSQL 17 server run through the `embedded-postgres`
// package, so no Docker or separate PostgreSQL install is needed. Keep this process running
// while you develop or test; press Ctrl+C to stop it cleanly.
import { existsSync } from "node:fs";
import EmbeddedPostgres from "embedded-postgres";

const DATA_DIR = ".pgdata";
const PORT = 5433;
const DATABASES = ["trinetra_dev", "trinetra_test"];

const server = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "trinetra",
  password: "trinetra",
  port: PORT,
  persistent: true,
  onLog: () => {},
  onError: (message) => console.error(String(message)),
});

if (!existsSync(`${DATA_DIR}/PG_VERSION`)) await server.initialise();
await server.start();

for (const name of DATABASES) {
  try {
    await server.createDatabase(name);
    console.log(`created database ${name}`);
  } catch {
    // already exists
  }
}
console.log(`PostgreSQL ready on localhost:${PORT} (databases: ${DATABASES.join(", ")}). Ctrl+C to stop.`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await server.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30); // keep the process alive
