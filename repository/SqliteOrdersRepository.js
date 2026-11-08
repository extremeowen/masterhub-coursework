const Database = require("better-sqlite3");
const Order = require("../domain/booking/Order");

class SqliteOrdersRepository {
    constructor(dbPath = "masterhub.db") {
        this.db = new Database(dbPath);
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS orders (
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
        const columns = this.db.prepare("PRAGMA table_info(orders)").all().map((column) => column.name);
        if (!columns.includes("userId")) this.db.exec("ALTER TABLE orders ADD COLUMN userId TEXT");
        if (!columns.includes("contactPhone")) this.db.exec("ALTER TABLE orders ADD COLUMN contactPhone TEXT");
        this._counterStmt = this.db.prepare(
            "SELECT COUNT(*) as count FROM orders"
        );
    }

    nextId() {
        const { count } = this._counterStmt.get();
        return `o-${count + 1}-${Date.now()}`;
    }

    save(order) {
        this.db
            .prepare(
                `INSERT INTO orders (id, clientId, masterId, serviceId, scheduledAt, status, createdAt, updatedAt, userId, contactPhone)
                 VALUES (@id, @clientId, @masterId, @serviceId, @scheduledAt, @status, @createdAt, @updatedAt, @userId, @contactPhone)
                     ON CONFLICT(id) DO UPDATE SET
                    clientId = excluded.clientId,
                    masterId = excluded.masterId,
                    serviceId = excluded.serviceId,
                    scheduledAt = excluded.scheduledAt,
                                            status = excluded.status,
                                            updatedAt = excluded.updatedAt,
                                            userId = COALESCE(excluded.userId, orders.userId),
                                            contactPhone = COALESCE(excluded.contactPhone, orders.contactPhone)`
            )
            .run({ ...order });
        return order;
    }

    findById(id) {
        const row = this.db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
        return row ? this._toOrder(row) : null;
    }

    findAll() {
        const rows = this.db.prepare("SELECT * FROM orders").all();
        return rows.map((r) => this._toOrder(r));
    }

    delete(id) {
        const result = this.db.prepare("DELETE FROM orders WHERE id = ?").run(id);
        return result.changes > 0;
    }

    _toOrder(row) {
        const order = new Order(
            row.id,
            row.clientId,
            row.masterId,
            row.serviceId,
            row.scheduledAt,
            row.userId || null,
            row.contactPhone || null
        );
        order.status = row.status;
        order.createdAt = row.createdAt;
        order.updatedAt = row.updatedAt;
        return order;
    }
}

module.exports = SqliteOrdersRepository;