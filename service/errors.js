
class ValidationError extends Error {
    constructor(code, details) {
        super("ValidationError");
        this.name = "ValidationError";
        this.code = code;
        this.details = details;
    }
}

class NotFoundError extends Error {
    constructor(code) {
        super("NotFoundError");
        this.name = "NotFoundError";
        this.code = code;
    }
}

class DependencyUnavailableError extends Error {
    constructor(message = "A required dependency is unavailable", details = null) {
        super(message);
        this.name = "DependencyUnavailableError";
        // Практична 5: degraded mode повертає клієнту HTTP 503.
        // API перетворює цю помилку на видиму клієнту відповідь 503 у degraded mode.
        this.code = "DEPENDENCY_UNAVAILABLE";
        this.details = details;
    }
}

module.exports = { ValidationError, NotFoundError, DependencyUnavailableError };