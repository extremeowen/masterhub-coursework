// domain/verification/VerificationRequest.js
// Піддомен: Verification

class VerificationRequest {
    constructor(id, masterId, documents = []) {
        this.id = id;
        this.masterId = masterId;
        this.documents = documents; // string[]
        this.status = "pending"; // pending | verified | rejected
    }

    approve() {
        this.status = "verified";
    }

    reject() {
        this.status = "rejected";
    }
}

module.exports = VerificationRequest;
