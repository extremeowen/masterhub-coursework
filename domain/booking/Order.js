// domain/booking/Order.js
// Піддомен: Booking

class Order {
    constructor(id, clientId, masterId, serviceId, scheduledAt, userId = null, contactPhone = null) {
        this.id = id;
        this.clientId = clientId;
        this.masterId = masterId;
        this.serviceId = serviceId;
        this.scheduledAt = scheduledAt;
        this.userId = userId;
        this.contactPhone = contactPhone;
        this.status = "pending"; // pending | confirmed | done | cancelled
    }

    confirm() {
        if (this.status !== "pending") {
            throw new Error("Order can be confirmed only from pending status");
        }
        this.status = "confirmed";
    }

    complete() {
        if (this.status !== "confirmed") {
            throw new Error("Order can be completed only from confirmed status");
        }
        this.status = "done";
    }

    cancel() {
        if (this.status === "done") {
            throw new Error("Completed order cannot be cancelled");
        }
        this.status = "cancelled";
    }
}

module.exports = Order;