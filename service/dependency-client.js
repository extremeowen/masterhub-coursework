function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(response, now = Date.now()) {
    const value = response && response.headers && response.headers.get("Retry-After");
    if (!value) return 0;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? 0 : Math.max(0, timestamp - now);
}

async function requestWithRetry(request, {
    timeoutMs = 2_000,
    retries = 2,
    baseDelayMs = 100,
    jitterMs = 50,
} = {}) {
    let lastError;
    // Практична 5: timeout, AbortController і backoff для залежностей.
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        // Перериваємо кожну спробу окремо; експоненційна затримка не перевантажує повільну залежність.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await request({ signal: controller.signal, attempt });
            if (response && response.status === 429 && attempt < retries) {
                await delay(retryAfterMs(response) || (baseDelayMs * (2 ** attempt)
                    + Math.floor(Math.random() * jitterMs)));
                continue;
            }
            return response;
        } catch (err) {
            lastError = err;
            if (attempt === retries) throw err;
            await delay(baseDelayMs * (2 ** attempt) + Math.floor(Math.random() * jitterMs));
        } finally {
            clearTimeout(timer);
        }
    }
    throw lastError;
}

module.exports = { requestWithRetry, retryAfterMs };
