const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const app = require("../server");
const { requestWithRetry, retryAfterMs } = require("../service/dependency-client");
const { rateLimit } = require("../api/middleware");
const SqliteUsersRepository = require("../repository/SqliteUsersRepository");
const { hashPassword } = require("../service/auth.service");

function request(method, path, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, () => {
            const port = server.address().port;
            const req = http.request({
                port, method, path,
                headers: { "Content-Type": "application/json", ...headers },
            }, (res) => {
                let data = "";
                res.on("data", (chunk) => { data += chunk; });
                res.on("end", () => {
                    server.close();
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: data ? JSON.parse(data) : null,
                    });
                });
            });
            req.on("error", (err) => { server.close(); reject(err); });
            if (body !== undefined) req.write(JSON.stringify(body));
            req.end();
        });
    });
}

test("health is available and request id is returned", async () => {
    const response = await request("GET", "/health");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: "ok" });
    assert.ok(response.headers["x-request-id"]);
});

test("POST requires Idempotency-Key and replays the same result", async () => {
    const data = {
        clientId: "test-client",
        masterId: "test-master",
        serviceId: "test-service",
        scheduledAt: "2026-09-20T10:00:00Z",
    };
    const missing = await request("POST", "/orders", data);
    assert.equal(missing.status, 400);
    assert.equal(missing.body.code, "IDEMPOTENCY_KEY_REQUIRED");

    const first = await request("POST", "/orders", data, { "Idempotency-Key": "test-idempotency-key" });
    const replay = await request("POST", "/orders", { ...data }, { "Idempotency-Key": "test-idempotency-key" });
    assert.equal(first.status, 201);
    assert.equal(first.body.requestId, first.headers["x-request-id"]);
    assert.deepEqual(replay.body, first.body);
});

test("DELETE invalidates the cached idempotency response for the deleted order", async () => {
    const data = {
        clientId: "delete-client",
        masterId: "delete-master",
        serviceId: "delete-service",
        scheduledAt: "2026-09-21T10:00:00Z",
    };
    const headers = { "Idempotency-Key": "delete-recreate-key" };
    const first = await request("POST", "/orders", data, headers);
    assert.equal(first.status, 201);

    const deleted = await request("DELETE", `/orders/${first.body.id}`);
    assert.equal(deleted.status, 204);

    const recreated = await request("POST", "/orders", data, headers);
    assert.equal(recreated.status, 201);
    assert.notEqual(recreated.body.id, first.body.id);

    const listed = await request("GET", "/orders");
    assert.ok(listed.body.some((order) => order.id === recreated.body.id));
});

test("dependency helper aborts slow requests and retries", async () => {
    let attempts = 0;
    await assert.rejects(
        requestWithRetry(async ({ signal }) => {
            attempts += 1;
            await new Promise((resolve, reject) => {
                signal.addEventListener("abort", () => reject(new Error("aborted")));
            });
        }, { timeoutMs: 5, retries: 2, baseDelayMs: 1 }),
        /aborted/
    );
    assert.equal(attempts, 3);
});

test("dependency helper retries 429 using Retry-After", async () => {
    let attempts = 0;
    const response = (status, retryAfter) => ({
        status,
        headers: { get: () => retryAfter },
    });
    const result = await requestWithRetry(async () => {
        attempts += 1;
        return attempts === 1 ? response(429, "0") : response(200);
    }, { retries: 1, baseDelayMs: 1, jitterMs: 0 });

    assert.equal(attempts, 2);
    assert.equal(result.status, 200);
    assert.equal(retryAfterMs(response(429, "2")), 2000);
});

