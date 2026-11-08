const test = require("node:test");
const assert = require("node:assert/strict");
const { AuthService, hashPassword, verifyPassword } = require("../service/auth.service");

test("passwords are stored as verifiable scrypt hashes", () => {
    const encoded = hashPassword("correct horse battery staple");
    assert.match(encoded, /^scrypt\$/);
    assert.equal(verifyPassword("correct horse battery staple", encoded), true);
    assert.equal(verifyPassword("wrong password", encoded), false);
    assert.notEqual(encoded, "correct horse battery staple");
});

test("registration validates email and password before hashing", async () => {
    const repository = {
        async findByEmail() { return null; },
        async save(user) { return user; },
    };
    const auth = new AuthService(repository, "test-secret");
    assert.equal(auth.validateRegistration({ displayName: "Valid Name", email: "not-an-email", password: "password123" }), "Вкажіть коректний email.");
    assert.equal(auth.validateRegistration({ displayName: "Valid Name", email: "valid@example.test", password: "short" }), "Пароль має містити щонайменше 8 символів.");
    assert.equal(auth.validateRegistration({ displayName: "Valid Name", email: "valid@example.test", password: "validpass123" }), null);
});

test("auth service issues and validates a signed role session", async () => {
    const users = new Map();
    const repository = {
        async findByEmail(email) { return users.get(email) || null; },
        async save(user) { users.set(user.email, user); return user; },
        async findAll() { return [...users.values()]; },
        async countAdmins() { return [...users.values()].filter((user) => user.role === "admin").length; },
        async updateRole(id, role) {
            const user = [...users.values()].find((item) => item.id === id);
            if (!user) return false;
            user.role = role;
            return true;
        },
    };
    const auth = new AuthService(repository, "test-session-secret");
    await auth.seedFromEnvironment();
    await repository.save({
        id: "u-admin",
        email: "admin@example.test",
        displayName: "Admin",
        passwordHash: hashPassword("password123"),
        role: "admin",
        createdAt: new Date().toISOString(),
    });
    const result = await auth.login("admin@example.test", "password123");
    assert.equal(result.user.role, "admin");
    const cookie = auth.signCookie(result.token);
    const token = auth.verifyCookie(cookie);
    assert.deepEqual(auth.userFromToken(token), { email: "admin@example.test" });
    assert.equal(auth.verifyCookie(`${cookie}tampered`), null);
});

test("public registration always creates a user role and admin cannot demote the last admin", async () => {
    const users = new Map();
    const repository = {
        async findByEmail(email) { return users.get(email) || null; },
        async save(user) { users.set(user.email, user); return user; },
        async findAll() { return [...users.values()]; },
        async countAdmins() { return [...users.values()].filter((user) => user.role === "admin").length; },
        async updateRole(id, role) {
            const user = [...users.values()].find((item) => item.id === id);
            if (!user) return false;
            user.role = role;
            return true;
        },
    };
    const auth = new AuthService(repository, "test-secret");
    const registered = await auth.register({ displayName: "Олена", email: "olena@example.test", password: "password123" });
    assert.equal(registered.user.role, "user");
    const invalid = await auth.register({ displayName: "X", email: "bad", password: "short" });
    assert.equal(invalid.error, "Вкажіть коректний email.");
    await repository.save({
        id: "admin-1", email: "admin@example.test", displayName: "Admin",
        passwordHash: hashPassword("password123"), role: "admin", createdAt: new Date().toISOString(),
    });
    const blocked = await auth.changeRole({ id: "admin-1", role: "admin" }, "admin-1", "user");
    assert.equal(blocked.code, "LAST_ADMIN");
    const promoted = await auth.changeRole({ id: "admin-1", role: "admin" }, registered.user.id, "admin");
    assert.equal(promoted.user.role, "admin");
});
