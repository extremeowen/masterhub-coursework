const express = require("express");
const { SESSION_COOKIE, validEmail } = require("../service/auth.service");
const { normalizeUkrainianPhone, isValidUkrainianPhone } = require("../service/contact-validation");

function parseCookies(header) {
    return String(header || "").split(";").reduce((cookies, part) => {
        const separator = part.indexOf("=");
        if (separator > 0) cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
        return cookies;
    }, {});
}

function authMiddleware(authService) {
    return async (req, res, next) => {
        try {
            const cookies = parseCookies(req.headers.cookie);
            const token = authService.verifyCookie(cookies[SESSION_COOKIE]);
            const sessionUser = authService.userFromToken(token);
            req.user = await authService.hydrateUser(sessionUser);
            next();
        } catch (error) {
            next(error);
        }
    };
}

function requireRole(role) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: "AuthenticationRequired", code: "AUTH_REQUIRED", requestId: req.requestId });
        if (req.user.role !== role) return res.status(403).json({ error: "ForbiddenError", code: "ROLE_REQUIRED", requestId: req.requestId });
        next();
    };
}

function requireUser(req, res, next) {
    if (!req.user) return res.status(401).json({ error: "AuthenticationRequired", code: "AUTH_REQUIRED", requestId: req.requestId });
    next();
}

function orderResponse(order) {
    return {
        id: order.id,
        clientId: order.clientId,
        masterId: order.masterId,
        serviceId: order.serviceId,
        scheduledAt: order.scheduledAt,
        status: order.status,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        userId: order.userId || null,
        contactPhone: order.contactPhone || null,
    };
}

