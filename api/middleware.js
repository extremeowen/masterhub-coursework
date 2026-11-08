const crypto = require("node:crypto");

function requestId(req, res, next) {
    const supplied = req.get ? req.get("X-Request-Id") : req.headers?.["x-request-id"];
    req.requestId = supplied && supplied.length <= 128 ? supplied : crypto.randomUUID();
    if (res.set) res.set("X-Request-Id", req.requestId);
    next();
}

function rateLimit({ limit = 300, windowMs = 60_000 } = {}) {
    // Практична 5: rate limit із Retry-After для клієнта.
    const clients = new Map();
    return (req, res, next) => {
        // Запити перевірки здоров'я та сесії не повинні блокувати користувача
        if (req.path && (req.path.startsWith("/health") || req.path === "/ready" || req.path === "/auth/me")) {
            return next();
        }
        const now = Date.now();
        const key = req.ip || req.socket?.remoteAddress || "unknown";
        const current = clients.get(key);
        if (!current || now >= current.resetAt) {
            clients.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }
        current.count += 1;
        if (current.count > limit) {
            // Повідомляємо клієнту точний час повторної спроби замість мовчазного відхилення.
            const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
            res.set("Retry-After", String(retryAfter));
            return res.status(429).json({
                error: "RateLimitError",
                code: "RATE_LIMIT_EXCEEDED",
                details: { retryAfter },
                requestId: req.requestId,
            });
        }
        next();
    };
}

module.exports = { requestId, rateLimit };
