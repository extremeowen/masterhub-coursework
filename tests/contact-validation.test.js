const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeUkrainianPhone, isValidUkrainianPhone } = require("../service/contact-validation");

test("valid Ukrainian phone numbers normalize to +380 followed by nine digits", () => {
    assert.equal(normalizeUkrainianPhone("+380 (50) 123-45-67"), "+380501234567");
    assert.equal(isValidUkrainianPhone("+380501234567"), true);
    assert.equal(isValidUkrainianPhone("+380 (50) 123-45-67"), true);
});

test("rejects phone numbers outside the required +380 format", () => {
    for (const phone of ["0501234567", "+38050123456", "+381501234567", "+3805012345678", ""]) {
        assert.equal(isValidUkrainianPhone(phone), false, phone);
    }
});
