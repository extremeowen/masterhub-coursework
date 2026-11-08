const crypto = require("node:crypto");

class ReviewsRepository {
    constructor(dbOrConnectionString) {
        this.kind = "memory";
        this.memoryReviews = [];

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
            CREATE TABLE IF NOT EXISTS reviews (
                id TEXT PRIMARY KEY,
                "orderId" TEXT NOT NULL UNIQUE,
                "userId" TEXT NOT NULL,
                "userDisplayName" TEXT,
                "masterId" TEXT NOT NULL,
                rating INTEGER NOT NULL,
                comment TEXT,
                "createdAt" TEXT NOT NULL
            );
        `);
    }

    _initSqlite() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS reviews (
                id TEXT PRIMARY KEY,
                orderId TEXT NOT NULL UNIQUE,
                userId TEXT NOT NULL,
                userDisplayName TEXT,
                masterId TEXT NOT NULL,
                rating INTEGER NOT NULL,
                comment TEXT,
                createdAt TEXT NOT NULL
            );
        `);
    }

    async create({ orderId, userId, userDisplayName = "", masterId, rating, comment = "" }) {
        const id = `rev-${crypto.randomUUID()}`;
        const createdAt = new Date().toISOString();
        const numRating = Math.max(1, Math.min(5, Number(rating) || 5));
        const entry = { id, orderId, userId, userDisplayName, masterId, rating: numRating, comment: String(comment || "").trim(), createdAt };

        if (this.kind === "postgres") {
            await this.ready;
            await this.pool.query(
                `INSERT INTO reviews (id, "orderId", "userId", "userDisplayName", "masterId", rating, comment, "createdAt")
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [id, orderId, userId, userDisplayName, masterId, numRating, entry.comment, createdAt]
            );
        } else if (this.kind === "sqlite") {
            this.db.prepare(
                `INSERT INTO reviews (id, orderId, userId, userDisplayName, masterId, rating, comment, createdAt)
                 VALUES (@id, @orderId, @userId, @userDisplayName, @masterId, @rating, @comment, @createdAt)`
            ).run(entry);
        } else {
            this.memoryReviews.push(entry);
        }
        return entry;
    }

    async findByOrderId(orderId) {
        if (this.kind === "postgres") {
            await this.ready;
            const res = await this.pool.query(`SELECT * FROM reviews WHERE "orderId" = $1`, [orderId]);
            return res.rows[0] || null;
        }
        if (this.kind === "sqlite") {
            return this.db.prepare(`SELECT * FROM reviews WHERE orderId = ?`).get(orderId) || null;
        }
        return this.memoryReviews.find((r) => r.orderId === orderId) || null;
    }

    async listForMaster(masterId) {
        if (this.kind === "postgres") {
            await this.ready;
            const res = await this.pool.query(
                `SELECT * FROM reviews WHERE "masterId" = $1 ORDER BY "createdAt" DESC`,
                [masterId]
            );
            return res.rows;
        }
        if (this.kind === "sqlite") {
            return this.db.prepare(`SELECT * FROM reviews WHERE masterId = ? ORDER BY createdAt DESC`).all(masterId);
        }
        return this.memoryReviews.filter((r) => r.masterId === masterId);
    }

    async listAll() {
        if (this.kind === "postgres") {
            await this.ready;
            const res = await this.pool.query(`SELECT * FROM reviews ORDER BY "createdAt" DESC`);
            return res.rows;
        }
        if (this.kind === "sqlite") {
            return this.db.prepare(`SELECT * FROM reviews ORDER BY createdAt DESC`).all();
        }
        return [...this.memoryReviews].reverse();
    }

    async getSummaryForMasters() {
        const all = await this.listAll();
        const summary = {};
        for (const rev of all) {
            const mId = rev.masterId;
            if (!summary[mId]) {
                summary[mId] = { totalRating: 0, count: 0, avgRating: 0, reviews: [] };
            }
            summary[mId].totalRating += Number(rev.rating) || 5;
            summary[mId].count += 1;
            summary[mId].reviews.push(rev);
        }
        for (const mId in summary) {
            summary[mId].avgRating = Number((summary[mId].totalRating / summary[mId].count).toFixed(1));
        }
        return summary;
    }
}

module.exports = ReviewsRepository;
