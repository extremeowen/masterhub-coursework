const Database = require("better-sqlite3");

class SqliteUsersRepository {
    constructor(dbPath = "masterhub.db") {
        this.db = new Database(dbPath);
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                displayName TEXT NOT NULL,
                passwordHash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
                createdAt TEXT NOT NULL
            );
        `);
    }

    findByEmail(email) {
        return this.db.prepare("SELECT * FROM users WHERE lower(email) = lower(?)").get(email) || null;
    }

    findById(id) {
        return this.db.prepare("SELECT id, email, displayName, role, createdAt FROM users WHERE id = ?").get(id) || null;
    }

    findAll() {
        return this.db.prepare("SELECT id, email, displayName, role, createdAt FROM users ORDER BY createdAt ASC").all();
    }

    countAdmins() {
        return this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count;
    }

    updateRole(id, role) {
        const result = this.db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
        return result.changes > 0;
    }

    deleteUserAndOrders(id) {
        const transaction = this.db.transaction(() => {
            const user = this.db.prepare("SELECT id, email, role FROM users WHERE id = ?").get(id);
            if (!user) return { deleted: false, user: null };
            if (user.role === "admin") return { deleted: false, user, reason: "ADMIN_PROTECTED" };
            this.db.prepare("DELETE FROM orders WHERE userId = ?").run(id);
            this.db.prepare("DELETE FROM users WHERE id = ?").run(id);
            return { deleted: true, user };
        });
        return transaction();
    }

    save(user) {
        this.db.prepare(`
            INSERT INTO users (id, email, displayName, passwordHash, role, createdAt)
            VALUES (@id, @email, @displayName, @passwordHash, @role, @createdAt)
            ON CONFLICT(email) DO UPDATE SET
                displayName = excluded.displayName,
                passwordHash = excluded.passwordHash,
                role = excluded.role
        `).run(user);
        return user;
    }
}

module.exports = SqliteUsersRepository;
