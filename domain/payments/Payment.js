// domain/payments/Payment.js
// Піддомен: Payments

class Payment {
    constructor(id, orderId, amount) {
        this.id = id;
        this.orderId = orderId;
        this.amount = amount;
        this.status = "pending"; // pending | paid | failed
    }

    markPaid() {
        this.status = "paid";
    }

    markFailed() {
        this.status = "failed";
    }
}

module.exports = Payment;