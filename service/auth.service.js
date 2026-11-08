const crypto = require("node:crypto");

const SESSION_COOKIE = "masterhub_session";

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
    const derived = crypto.scryptSync(password, salt, 64).toString("hex");
    return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, encoded) {
    const [scheme, salt, expected] = String(encoded || "").split("$");
    if (scheme !== "scrypt" || !salt || !expected) return false;
    const actual = crypto.scryptSync(password, salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || "").trim());
}

class AuthService {
    constructor(usersRepository, sessionSecret = process.env.SESSION_SECRET) {
        this.users = usersRepository;
        this.sessionSecret = sessionSecret || crypto.randomBytes(32).toString("hex");
        this.sessions = new Map();
        this.revokedSessions = new Set();
    }

    async seedFromEnvironment() {
        const candidates = [
            { email: process.env.MASTERHUB_ADMIN_EMAIL, password: process.env.MASTERHUB_ADMIN_PASSWORD, role: "admin", displayName: "Адміністратор" },
            { email: process.env.MASTERHUB_USER_EMAIL, password: process.env.MASTERHUB_USER_PASSWORD, role: "user", displayName: "Користувач" },
        ];
        for (const candidate of candidates) {
            if (!candidate.email && !candidate.password) continue;
            if (!candidate.email || !candidate.password || candidate.password.length < 8) {
                throw new Error("Auth seed requires email and a password of at least 8 characters");
            }
            await this.users.save({
                id: `u-${crypto.createHash("sha256").update(candidate.email.toLowerCase()).digest("hex").slice(0, 16)}`,
                email: candidate.email.toLowerCase(),
                displayName: candidate.displayName,
                passwordHash: hashPassword(candidate.password),
                role: candidate.role,
                createdAt: new Date().toISOString(),
            });
        }
    }

    async login(email, password) {
        if (!validEmail(email) || !password) return null;
        const user = await this.users.findByEmail(email.trim().toLowerCase());
        if (!user || !verifyPassword(password, user.passwordHash)) return null;
        const payload = {
            email: user.email,
            exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
            nonce: crypto.randomBytes(16).toString("hex"),
        };
        const token = Buffer.from(JSON.stringify(payload)).toString("base64url");
        this.sessions.set(token, payload);
        return { token, user: this.publicUser(user) };
    }

    validateRegistration(data) {
        const email = String(data?.email || "").trim().toLowerCase();
        const displayName = String(data?.displayName || "").trim();
        const password = String(data?.password || "");
        if (!validEmail(email)) return "Вкажіть коректний email.";
        if (displayName.length < 2 || displayName.length > 80) return "Ім'я має містити від 2 до 80 символів.";
        if (password.length < 8) return "Пароль має містити щонайменше 8 символів.";
        return null;
    }

    async register(data) {
        const error = this.validateRegistration(data);
        if (error) return { error };
        const email = data.email.trim().toLowerCase();
        if (await this.users.findByEmail(email)) return { error: "Користувач із таким email вже існує.", code: "USER_EXISTS" };
        const user = {
            id: `u-${crypto.randomBytes(10).toString("hex")}`,
            email,
            displayName: data.displayName.trim(),
            passwordHash: hashPassword(data.password),
            role: "user",
            createdAt: new Date().toISOString(),
        };
        await this.users.save(user);
        return { user: this.publicUser(user) };
    }

    async listUsers() {
        return (await this.users.findAll()).map((user) => this.publicUser(user));
    }

    async changeRole(actor, userId, role) {
        if (!["user", "admin"].includes(role)) return { error: "Невідома роль." };
        const users = await this.users.findAll();
        const target = users.find((user) => user.id === userId);
        if (!target) return { error: "Користувача не знайдено.", code: "USER_NOT_FOUND" };
        if (target.role === "admin" && role === "user" && (await this.users.countAdmins()) <= 1) {
            return { error: "Не можна знизити останнього адміністратора.", code: "LAST_ADMIN" };
        }
        if (actor.id === userId && role !== "admin" && (await this.users.countAdmins()) <= 1) {
            return { error: "Не можна зняти роль останнього адміністратора.", code: "LAST_ADMIN" };
        }
        await this.users.updateRole(userId, role);
        return { user: this.publicUser({ ...target, role }) };
    }

    async deleteUser(actor, userId) {
        if (actor.id === userId) return { error: "Не можна видалити власний обліковий запис.", code: "SELF_DELETE" };
        const target = await this.users.findById(userId);
        if (!target) return { error: "Користувача не знайдено.", code: "USER_NOT_FOUND" };
        if (target.role === "admin") return { error: "Облікові записи адміністраторів захищені від видалення.", code: "ADMIN_PROTECTED" };
        const result = await this.users.deleteUserAndOrders(userId);
        if (!result.deleted) return { error: "Не вдалося видалити обліковий запис.", code: result.reason || "DELETE_FAILED" };
        for (const [token, session] of this.sessions.entries()) {
            if (session.email === result.user.email) {
                this.sessions.delete(token);
                this.revokedSessions.add(token);
            }
        }
        return { deleted: true, user: { id: result.user.id, email: result.user.email } };
    }

    logout(token) {
        if (token) {
            this.sessions.delete(token);
            this.revokedSessions.add(token);
        }
    }

    userFromToken(token) {
        if (!token || this.revokedSessions.has(token)) return null;
        let session = this.sessions.get(token);
        if (!session) {
            try {
                session = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
            } catch {
                return null;
            }
        }
        const expiresAt = session?.exp || session?.expiresAt;
        if (!session || !session.email || (expiresAt && expiresAt < Date.now())) {
            if (token) this.sessions.delete(token);
            return null;
        }
        return { email: session.email };
    }

    async hydrateUser(sessionUser) {
        if (!sessionUser) return null;
        const user = await this.users.findByEmail(sessionUser.email);
        return user ? this.publicUser(user) : null;
    }

    publicUser(user) {
        return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
    }

    signCookie(token) {
        const signature = crypto.createHmac("sha256", this.sessionSecret).update(token).digest("base64url");
        return `${token}.${signature}`;
    }

    verifyCookie(value) {
        if (!value) return null;
        const lastDot = value.lastIndexOf(".");
        if (lastDot <= 0) return null;
        const token = value.slice(0, lastDot);
        const signature = value.slice(lastDot + 1);
        if (!token || !signature) return null;
        const expected = crypto.createHmac("sha256", this.sessionSecret).update(token).digest("base64url");
        if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
        return token;
    }
}

module.exports = { AuthService, SESSION_COOKIE, hashPassword, verifyPassword, validEmail };
