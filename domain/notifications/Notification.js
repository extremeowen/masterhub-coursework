// domain/notifications/Notification.js
// Піддомен: Notifications

class Notification {
    constructor(id, userId, type, message) {
        this.id = id;
        this.userId = userId;
        this.type = type; // напр. "order_status_changed", "verification_result"
        this.message = message;
        this.isRead = false;
    }

    markRead() {
        this.isRead = true;
    }
}

module.exports = Notification;