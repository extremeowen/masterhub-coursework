const fs = require("node:fs");
const path = require("node:path");
const { meter, serviceName } = require("./telemetry");

const requests = meter.createCounter("http.server.requests", {
    description: "Total HTTP requests handled by the MasterHub API",
    unit: "{request}",
});
const duration = meter.createHistogram("http.server.duration", {
    description: "HTTP request duration in seconds",
    unit: "s",
});

const logFile = process.env.OBSERVABILITY_LOG_FILE || "/var/log/masterhub/app.log";
let logStream;
try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    logStream = fs.createWriteStream(logFile, { flags: "a" });
} catch (error) {
    console.error(JSON.stringify({
        level: "error",
        message: "Observability log file is unavailable",
        service_name: serviceName,
        error: error.message,
    }));
}

function writeLog(level, message, fields = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        service_name: serviceName,
        message,
        ...fields,
    };
    const line = JSON.stringify(entry);
    console.log(line);
    if (logStream) logStream.write(`${line}\n`);
}

function httpObservability(req, res, next) {
    const startedAt = process.hrtime.bigint();
    res.on("finish", () => {
        const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
        const route = req.route?.path || req.path || "unknown";
        const attributes = {
            http_method: req.method,
            http_route: route,
            http_status_code: String(res.statusCode),
            service_name: serviceName,
        };
        requests.add(1, attributes);
        duration.record(seconds, attributes);
        writeLog(res.statusCode >= 500 ? "error" : "info", "HTTP request completed", {
            method: req.method,
            route,
            status_code: res.statusCode,
            duration_ms: Math.round(seconds * 1000),
            request_id: req.requestId,
        });
    });
    next();
}

module.exports = { httpObservability, writeLog };
