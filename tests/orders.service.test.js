const test = require("node:test");
const assert = require("node:assert/strict");
const OrdersService = require("../service/orders.service");
const InMemoryOrdersRepository = require("../repository/InMemoryOrdersRepository");

function makeService() {
    return new OrdersService(new InMemoryOrdersRepository());
}

test("успішний випадок: створення замовлення з коректними даними", () => {
    const service = makeService();

    const order = service.create({
        clientId: "c-1",
        masterId: "m-1",
        serviceId: "s-1",
        scheduledAt: "2026-09-20T10:00:00Z",
    });

    assert.equal(order.status, "pending");
    assert.ok(order.id);
    assert.equal(order.clientId, "c-1");
});

test("помилковий випадок: відсутнє обов'язкове поле clientId", () => {
    const service = makeService();

    assert.throws(
        () =>
            service.create({
                masterId: "m-1",
                serviceId: "s-1",
                scheduledAt: "2026-09-20T10:00:00Z",
            }),
        (err) => {
            assert.equal(err.name, "ValidationError");
            assert.equal(err.code, "ORDER_INVALID");
            assert.ok(err.details.some((d) => d.field === "clientId"));
            return true;
        }
    );
});

test("успішний випадок: повний цикл замовлення confirm -> done", () => {
    const service = makeService();
    const created = service.create({
        clientId: "c-1",
        masterId: "m-1",
        serviceId: "s-1",
        scheduledAt: "2026-09-20T10:00:00Z",
    });

    const confirmed = service.update(created.id, { status: "confirmed" });
    assert.equal(confirmed.status, "confirmed");

    const done = service.update(created.id, { status: "done" });
    assert.equal(done.status, "done");
});

test("помилковий випадок: оновлення неіснуючого замовлення повертає NotFoundError", () => {
    const service = makeService();

    assert.throws(
        () => service.update("o-does-not-exist", { status: "confirmed" }),
        (err) => {
            assert.equal(err.name, "NotFoundError");
            assert.equal(err.code, "ORDER_NOT_FOUND");
            return true;
        }
    );
});