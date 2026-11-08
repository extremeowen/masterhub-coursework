const test = require("node:test");
const Database = require("better-sqlite3");
const assert = require("node:assert/strict");
const AuditRepository = require("../repository/AuditRepository");
const ReviewsRepository = require("../repository/ReviewsRepository");

test("audit repository records and lists log entries in descending order", async () => {
    const auditRepo = new AuditRepository(new Database(":memory:")); // ізольована in-memory БД
    await auditRepo.log({
        userId: "u-1",
        userEmail: "test@example.com",
        action: "ORDER_CREATED",
        details: "Створено замовлення #1",
        entityType: "order",
        entityId: "1",
    });
    // Різні мілісекунди, щоб порядок за timestamp був детермінованим.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await auditRepo.log({
        userId: "u-1",
        userEmail: "test@example.com",
        action: "ORDER_UPDATED",
        details: "Оновлено замовлення #1",
        entityType: "order",
        entityId: "1",
    });

    const logs = await auditRepo.list(10);
    assert.strictEqual(logs.length, 2);
    assert.strictEqual(logs[0].action, "ORDER_UPDATED");
    assert.strictEqual(logs[1].action, "ORDER_CREATED");
});

test("reviews repository creates, finds by orderId, and calculates summaries", async () => {
    const reviewsRepo = new ReviewsRepository(new Database(":memory:")); // ізольована in-memory БД
    const rev1 = await reviewsRepo.create({
        orderId: "ord-1",
        userId: "user-1",
        userDisplayName: "Олена",
        masterId: "master-1",
        rating: 5,
        comment: "Чудовий майстер!",
    });
    const rev2 = await reviewsRepo.create({
        orderId: "ord-2",
        userId: "user-2",
        userDisplayName: "Іван",
        masterId: "master-1",
        rating: 4,
        comment: "Все добре",
    });

    assert.strictEqual(rev1.rating, 5);
    const found = await reviewsRepo.findByOrderId("ord-1");
    assert.strictEqual(found.comment, "Чудовий майстер!");

    const summary = await reviewsRepo.getSummaryForMasters();
    assert.ok(summary["master-1"]);
    assert.strictEqual(summary["master-1"].count, 2);
    assert.strictEqual(summary["master-1"].avgRating, 4.5);
});
