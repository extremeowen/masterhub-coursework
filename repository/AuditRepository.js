const crypto = require("node:crypto");

class AuditRepository {
    constructor(dbOrConnectionString) {
        this.kind = "memory";
        this.memoryLogs = [];

        if (typeof dbOrConnectionString === "string" && dbOrConnectionString.startsWith("postgres")) {
            const { Pool } = require("pg");
            this.pool = new Pool({ connectionString: dbOrConnectionString });
            this.kind = "postgres";
            this.ready = this._initPostgres();
        } else if (dbOrConnectionString && typeof dbOrConnectionString === "object" && dbOrConnectionString.prepare) {
            this.db = dbOrConnectionString;
            this.kind = "sqlite";
            this._initSqlite();
        } else {
            try {
                const Database = require("better-sqlite3");
                this.db = new Database("masterhub.db");
                this.kind = "sqlite";
                this._initSqlite();
            } catch {
                this.kind = "memory";
            }
        }
    }

    async _initPostgres() {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL,
                "userId" TEXT,
                "userEmail" TEXT,
                action TEXT NOT NULL,
                details TEXT NOT NULL,
                "entityType" TEXT,
                "entityId" TEXT
            );
        `);
    }

    _initSqlite() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL,
                userId TEXT,
                userEmail TEXT,
                action TEXT NOT NULL,
                details TEXT NOT NULL,
                entityType TEXT,
                entityId TEXT
            );
        `);
    }

    async log({ userId = null, userEmail = null, action, details = "", entityType = null, entityId = null }) {
        const id = `audit-${crypto.randomUUID()}`;
        const timestamp = new Date().toISOString();
        const entry = { id, timestamp, userId, userEmail, action, details, entityType, entityId };

        if (this.kind === "postgres") {
            await this.ready;
            await this.pool.query(
                `INSERT INTO audit_logs (id, timestamp, "userId", "userEmail", action, details, "entityType", "entityId")
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [id, timestamp, userId, userEmail, action, details, entityType, entityId]
            );
        } else if (this.kind === "sqlite") {
            this.db.prepare(
                `INSERT INTO audit_logs (id, timestamp, userId, userEmail, action, details, entityType, entityId)
                 VALUES (@id, @timestamp, @userId, @userEmail, @action, @details, @entityType, @entityId)`
            ).run(entry);
        } else {
            this.memoryLogs.unshift(entry);
            if (this.memoryLogs.length > 500) this.memoryLogs.pop();
        }
        return entry;
    }

    async list(limit = 100) {
        if (this.kind === "postgres") {
            await this.ready;
            const res = await this.pool.query(
                `SELECT id, timestamp, "userId", "userEmail", action, details, "entityType", "entityId"
                 FROM audit_logs ORDER BY timestamp DESC LIMIT $1`,
                [limit]
            );
            return res.rows;
        }
        if (this.kind === "sqlite") {
            return this.db.prepare(
                `SELECT id, timestamp, userId, userEmail, action, details, entityType, entityId
                 FROM audit_logs ORDER BY timestamp DESC LIMIT ?`
            ).all(limit);
        }
        return this.memoryLogs.slice(0, limit);
    }
}

module.exports = AuditRepository;
