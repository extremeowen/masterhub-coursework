const express = require("express");
const crypto = require("node:crypto");
const { ValidationError, NotFoundError, DependencyUnavailableError } = require("../service/errors");

function ordersRouter(ordersService) {
    const router = express.Router();
    // Практична 5: ідемпотентність POST, її очищення після DELETE та єдиний формат помилок.
    // Зберігаємо успішні POST-відповіді, щоб повтори мережевого запиту не створювали дублікати.
    const idempotencyStore = new Map();

    function toResponse(order) {
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

    function handleError(err, req, res) {
        const requestId = req.requestId;
        // Уніфікуємо відповіді для помилок валідації, відсутніх ресурсів, залежностей і невідомих збоїв.
        if (err instanceof ValidationError) {
            return res.status(400).json({ error: err.name, code: err.code, details: err.details, requestId });
        }
        if (err instanceof NotFoundError) {
            return res.status(404).json({ error: err.name, code: err.code, details: null, requestId });
        }
        if (err instanceof DependencyUnavailableError) {
            return res.status(503).json({ error: err.name, code: err.code, details: err.details, requestId });
        }
        console.error("Unhandled orders error:", err);
        return res.status(500).json({ error: "InternalError", code: "INTERNAL_ERROR", details: null, requestId });
    }

    router.post("/orders", async (req, res) => {
        const key = req.get("Idempotency-Key");
        if (!key) {
            return res.status(400).json({
                error: "ValidationError",
                code: "IDEMPOTENCY_KEY_REQUIRED",
                details: [{ field: "Idempotency-Key", message: "Idempotency-Key header is required" }],
                requestId: req.requestId,
            });
        }
        const fingerprint = crypto.createHash("sha256").update(JSON.stringify(req.body || {})).digest("hex");
        const cached = idempotencyStore.get(key);
        if (cached) {
            if (cached.fingerprint !== fingerprint) {
                // Повторне використання ключа для іншого тіла неоднозначне й не має відтворювати чуже замовлення.
                return res.status(409).json({
                    error: "ConflictError",
                    code: "IDEMPOTENCY_KEY_REUSED",
                    details: "The key was already used with a different request body",
                    requestId: req.requestId,
                });
            }
            // Для справжнього ідемпотентного повтору відтворюємо початкові статус, тіло та ідентифікатор запиту.
            res.set("X-Request-Id", cached.body.requestId);
            return res.status(cached.status).json(cached.body);
        }
        try {
            const order = await ordersService.create(req.body || {});
            const body = { ...toResponse(order), requestId: req.requestId };
            idempotencyStore.set(key, { fingerprint, status: 201, body });
            res.status(201).json(body);
        } catch (err) {
            handleError(err, req, res);
        }
    });

    router.get("/orders", async (req, res) => {
        try {
            const orders = await ordersService.list();
            res.status(200).json(orders.map(toResponse));
        } catch (err) {
            handleError(err, req, res);
        }
    });

    router.get("/orders/:id", async (req, res) => {
        try {
            const order = await ordersService.getById(req.params.id);
            res.status(200).json(toResponse(order));
        } catch (err) {
            handleError(err, req, res);
        }
    });

    router.put("/orders/:id", async (req, res) => {
        try {
            const order = await ordersService.update(req.params.id, req.body || {});
            res.status(200).json(toResponse(order));
        } catch (err) {
            handleError(err, req, res);
        }
    });

    router.delete("/orders/:id", async (req, res) => {
        try {
            await ordersService.remove(req.params.id);
            // Видалений order більше не має блокувати повторне створення з тим самим ключем.
            for (const [key, cached] of idempotencyStore.entries()) {
                if (cached.body.id === req.params.id) idempotencyStore.delete(key);
            }
            res.status(204).send();
        } catch (err) {
            handleError(err, req, res);
        }
    });

    return router;
}

module.exports = ordersRouter;