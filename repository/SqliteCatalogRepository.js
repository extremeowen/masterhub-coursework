const Database = require("better-sqlite3");
const crypto = require("node:crypto");

class SqliteCatalogRepository {
    constructor(dbPath = "masterhub.db") {
        this.db = new Database(dbPath);
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS masters (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                specialty TEXT NOT NULL DEFAULT '',
                active INTEGER NOT NULL DEFAULT 1,
                createdAt TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS services (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                active INTEGER NOT NULL DEFAULT 1,
                createdAt TEXT NOT NULL
            );
        `);
        this.seedDefaults();
    }

    seedDefaults() {
        const now = new Date().toISOString();
        const insertMaster = this.db.prepare("INSERT OR IGNORE INTO masters (id, name, specialty, active, createdAt) VALUES (?, ?, ?, 1, ?)");
        const insertService = this.db.prepare("INSERT OR IGNORE INTO services (id, name, description, active, createdAt) VALUES (?, ?, ?, 1, ?)");
        const seed = this.db.transaction(() => {
            insertMaster.run("master-1", "Майстер 1", "Універсальні послуги", now);
            insertMaster.run("master-2", "Майстер 2", "Консультації", now);
            insertService.run("service-1", "Консультація", "Первинна консультація", now);
            insertService.run("service-2", "Основна послуга", "Виконання замовленої послуги", now);
        });
        seed();
    }

    list(kind, activeOnly = false) {
        const table = kind === "masters" ? "masters" : "services";
        const where = activeOnly ? "WHERE active = 1" : "";
        return this.db.prepare(`SELECT * FROM ${table} ${where} ORDER BY name`).all()
            .map((row) => ({ ...row, active: Boolean(row.active) }));
    }

    findActive(kind, id) {
        const table = kind === "masters" ? "masters" : "services";
        const row = this.db.prepare(`SELECT * FROM ${table} WHERE id = ? AND active = 1`).get(id);
        return row ? { ...row, active: Boolean(row.active) } : null;
    }

    create(kind, data) {
        const table = kind === "masters" ? "masters" : "services";
        const extraColumn = kind === "masters" ? "specialty" : "description";
        const id = `cat-${crypto.randomBytes(10).toString("hex")}`;
        const record = {
            id,
            name: data.name.trim(),
            extra: String(data[extraColumn] || "").trim(),
            active: true,
            createdAt: new Date().toISOString(),
        };
        this.db.prepare(`INSERT INTO ${table} (id, name, ${extraColumn}, active, createdAt) VALUES (?, ?, ?, 1, ?)`)
            .run(record.id, record.name, record.extra, record.createdAt);
        return { id: record.id, name: record.name, [extraColumn]: record.extra, active: true, createdAt: record.createdAt };
    }

    update(kind, id, data) {
        const table = kind === "masters" ? "masters" : "services";
        const extraColumn = kind === "masters" ? "specialty" : "description";
        const current = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
        if (!current) return null;
        const name = data.name === undefined ? current.name : String(data.name).trim();
        const extra = data[extraColumn] === undefined ? current[extraColumn] : String(data[extraColumn] || "").trim();
        const active = data.active === undefined ? current.active : (data.active ? 1 : 0);
        this.db.prepare(`UPDATE ${table} SET name = ?, ${extraColumn} = ?, active = ? WHERE id = ?`)
            .run(name, extra, active, id);
        return { id, name, [extraColumn]: extra, active: Boolean(active), createdAt: current.createdAt };
    }

    deactivate(kind, id) {
        const table = kind === "masters" ? "masters" : "services";
        const result = this.db.prepare(`UPDATE ${table} SET active = 0 WHERE id = ?`).run(id);
        return result.changes > 0;
    }
}

module.exports = SqliteCatalogRepository;
