(function (global) {
    function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function retryAfterMs(response) {
        const value = response.headers.get("Retry-After");
        if (!value) return 0;
        const seconds = Number(value);
        if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
        const timestamp = Date.parse(value);
        return Number.isNaN(timestamp) ? 0 : Math.max(0, timestamp - Date.now());
    }

    async function fetchWithRetry(url, options = {}, {
        timeoutMs = 2_000,
        retries = 2,
        baseDelayMs = 100,
        jitterMs = 50,
    } = {}) {
        let lastError;
        for (let attempt = 0; attempt <= retries; attempt += 1) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(url, { ...options, signal: controller.signal });
                if (response.status !== 429 || attempt === retries) return response;
                const waitMs = retryAfterMs(response) || (
                    baseDelayMs * (2 ** attempt) + Math.floor(Math.random() * jitterMs)
                );
                await delay(waitMs);
            } catch (error) {
                lastError = error;
                if (attempt === retries) throw error;
                await delay(baseDelayMs * (2 ** attempt) + Math.floor(Math.random() * jitterMs));
            } finally {
                clearTimeout(timer);
            }
        }
        throw lastError;
    }

    global.MasterHubApi = { fetchWithRetry };
}(window));
