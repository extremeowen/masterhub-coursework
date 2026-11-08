const { metrics } = require("@opentelemetry/api");
const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");
const { OTLPMetricExporter } = require("@opentelemetry/exporter-metrics-otlp-http");
const { PrometheusExporter } = require("@opentelemetry/exporter-prometheus");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
const { NodeSDK } = require("@opentelemetry/sdk-node");
const { PeriodicExportingMetricReader } = require("@opentelemetry/sdk-metrics");
const { resourceFromAttributes } = require("@opentelemetry/resources");
const { ATTR_SERVICE_NAME } = require("@opentelemetry/semantic-conventions");

const enabled = process.env.OTEL_ENABLED === "true";
const serviceName = process.env.OTEL_SERVICE_NAME || "masterhub-api";

if (enabled) {
    const sdk = new NodeSDK({
        resource: resourceFromAttributes({
            [ATTR_SERVICE_NAME]: serviceName,
        }),
        traceExporter: new OTLPTraceExporter({
            url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
                || "http://otel-collector:4318/v1/traces",
        }),
        metricReaders: [
            new PeriodicExportingMetricReader({
                exporter: new OTLPMetricExporter({
                    url: process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
                        || "http://otel-collector:4318/v1/metrics",
                }),
                exportIntervalMillis: 5000,
            }),
            new PrometheusExporter({
                port: Number(process.env.PROMETHEUS_PORT || 9465),
                host: "0.0.0.0",
            }),
        ],
        instrumentations: [getNodeAutoInstrumentations()],
    });

    const started = sdk.start();
    if (started && typeof started.catch === "function") started.catch((error) => {
        console.error(JSON.stringify({
            level: "error",
            message: "OpenTelemetry SDK failed to start",
            service_name: serviceName,
            error: error.message,
        }));
    });

    const shutdown = () => sdk.shutdown().catch((error) => {
        console.error(JSON.stringify({
            level: "error",
            message: "OpenTelemetry SDK failed to shut down",
            service_name: serviceName,
            error: error.message,
        }));
    });
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
}

module.exports = {
    enabled,
    meter: metrics.getMeter("masterhub-http"),
    serviceName,
};
