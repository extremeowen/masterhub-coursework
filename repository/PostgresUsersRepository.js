const crypto = require("node:crypto");
const { Pool } = require("pg");

class PostgresUsersRepository {
    constructor(connectionString = process.env.DATABASE_URL) {
        if (!connectionString) throw new Error("DATABASE_URL is required");
        this.pool = new Pool({ connectionString });
        this.ready = this.initialize();
    }

    async initialize() {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                "displayName" TEXT NOT NULL,
                "passwordHash" TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
                "createdAt" TEXT NOT NULL
            );
        `);
    }

    async findByEmail(email) {
        await this.ready;
        const result = await this.pool.query(
            `SELECT id, email, "displayName", "passwordHash", role, "createdAt"
             FROM users WHERE lower(email) = lower($1)`,
            [email]
        );
        return result.rows[0] || null;
    }

    async findById(id) {
        await this.ready;
        const result = await this.pool.query(
            `SELECT id, email, "displayName", role, "createdAt" FROM users WHERE id = $1`,
            [id]
        );
        return result.rows[0] || null;
    }

    async findAll() {
        await this.ready;
        const result = await this.pool.query(
            `SELECT id, email, "displayName", role, "createdAt"
             FROM users ORDER BY "createdAt" ASC`
        );
        return result.rows;
    }

    async countAdmins() {
        await this.ready;
        const result = await this.pool.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'");
        return result.rows[0].count;
    }

    async updateRole(id, role) {
        await this.ready;
        const result = await this.pool.query("UPDATE users SET role = $1 WHERE id = $2", [role, id]);
        return result.rowCount > 0;
    }

    async deleteUserAndOrders(id) {
        await this.ready;
        const client = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const found = await client.query('SELECT id, email, role FROM users WHERE id = $1 FOR UPDATE', [id]);
            const user = found.rows[0] || null;
            if (!user) {
                await client.query("ROLLBACK");
                return { deleted: false, user: null };
            }
            if (user.role === "admin") {
                await client.query("ROLLBACK");
                return { deleted: false, user, reason: "ADMIN_PROTECTED" };
            }
            await client.query('DELETE FROM orders WHERE "userId" = $1', [id]);
            await client.query("DELETE FROM users WHERE id = $1", [id]);
            await client.query("COMMIT");
            return { deleted: true, user };
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    }

    async save(user) {
        await this.ready;
        await this.pool.query(`
            INSERT INTO users (id, email, "displayName", "passwordHash", role, "createdAt")
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (email) DO UPDATE SET
                "displayName" = EXCLUDED."displayName",
                "passwordHash" = EXCLUDED."passwordHash",
                role = EXCLUDED.role
        `, [user.id, user.email, user.displayName, user.passwordHash, user.role, user.createdAt]);
        return user;
    }

    async close() {
        await this.pool.end();
    }
}

module.exports = PostgresUsersRepository;
