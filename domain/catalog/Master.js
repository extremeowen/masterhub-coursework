// domain/catalog/Master.js
// Піддомен: Catalog

class Master {
    constructor(id, userId, name, city) {
        this.id = id;
        this.userId = userId;
        this.name = name;
        this.city = city;
        this.services = []; // Service[]
        this.rating = 0;
        this.isVerified = false;
    }

    addService(service) {
        this.services.push(service);
    }

    setVerified(status) {
        this.isVerified = status;
    }
}

module.exports = Master;