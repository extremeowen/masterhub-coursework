// domain/reviews/Review.js
// Піддомен: Reviews

class Review {
    constructor(id, orderId, clientId, masterId, rating, comment = "") {
        if (rating < 1 || rating > 5) {
            throw new Error("Rating must be between 1 and 5");
        }
        this.id = id;
        this.orderId = orderId;
        this.clientId = clientId;
        this.masterId = masterId;
        this.rating = rating;
        this.comment = comment;
    }
}

module.exports = Review;
