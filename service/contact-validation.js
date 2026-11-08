function normalizeUkrainianPhone(value) {
    return String(value || "").trim().replace(/[\s()-]/g, "");
}

function isValidUkrainianPhone(value) {
    return /^\+380\d{9}$/.test(normalizeUkrainianPhone(value));
}

module.exports = { normalizeUkrainianPhone, isValidUkrainianPhone };