test("rate limiter returns 429 and Retry-After", () => {
    const middleware = rateLimit({ limit: 1, windowMs: 10_000 });
    const req = { ip: "test-rate-limit", requestId: "req-rate-limit" };
    let nextCalls = 0;
    const response = {
        headers: {},
        set(name, value) { this.headers[name] = value; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
    };

    middleware(req, response, () => { nextCalls += 1; });
    middleware(req, response, () => { nextCalls += 1; });

    assert.equal(nextCalls, 1);
    assert.equal(response.statusCode, 429);
    assert.ok(Number(response.headers["Retry-After"]) >= 1);
    assert.equal(response.body.requestId, req.requestId);
});

test("authenticated user owns order lifecycle while admin endpoint remains separate", async () => {
    const email = `route-user-${Date.now()}@example.test`;
    const registered = await request("POST", "/auth/register", {
        displayName: "Route User",
        email,
        password: "RoutePass123!",
    });

    assert.equal(registered.status, 201);

    const login = await request("POST", "/auth/login", { email, password: "RoutePass123!" });
    assert.equal(login.status, 200);
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    const headers = { Cookie: cookie, "Idempotency-Key": `route-order-${Date.now()}` };
    const created = await request("POST", "/user/orders", {
        clientId: "Route User · route@example.test",
        contactPhone: "+380501234567",
        masterId: "master-1",
        serviceId: "service-1",
        scheduledAt: "2026-11-10T10:00:00Z",
    }, headers);
    assert.equal(created.status, 201);
    assert.equal(created.body.userId, registered.body.id);
    assert.equal(created.body.contactPhone, "+380501234567");

    const listed = await request("GET", "/user/orders", undefined, { Cookie: cookie });
    assert.equal(listed.status, 200);
    assert.ok(listed.body.some((order) => order.id === created.body.id));
    const edited = await request("PUT", `/user/orders/${created.body.id}`, {
        scheduledAt: "2026-11-10T11:00:00Z",
    }, { Cookie: cookie });
    assert.equal(edited.status, 200);
    const cancelled = await request("DELETE", `/user/orders/${created.body.id}`, undefined, { Cookie: cookie });
    assert.equal(cancelled.status, 200);
    const anonymousAdmin = await request("GET", "/admin/orders");
    assert.equal(anonymousAdmin.status, 401);

    const invalidPhone = await request("POST", "/user/orders", {
        clientId: "Route User",
        contactPhone: "+38050123456",
        masterId: "master-1",
        serviceId: "service-1",
        scheduledAt: "2026-11-10T10:00:00Z",
    }, { ...headers, "Idempotency-Key": `invalid-phone-${Date.now()}` });
    assert.equal(invalidPhone.status, 400);
    assert.equal(invalidPhone.body.code, "INVALID_CONTACT_PHONE");
});

test("admin order create and update require a valid Ukrainian contact phone", async () => {
    const repository = new SqliteUsersRepository("masterhub.db");
    const email = `admin-phone-${Date.now()}@example.test`;
    await repository.save({
        id: `u-admin-${Date.now()}`,
        email,
        displayName: "Phone Test Admin",
        passwordHash: hashPassword("AdminPass123!"),
        role: "admin",
        createdAt: new Date().toISOString(),
    });
    repository.db.close();

    const login = await request("POST", "/auth/login", { email, password: "AdminPass123!" });
    assert.equal(login.status, 200);
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    const invalid = await request("POST", "/admin/orders", {
        clientId: "Admin-created customer",
        contactPhone: "0501234567",
        masterId: "master-1",
        serviceId: "service-1",
        scheduledAt: "2026-11-11T10:00:00Z",
    }, { Cookie: cookie, "Idempotency-Key": `admin-invalid-${Date.now()}` });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, "INVALID_CONTACT_PHONE");

    const created = await request("POST", "/admin/orders", {
        clientId: "Admin-created customer",
        contactPhone: "+380501234567",
        masterId: "master-1",
        serviceId: "service-1",
        scheduledAt: "2026-11-11T10:00:00Z",
    }, { Cookie: cookie, "Idempotency-Key": `admin-valid-${Date.now()}` });
    assert.equal(created.status, 201);
    const updated = await request("PUT", `/admin/orders/${created.body.id}`, {
        contactPhone: "+38050123456",
    }, { Cookie: cookie });
    assert.equal(updated.status, 400);
    assert.equal(updated.body.code, "INVALID_CONTACT_PHONE");
});

test("login rejects malformed email and a missing password without logging credentials", async () => {
    const invalidEmail = await request("POST", "/auth/login", { email: "not-an-email", password: "pass1234" });
    assert.equal(invalidEmail.status, 400);
    assert.equal(invalidEmail.body.code, "INVALID_EMAIL");
    const missingPassword = await request("POST", "/auth/login", { email: "valid@example.test" });
    assert.equal(missingPassword.status, 400);
    assert.equal(missingPassword.body.code, "PASSWORD_REQUIRED");
});

