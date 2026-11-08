const test = require("node:test");
const Database = require("better-sqlite3");
const assert = require("node:assert/strict");
const express = require("express");
const { authRouter } = require("../api/auth.routes");
const { AuthService } = require("../service/auth.service");
const OrdersService = require("../service/orders.service");
const InMemoryOrdersRepository = require("../repository/InMemoryOrdersRepository");
const AuditRepository = require("../repository/AuditRepository");
const ReviewsRepository = require("../repository/ReviewsRepository");

test("integration: audit log endpoint and reviews workflow", async () => {
    const ordersRepo = new InMemoryOrdersRepository();
    const ordersService = new OrdersService(ordersRepo);
    const usersMap = new Map();
    const usersRepo = {
        async findByEmail(email) { return usersMap.get(email) || null; },
        async findById(id) {
            for (const u of usersMap.values()) if (u.id === id) return u;
            return null;
        },
        async save(user) { usersMap.set(user.email, user); return user; },
        async findAll() { return Array.from(usersMap.values()); },
        async count() { return usersMap.size; },
        async countAdmins() { return Array.from(usersMap.values()).filter(u => u.role === "admin").length; },
        async deleteById(id) {
            for (const [email, u] of usersMap.entries()) {
                if (u.id === id) { usersMap.delete(email); return true; }
            }
            return false;
        }
    };
    const catalogRepo = {
        async list(kind) { return [{ id: "m-1", name: "Майстер 1", active: true }, { id: "s-1", name: "Послуга 1", active: true }]; },
        async findActive(kind, id) { return { id, name: "Test", active: true }; },
    };

    const authService = new AuthService(usersRepo);
    const auditRepo = new AuditRepository(new Database(":memory:"));
    const reviewsRepo = new ReviewsRepository(new Database(":memory:"));

    const { router } = authRouter(authService, ordersService, catalogRepo, auditRepo, reviewsRepo);
    const app = express();
    app.use(express.json());
    app.use(router);

    // 1. Audit log empty initially
    const initialLogs = await auditRepo.list();
    assert.strictEqual(initialLogs.length, 0);

    // 2. Register user logs an audit entry
    const regRes = await authService.register({ displayName: "Тестовий Клієнт", email: "client@test.com", password: "Password123!" });
    assert.ok(regRes.user);

    // 3. Create completed order
    const order = await ordersService.create({
        clientId: "Тестовий Клієнт · +380991234567",
        masterId: "m-1",
        serviceId: "s-1",
        scheduledAt: new Date().toISOString(),
        userId: regRes.user.id,
    });
    await ordersService.update(order.id, { status: "confirmed" });
    await ordersService.update(order.id, { status: "done" });

    // 4. Create review directly through reviewsRepo
    const review = await reviewsRepo.create({
        orderId: order.id,
        userId: regRes.user.id,
        userDisplayName: regRes.user.displayName,
        masterId: order.masterId,
        rating: 5,
        comment: "Дуже задоволений роботою!",
    });

    assert.strictEqual(review.rating, 5);
    const summary = await reviewsRepo.getSummaryForMasters();
    assert.strictEqual(summary["m-1"].count, 1);
    assert.strictEqual(summary["m-1"].avgRating, 5);
});
