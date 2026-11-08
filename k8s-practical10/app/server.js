const express = require("express");

const app = express();
const port = Number(process.env.PORT || 8080);
const appName = process.env.APP_NAME || "k8s-demo-app";
const appMode = process.env.APP_MODE || "dev";
const secretToken = process.env.SECRET_TOKEN || process.env.DEMO_SECRET || "not-configured";

// 1. Liveness probe: checks if process is alive
app.get("/healthz", (req, res) => {
    res.status(200).json({ status: "ok", app: appName });
});

// 2. Readiness probe: checks if application is ready to accept traffic
app.get("/ready", (req, res) => {
    res.status(200).json({ status: "ready", mode: appMode });
});

// 3. Status endpoint: demonstrates ConfigMap and Secret values
app.get("/api/status", (req, res) => {
    res.status(200).json({
        status: "ok",
        app: appName,
        mode: appMode,
        secretConfigured: secretToken !== "not-configured",
        secretToken: secretToken,
    });
});

// 4. Items endpoint with optional filtering
app.get("/api/items", (req, res) => {
    let items = [
        { id: 1, name: "Kubernetes deployment" },
        { id: 2, name: "ConfigMap and Secret" },
        { id: 3, name: "Ingress routing" },
    ];
    if (req.query.filter) {
        const filterStr = String(req.query.filter).toLowerCase();
        items = items.filter((item) => item.name.toLowerCase().includes(filterStr));
    }
    res.status(200).json({ items });
});

// 5. Slow endpoint for latency/timeout testing
app.get("/api/slow", async (req, res) => {
    const delayMs = Math.min(Number(req.query.ms || process.env.SLOW_MS || 1500), 10_000);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    res.status(200).json({ status: "completed", delayMs });
});

// 6. Error endpoint for failure and debug testing
app.get("/api/error", (req, res) => {
    res.status(500).json({
        error: "DemoError",
        message: "Intentional error endpoint for Kubernetes debugging",
    });
});

app.use((req, res) => {
    res.status(404).json({ error: "NotFound", path: req.path });
});

if (require.main === module) {
    app.listen(port, () => {
        console.log(`${appName} listening on port ${port} (mode: ${appMode})`);
    });
}

module.exports = app;
