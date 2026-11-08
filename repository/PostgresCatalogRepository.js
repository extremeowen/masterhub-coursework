const crypto = require("node:crypto");
const { Pool } = require("pg");

class PostgresCatalogRepository {
    constructor(connectionString = process.env.DATABASE_URL) {
        if (!connectionString) throw new Error("DATABASE_URL is required");
        this.pool = new Pool({ connectionString });
        this.ready = this.initialize();
    }

    async initialize() {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS masters (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                specialty TEXT NOT NULL DEFAULT '',
                active BOOLEAN NOT NULL DEFAULT TRUE,
                "createdAt" TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS services (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                active BOOLEAN NOT NULL DEFAULT TRUE,
                "createdAt" TEXT NOT NULL
            );
        `);
        await this.seedDefaults();
    }

    async seedDefaults() {
        const now = new Date().toISOString();
        await this.pool.query(
            `INSERT INTO masters (id, name, specialty, active, "createdAt")
             VALUES ('master-1', 'Майстер 1', 'Універсальні послуги', TRUE, $1),
                    ('master-2', 'Майстер 2', 'Консультації', TRUE, $1)
             ON CONFLICT (id) DO NOTHING`,
            [now]
        );
        await this.pool.query(
            `INSERT INTO services (id, name, description, active, "createdAt")
             VALUES ('service-1', 'Консультація', 'Первинна консультація', TRUE, $1),
                    ('service-2', 'Основна послуга', 'Виконання замовленої послуги', TRUE, $1)
             ON CONFLICT (id) DO NOTHING`,
            [now]
        );
    }

    async list(kind, activeOnly = false) {
        await this.ready;
        const table = kind === "masters" ? "masters" : "services";
        const result = await this.pool.query(`SELECT * FROM ${table} ${activeOnly ? "WHERE active = TRUE" : ""} ORDER BY name`);
        return result.rows;
    }

    async findActive(kind, id) {
        await this.ready;
        const table = kind === "masters" ? "masters" : "services";
        const result = await this.pool.query(`SELECT * FROM ${table} WHERE id = $1 AND active = TRUE`, [id]);
        return result.rows[0] || null;
    }

    async create(kind, data) {
        await this.ready;
        const table = kind === "masters" ? "masters" : "services";
        const extraColumn = kind === "masters" ? "specialty" : "description";
        const id = `cat-${crypto.randomBytes(10).toString("hex")}`;
        const result = await this.pool.query(
            `INSERT INTO ${table} (id, name, ${extraColumn}, active, "createdAt")
             VALUES ($1, $2, $3, TRUE, $4) RETURNING *`,
            [id, data.name.trim(), String(data[extraColumn] || "").trim(), new Date().toISOString()]
        );
        return result.rows[0];
    }

    async update(kind, id, data) {
        await this.ready;
        const table = kind === "masters" ? "masters" : "services";
        const extraColumn = kind === "masters" ? "specialty" : "description";
        const currentResult = await this.pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
        const current = currentResult.rows[0];
        if (!current) return null;
        const result = await this.pool.query(
            `UPDATE ${table} SET name = $1, ${extraColumn} = $2, active = $3 WHERE id = $4 RETURNING *`,
            [
                data.name === undefined ? current.name : String(data.name).trim(),
                data[extraColumn] === undefined ? current[extraColumn] : String(data[extraColumn] || "").trim(),
                data.active === undefined ? current.active : Boolean(data.active),
                id,
            ]
        );
        return result.rows[0];
    }

    async deactivate(kind, id) {
        await this.ready;
        const table = kind === "masters" ? "masters" : "services";
        const result = await this.pool.query(`UPDATE ${table} SET active = FALSE WHERE id = $1`, [id]);
        return result.rowCount > 0;
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = PostgresCatalogRepository;
