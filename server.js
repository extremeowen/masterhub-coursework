// Initialize telemetry before loading Express so auto-instrumentation can patch modules.
require("./telemetry");

// server.js
const express = require("express");
const path = require("path");

const OrdersService = require("./service/orders.service");
const ordersRouter = require("./api/orders.routes");
const { requestId, rateLimit } = require("./api/middleware");
const { httpObservability } = require("./observability");

const app = express();
const PORT = 8080;

app.set("trust proxy", true);
app.use(express.json());
app.use(requestId);
app.use(rateLimit({
    limit: Number(process.env.RATE_LIMIT || 1000),
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
}));
app.use(httpObservability);
app.use(express.static(path.join(__dirname, "public")));

// Docker uses PostgreSQL; local runs keep the existing SQLite/in-memory fallback.
let ordersRepository;
let storageKind = "memory";
if (process.env.DATABASE_URL) {
    const PostgresOrdersRepository = require("./repository/PostgresOrdersRepository");
    ordersRepository = new PostgresOrdersRepository(process.env.DATABASE_URL);
    storageKind = "postgres";
} else {
    try {
        const SqliteOrdersRepository = require("./repository/SqliteOrdersRepository");
        ordersRepository = new SqliteOrdersRepository("masterhub.db");
        storageKind = "sqlite";
    } catch (e) {
        console.warn("SQLite repository unavailable, falling back to in-memory:", e.message);
        const InMemoryOrdersRepository = require("./repository/InMemoryOrdersRepository");
        ordersRepository = new InMemoryOrdersRepository();
    }
}

const ordersService = new OrdersService(ordersRepository);
let catalogRepository;
if (process.env.DATABASE_URL) {
    const PostgresCatalogRepository = require("./repository/PostgresCatalogRepository");
    catalogRepository = new PostgresCatalogRepository(process.env.DATABASE_URL);
} else {
    const SqliteCatalogRepository = require("./repository/SqliteCatalogRepository");
    catalogRepository = new SqliteCatalogRepository("masterhub.db");
}
let usersRepository;
if (process.env.DATABASE_URL) {
    const PostgresUsersRepository = require("./repository/PostgresUsersRepository");
    usersRepository = new PostgresUsersRepository(process.env.DATABASE_URL);
} else {
    try {
        const SqliteUsersRepository = require("./repository/SqliteUsersRepository");
        usersRepository = new SqliteUsersRepository("masterhub.db");
    } catch (e) {
        console.warn("SQLite users repository unavailable; auth is disabled:", e.message);
        usersRepository = {
            async findByEmail() { return null; },
            async save() { throw new Error("Users storage is unavailable"); },
        };
    }
}
const { AuthService } = require("./service/auth.service");
const { authRouter } = require("./api/auth.routes");
const AuditRepository = require("./repository/AuditRepository");
const ReviewsRepository = require("./repository/ReviewsRepository");
const auditRepository = new AuditRepository(process.env.DATABASE_URL || "masterhub.db");
const reviewsRepository = new ReviewsRepository(process.env.DATABASE_URL || "masterhub.db");
const authService = new AuthService(usersRepository);
const authRoutes = authRouter(authService, ordersService, catalogRepository, auditRepository, reviewsRepository);
authService.seedFromEnvironment().catch((error) => {
    console.error("Auth seed failed:", error.message);
});

async function healthCheck(req, res) {
    try {
        if (ordersRepository.ready) await ordersRepository.ready;
        res.status(200).json({ status: "ok" });
    } catch (err) {
        res.status(503).json({
            error: "DependencyUnavailableError",
            code: "DEPENDENCY_UNAVAILABLE",
            details: { cause: err.message },
            storage: storageKind,
            requestId: req.requestId,
        });
    }
}

app.get("/health", healthCheck);
app.get("/healthz", healthCheck);
app.get("/ready", healthCheck);
app.get("/health/details", async (req, res) => {
    try {
        if (ordersRepository.ready) await ordersRepository.ready;
        res.status(200).json({ status: "ok", storage: storageKind });
    } catch (err) {
        res.status(503).json({
            status: "degraded",
            storage: storageKind,
            details: { cause: err.message },
            requestId: req.requestId,
        });
    }
});

app.use(authRoutes.router);
app.use(ordersRouter(ordersService));

app.use((req, res) => {
    res.status(404).json({
        error: "NotFoundError",
        code: "ROUTE_NOT_FOUND",
        details: { path: req.path },
        requestId: req.requestId,
    });
});
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const isJsonError = err && (err.type === "entity.parse.failed" || err instanceof SyntaxError);
    res.status(isJsonError ? 400 : 500).json({
        error: isJsonError ? "ValidationError" : "InternalError",
        code: isJsonError ? "INVALID_JSON" : "INTERNAL_ERROR",
        details: isJsonError ? "Request body must be valid JSON" : null,
        requestId: req.requestId,
    });
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Сервер запущено: http://localhost:${PORT}`);
        console.log(`API:            http://localhost:${PORT}/orders`);
        console.log(`Health:         http://localhost:${PORT}/health`);
    });
}

module.exports = app;