function authRouter(authService, ordersService, catalogRepository, auditRepo = null, reviewsRepo = null) {
    const router = express.Router();
    const userIdempotency = new Map();

    const auditRepository = auditRepo || {
        log: async () => {},
        list: async () => [],
    };
    const reviewsRepository = reviewsRepo || {
        create: async () => ({}),
        findByOrderId: async () => null,
        listForMaster: async () => [],
        listAll: async () => [],
        getSummaryForMasters: async () => ({}),
    };

    router.post("/auth/register", async (req, res) => {
        const result = await authService.register(req.body || {});
        if (result.error) return res.status(result.code === "USER_EXISTS" ? 409 : 400).json({
            error: "RegistrationError", code: result.code || "INVALID_REGISTRATION", details: result.error, requestId: req.requestId,
        });
        await auditRepository.log({
            userId: result.user.id,
            userEmail: result.user.email,
            action: "USER_REGISTERED",
            details: `Користувач ${result.user.displayName} зареєструвався`,
            entityType: "user",
            entityId: result.user.id,
        }).catch(() => {});
        res.status(201).json(result.user);
    });

    router.post("/auth/login", async (req, res) => {
        if (!validEmail(req.body?.email)) return res.status(400).json({
            error: "ValidationError", code: "INVALID_EMAIL", details: "Вкажіть коректну email-адресу.", requestId: req.requestId,
        });
        if (!req.body?.password) return res.status(400).json({
            error: "ValidationError", code: "PASSWORD_REQUIRED", details: "Введіть пароль.", requestId: req.requestId,
        });
        const result = await authService.login(req.body?.email, req.body?.password);
        if (!result) return res.status(401).json({ error: "AuthenticationError", code: "INVALID_CREDENTIALS", details: "Невірний email або пароль", requestId: req.requestId });
        res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(authService.signCookie(result.token))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
        res.status(200).json(result.user);
    });

    router.post("/auth/logout", authMiddleware(authService), (req, res) => {
        const cookies = parseCookies(req.headers.cookie);
        authService.logout(authService.verifyCookie(cookies[SESSION_COOKIE]));
        res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
        res.status(204).send();
    });

    router.get("/auth/me", authMiddleware(authService), (req, res) => {
        if (!req.user) return res.status(401).json({ error: "AuthenticationRequired", code: "AUTH_REQUIRED", requestId: req.requestId });
        res.json(req.user);
    });

    router.get("/user/orders", authMiddleware(authService), requireUser, async (req, res, next) => {
        try {
            const orders = await ordersService.list();
            res.json(orders.filter((order) => order.userId === req.user.id).map(orderResponse));
        } catch (error) {
            next(error);
        }
    });

    function validateOrderPhone(req, res) {
        const phone = normalizeUkrainianPhone(req.body?.contactPhone);
        if (!isValidUkrainianPhone(phone)) {
            res.status(400).json({
                error: "ValidationError",
                code: "INVALID_CONTACT_PHONE",
                details: { field: "contactPhone", message: "Вкажіть український номер у форматі +380XXXXXXXXX." },
                requestId: req.requestId,
            });
            return null;
        }
        return phone;
    }

    async function validateCatalogSelection(req, res, body = req.body || {}) {
        const checks = [
            ["masters", body.masterId, "Виберіть майстра зі списку."],
            ["services", body.serviceId, "Виберіть послугу зі списку."],
        ];
        for (const [kind, id, message] of checks) {
            if (id === undefined) continue;
            if (!id || !(await catalogRepository.findActive(kind, id))) {
                res.status(400).json({
                    error: "ValidationError",
                    code: kind === "masters" ? "MASTER_NOT_AVAILABLE" : "SERVICE_NOT_AVAILABLE",
                    details: { field: kind === "masters" ? "masterId" : "serviceId", message },
                    requestId: req.requestId,
                });
                return false;
            }
        }
        return true;
    }

    router.get("/user/catalog", authMiddleware(authService), requireUser, async (req, res, next) => {
        try {
            const [masters, services, reviewsSummary] = await Promise.all([
                catalogRepository.list("masters", true),
                catalogRepository.list("services", true),
                reviewsRepository.getSummaryForMasters(),
            ]);
            res.json({ masters, services, reviewsSummary });
        } catch (error) {
            next(error);
        }
    });

    router.post("/user/orders", authMiddleware(authService), requireUser, async (req, res, next) => {
        try {
            const contactPhone = validateOrderPhone(req, res);
            if (!contactPhone) return;
            if (!(await validateCatalogSelection(req, res))) return;
            const key = req.get("Idempotency-Key");
            if (!key) return res.status(400).json({ error: "ValidationError", code: "IDEMPOTENCY_KEY_REQUIRED", requestId: req.requestId });
            const fingerprint = require("node:crypto").createHash("sha256").update(JSON.stringify(req.body || {})).digest("hex");
            const scopedKey = `${req.user.id}:${key}`;
            const cached = userIdempotency.get(scopedKey);
            if (cached) {
                if (cached.fingerprint !== fingerprint) return res.status(409).json({ error: "ConflictError", code: "IDEMPOTENCY_KEY_REUSED", requestId: req.requestId });
                return res.status(201).json(cached.body);
            }
            const order = await ordersService.create({ ...(req.body || {}), contactPhone, userId: req.user.id });
            const body = orderResponse(order);
            userIdempotency.set(scopedKey, { fingerprint, body });
            await auditRepository.log({
                userId: req.user.id,
                userEmail: req.user.email,
                action: "ORDER_CREATED",
                details: `Створено замовлення #${order.id} на послугу ${order.serviceId}`,
                entityType: "order",
                entityId: order.id,
            }).catch(() => {});
            res.status(201).json(body);
        } catch (error) {
            next(error);
        }
    });

    router.put("/user/orders/:id", authMiddleware(authService), requireUser, async (req, res, next) => {
        try {
            const order = await ordersService.getById(req.params.id);
            if (order.userId !== req.user.id) return res.status(403).json({ error: "ForbiddenError", code: "ORDER_ACCESS_DENIED", requestId: req.requestId });
            const body = { ...(req.body || {}) };
            if (!(await validateCatalogSelection(req, res, body))) return;
            if (body.contactPhone !== undefined) {
                body.contactPhone = validateOrderPhone(req, res);
                if (!body.contactPhone) return;
            }
            if (body.status && body.status !== "cancelled") {
                return res.status(403).json({ error: "ForbiddenError", code: "USER_STATUS_RESTRICTED", details: "Користувач може лише скасувати власне замовлення", requestId: req.requestId });
            }
            const updated = await ordersService.update(req.params.id, body);
            await auditRepository.log({
                userId: req.user.id,
                userEmail: req.user.email,
                action: "ORDER_UPDATED",
                details: `Оновлено замовлення #${req.params.id} (статус: ${updated.status})`,
                entityType: "order",
                entityId: req.params.id,
            }).catch(() => {});
            res.json(orderResponse(updated));
        } catch (error) {
            next(error);
        }
    });

    router.delete("/user/orders/:id", authMiddleware(authService), requireUser, async (req, res, next) => {
        try {
            const order = await ordersService.getById(req.params.id);
            if (order.userId !== req.user.id) return res.status(403).json({ error: "ForbiddenError", code: "ORDER_ACCESS_DENIED", requestId: req.requestId });
            const updated = await ordersService.update(req.params.id, { status: "cancelled" });
            await auditRepository.log({
                userId: req.user.id,
                userEmail: req.user.email,
                action: "ORDER_CANCELLED",
                details: `Клієнт скасував замовлення #${req.params.id}`,
                entityType: "order",
                entityId: req.params.id,
            }).catch(() => {});
            res.json(orderResponse(updated));
        } catch (error) {
            next(error);
        }
    });

    router.get("/admin/orders", authMiddleware(authService), requireRole("admin"), async (req, res, next) => {
        try {
            const orders = await ordersService.list();
            res.json(orders.map(orderResponse));
        } catch (error) {
            next(error);
        }
    });

    router.get("/admin/catalog/:kind", authMiddleware(authService), requireRole("admin"), async (req, res, next) => {
        if (!["masters", "services"].includes(req.params.kind)) return res.status(404).json({ error: "NotFoundError", code: "CATALOG_NOT_FOUND", requestId: req.requestId });
        try {
            res.json(await catalogRepository.list(req.params.kind, false));
        } catch (error) {
            next(error);
        }
    });

    router.post("/admin/catalog/:kind", authMiddleware(authService), requireRole("admin"), async (req, res, next) => {
        if (!["masters", "services"].includes(req.params.kind)) return res.status(404).json({ error: "NotFoundError", code: "CATALOG_NOT_FOUND", requestId: req.requestId });
        const name = String(req.body?.name || "").trim();
        if (name.length < 2 || name.length > 100) return res.status(400).json({ error: "ValidationError", code: "CATALOG_NAME_INVALID", details: "Назва має містити від 2 до 100 символів.", requestId: req.requestId });
        try {
            const item = await catalogRepository.create(req.params.kind, req.body);
            await auditRepository.log({
                userId: req.user.id,
                userEmail: req.user.email,
                action: "CATALOG_CREATED",
                details: `Створено ${req.params.kind}: ${item.name}`,
                entityType: req.params.kind,
                entityId: item.id,
            }).catch(() => {});
            res.status(201).json(item);
        } catch (error) {
            next(error);
        }
    });

    router.put("/admin/catalog/:kind/:id", authMiddleware(authService), requireRole("admin"), async (req, res, next) => {
        if (!["masters", "services"].includes(req.params.kind)) return res.status(404).json({ error: "NotFoundError", code: "CATALOG_NOT_FOUND", requestId: req.requestId });
        const name = req.body?.name;
        if (name !== undefined && (String(name).trim().length < 2 || String(name).trim().length > 100)) {
            return res.status(400).json({ error: "ValidationError", code: "CATALOG_NAME_INVALID", details: "Назва має містити від 2 до 100 символів.", requestId: req.requestId });
        }
        try {
            const result = await catalogRepository.update(req.params.kind, req.params.id, req.body || {});
            if (!result) return res.status(404).json({ error: "NotFoundError", code: "CATALOG_ITEM_NOT_FOUND", requestId: req.requestId });
            await auditRepository.log({
                userId: req.user.id,
                userEmail: req.user.email,
                action: "CATALOG_UPDATED",
                details: `Оновлено ${req.params.kind} ${req.params.id}`,
                entityType: req.params.kind,
                entityId: req.params.id,
            }).catch(() => {});
            res.json(result);
        } catch (error) {
            next(error);
        }
    });

    router.delete("/admin/catalog/:kind/:id", authMiddleware(authService), requireRole("admin"), async (req, res, next) => {
        if (!["masters", "services"].includes(req.params.kind)) return res.status(404).json({ error: "NotFoundError", code: "CATALOG_NOT_FOUND", requestId: req.requestId });
        try {
            const deactivated = await catalogRepository.deactivate(req.params.kind, req.params.id);
            if (!deactivated) return res.status(404).json({ error: "NotFoundError", code: "CATALOG_ITEM_NOT_FOUND", requestId: req.requestId });
            await auditRepository.log({
                userId: req.user.id,
                userEmail: req.user.email,
                action: "CATALOG_DEACTIVATED",
                details: `Деактивовано ${req.params.kind} ${req.params.id}`,
                entityType: req.params.kind,
                entityId: req.params.id,
            }).catch(() => {});
            res.status(204).send();
        } catch (error) {
            next(error);
        }
    });

    router.post("/admin/orders", authMiddleware(authService), requireRole("admin"), async (req, res, next) => {
        try {
            const contactPhone = validateOrderPhone(req, res);
            if (!contactPhone) return;
            if (!(await validateCatalogSelection(req, res))) return;
            const key = req.get("Idempotency-Key");
            if (!key) return res.status(400).json({ error: "ValidationError", code: "IDEMPOTENCY_KEY_REQUIRED", requestId: req.requestId });
            const order = await ordersService.create({ ...(req.body || {}), contactPhone });
            await auditRepository.log({
                userId: req.user.id,
                userEmail: req.user.email,
                action: "ADMIN_ORDER_CREATED",
                details: `Адміністратор створив замовлення #${order.id}`,
                entityType: "order",
                entityId: order.id,
            }).catch(() => {});
            res.status(201).json(orderResponse(order));
        } catch (error) {
            next(error);
        }
    });

    router.put("/admin/orders/:id", authMiddleware(authService), requireRole("admin"), async (req, res, next) => {
        try {
            const body = { ...(req.body || {}) };
            if (!(await validateCatalogSelection(req, res, body))) return;
            if (body.contactPhone !== undefined) {
                body.contactPhone = validateOrderPhone(req, res);
                if (!body.contactPhone) return;
            }
            const order = await ordersService.update(req.params.id, body);
            await auditRepository.log({
                userId: req.user.id,
                userEmail: req.user.email,
                action: "ORDER_STATUS_CHANGED",
                details: `Адміністратор змінив замовлення #${req.params.id} (статус: ${order.status})`,
                entityType: "order",
                entityId: req.params.id,
            }).catch(() => {});
            res.json(orderResponse(order));
        } catch (error) {
            next(error);
        }
    });

    router.delete("/admin/orders/:id", authMiddleware(authService), requireRole("admin"), async (req, res, next) => {
        try {
            await ordersService.remove(req.params.id);
            await auditRepository.log({
                userId: req.user.id,
                userEmail: req.user.email,
                action: "ORDER_DELETED",
                details: `Адміністратор видалив замовлення #${req.params.id}`,
                entityType: "order",
                entityId: req.params.id,
            }).catch(() => {});
            res.status(204).send();
        } catch (error) {
            next(error);
        }
    });

    router.get("/admin/users", authMiddleware(authService), requireRole("admin"), async (req, res) => {
        res.json(await authService.listUsers());
    });

    router.patch("/admin/users/:id/role", authMiddleware(authService), requireRole("admin"), async (req, res) => {
        const result = await authService.changeRole(req.user, req.params.id, req.body?.role);
        if (result.error) return res.status(result.code === "USER_NOT_FOUND" ? 404 : 400).json({
            error: "RoleChangeError", code: result.code || "INVALID_ROLE_CHANGE", details: result.error, requestId: req.requestId,
        });
        await auditRepository.log({
            userId: req.user.id,
            userEmail: req.user.email,
            action: "ROLE_CHANGED",
            details: `Змінено роль користувача ${req.params.id} на ${req.body?.role}`,
            entityType: "user",
            entityId: req.params.id,
        }).catch(() => {});
        res.json(result.user);
    });

    router.delete("/admin/users/:id", authMiddleware(authService), requireRole("admin"), async (req, res) => {
        const result = await authService.deleteUser(req.user, req.params.id);
        if (result.error) {
            const status = result.code === "USER_NOT_FOUND" ? 404 : 400;
            return res.status(status).json({ error: "UserDeleteError", code: result.code, details: result.error, requestId: req.requestId });
        }
        for (const key of userIdempotency.keys()) {
            if (key.startsWith(`${req.params.id}:`)) userIdempotency.delete(key);
        }
        await auditRepository.log({
            userId: req.user.id,
            userEmail: req.user.email,
            action: "USER_DELETED",
            details: `Видалено користувача ${req.params.id}`,
            entityType: "user",
            entityId: req.params.id,
        }).catch(() => {});
        res.status(204).send();
    });

    // --- AUDIT LOG ROUTES ---
    router.get("/admin/audit", authMiddleware(authService), requireRole("admin"), async (req, res, next) => {
        try {
            const logs = await auditRepository.list(100);
            res.json(logs);
        } catch (error) {
            next(error);
        }
    });

    // --- REVIEWS ROUTES ---
    router.post("/user/reviews", authMiddleware(authService), requireUser, async (req, res, next) => {
        try {
            const { orderId, rating, comment } = req.body || {};
            if (!orderId) {
                return res.status(400).json({ error: "ValidationError", code: "ORDER_ID_REQUIRED", details: "Вкажіть номер замовлення", requestId: req.requestId });
            }
            const numRating = Number(rating);
            if (!numRating || numRating < 1 || numRating > 5) {
                return res.status(400).json({ error: "ValidationError", code: "INVALID_RATING", details: "Оцінка має бути від 1 до 5 зірок", requestId: req.requestId });
            }
            const order = await ordersService.getById(orderId);
            if (!order) {
                return res.status(404).json({ error: "NotFoundError", code: "ORDER_NOT_FOUND", requestId: req.requestId });
            }
            if (order.userId !== req.user.id && req.user.role !== "admin") {
                return res.status(403).json({ error: "ForbiddenError", code: "ORDER_ACCESS_DENIED", requestId: req.requestId });
            }
            if (order.status !== "done") {
                return res.status(400).json({ error: "ValidationError", code: "ORDER_NOT_DONE", details: "Відгук можна залишити лише після виконання замовлення", requestId: req.requestId });
            }
            const existing = await reviewsRepository.findByOrderId(orderId);
            if (existing) {
                return res.status(409).json({ error: "ConflictError", code: "REVIEW_EXISTS", details: "Ви вже залишили відгук для цього замовлення", requestId: req.requestId });
            }
            const review = await reviewsRepository.create({
                orderId,
                userId: req.user.id,
                userDisplayName: req.user.displayName || req.user.email,
                masterId: order.masterId,
                rating: numRating,
                comment: comment || "",
            });
            await auditRepository.log({
                userId: req.user.id,
                userEmail: req.user.email,
                action: "REVIEW_CREATED",
                details: `Відгук ${numRating}★ до замовлення #${orderId} (майстер: ${order.masterId})`,
                entityType: "review",
                entityId: review.id,
            }).catch(() => {});
            res.status(201).json(review);
        } catch (error) {
            next(error);
        }
    });

    router.get("/user/reviews", authMiddleware(authService), requireUser, async (req, res, next) => {
        try {
            const allReviews = await reviewsRepository.listAll();
            const userReviews = allReviews.filter((r) => r.userId === req.user.id);
            res.json(userReviews);
        } catch (error) {
            next(error);
        }
    });

    router.get("/reviews", async (req, res, next) => {
        try {
            const [summary, all] = await Promise.all([
                reviewsRepository.getSummaryForMasters(),
                reviewsRepository.listAll(),
            ]);
            res.json({ summary, reviews: all });
        } catch (error) {
            next(error);
        }
    });

    return { router, authMiddleware, requireRole };
}

module.exports = { authRouter, authMiddleware, requireRole };
