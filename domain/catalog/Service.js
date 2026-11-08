// domain/catalog/Service.js
// Піддомен: Catalog

class Service {
    constructor(id, categoryId, title, price) {
        this.id = id;
        this.categoryId = categoryId;
        this.title = title;
        this.price = price;
    }
}

module.exports = Service;