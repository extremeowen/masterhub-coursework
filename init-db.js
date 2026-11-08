const Database = require("better-sqlite3");
const db = new Database("masterhub.db");

db.exec(`
  DROP TABLE IF EXISTS orders;
  CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    clientId TEXT NOT NULL,
    masterId TEXT NOT NULL,
    serviceId TEXT NOT NULL,
    scheduledAt TEXT NOT NULL,
    status TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`);

console.log("Готово: створено порожню таблицю orders у masterhub.db");
db.close();