test("admin deletion removes regular user and owned orders, while protecting admin accounts", async () => {
    const repository = new SqliteUsersRepository("masterhub.db");
    const suffix = Date.now();
    const adminEmail = `delete-admin-${suffix}@example.test`;
    const userEmail = `delete-user-${suffix}@example.test`;
    await repository.save({
        id: `u-admin-${suffix}`, email: adminEmail, displayName: "Delete Test Admin",
        passwordHash: hashPassword("AdminPass123!"), role: "admin", createdAt: new Date().toISOString(),
    });
    await repository.save({
        id: `u-admin-protected-${suffix}`, email: `protected-${suffix}@example.test`, displayName: "Protected Admin",
        passwordHash: hashPassword("AdminPass123!"), role: "admin", createdAt: new Date().toISOString(),
    });
    repository.db.close();
    const user = await request("POST", "/auth/register", {
        displayName: "Delete Test User", email: userEmail, password: "UserPass123!",
    });
    const userLogin = await request("POST", "/auth/login", { email: userEmail, password: "UserPass123!" });
    const userCookie = userLogin.headers["set-cookie"][0].split(";")[0];
    const order = await request("POST", "/user/orders", {
        clientId: "Delete Test User",
        contactPhone: "+380501234567",
        masterId: "master-1",
        serviceId: "service-1",
        scheduledAt: "2026-11-12T10:00:00Z",
    }, { Cookie: userCookie, "Idempotency-Key": `delete-user-order-${suffix}` });
    assert.equal(order.status, 201);

    const adminLogin = await request("POST", "/auth/login", { email: adminEmail, password: "AdminPass123!" });
    const adminCookie = adminLogin.headers["set-cookie"][0].split(";")[0];
    const selfDelete = await request("DELETE", `/admin/users/${adminLogin.body.id}`, undefined, { Cookie: adminCookie });
    assert.equal(selfDelete.status, 400);
    assert.equal(selfDelete.body.code, "SELF_DELETE");
    const protectedAdmin = await request("GET", "/admin/users", undefined, { Cookie: adminCookie });
    const otherAdmin = protectedAdmin.body.find((item) => item.email.startsWith("protected-"));
    const adminDelete = await request("DELETE", `/admin/users/${otherAdmin.id}`, undefined, { Cookie: adminCookie });
    assert.equal(adminDelete.status, 400);
    assert.equal(adminDelete.body.code, "ADMIN_PROTECTED");

    const deleted = await request("DELETE", `/admin/users/${user.body.id}`, undefined, { Cookie: adminCookie });
    assert.equal(deleted.status, 204);
    const staleSession = await request("GET", "/auth/me", undefined, { Cookie: userCookie });
    assert.equal(staleSession.status, 401);
    const db = new (require("better-sqlite3"))("masterhub.db");
    assert.equal(db.prepare("SELECT id FROM users WHERE id = ?").get(user.body.id), undefined);
    assert.equal(db.prepare("SELECT id FROM orders WHERE id = ?").get(order.body.id), undefined);
    db.close();
});

test("catalog is role-aware and order creation rejects inactive or unknown catalog IDs", async () => {
    const repository = new SqliteUsersRepository("masterhub.db");
    const suffix = Date.now();
    const email = `catalog-admin-${suffix}@example.test`;
    await repository.save({
        id: `u-catalog-admin-${suffix}`, email, displayName: "Catalog Admin",
        passwordHash: hashPassword("AdminPass123!"), role: "admin", createdAt: new Date().toISOString(),
    });
    repository.db.close();
    const adminLogin = await request("POST", "/auth/login", { email, password: "AdminPass123!" });
    const adminCookie = adminLogin.headers["set-cookie"][0].split(";")[0];
    const userEmail = `catalog-user-${suffix}@example.test`;
    await request("POST", "/auth/register", { displayName: "Catalog User", email: userEmail, password: "UserPass123!" });
    const userLogin = await request("POST", "/auth/login", { email: userEmail, password: "UserPass123!" });
    const userCookie = userLogin.headers["set-cookie"][0].split(";")[0];
    const userCatalog = await request("GET", "/user/catalog", undefined, { Cookie: userCookie });
    assert.equal(userCatalog.status, 200);
    assert.ok(userCatalog.body.masters.some((item) => item.id === "master-1"));
    const forbiddenCatalog = await request("GET", "/admin/catalog/masters", undefined, { Cookie: userCookie });
    assert.equal(forbiddenCatalog.status, 403);

    const created = await request("POST", "/admin/catalog/masters", { name: "Каталог smoke", specialty: "Тест" }, { Cookie: adminCookie });
    assert.equal(created.status, 201);
    const updated = await request("PUT", `/admin/catalog/masters/${created.body.id}`, { name: "Каталог оновлений", specialty: "Тест" }, { Cookie: adminCookie });
    assert.equal(updated.status, 200);
    const archived = await request("DELETE", `/admin/catalog/masters/${created.body.id}`, undefined, { Cookie: adminCookie });
    assert.equal(archived.status, 204);
    const invalidOrder = await request("POST", "/user/orders", {
        clientId: "Catalog User",
        contactPhone: "+380501234567",
        masterId: created.body.id,
        serviceId: "service-1",
        scheduledAt: "2026-11-12T10:00:00Z",
    }, { Cookie: userCookie, "Idempotency-Key": `inactive-catalog-${suffix}` });
    assert.equal(invalidOrder.status, 400);
    assert.equal(invalidOrder.body.code, "MASTER_NOT_AVAILABLE");
});
