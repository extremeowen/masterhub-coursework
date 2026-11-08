
class InMemoryOrdersRepository {
    constructor() {
        this.store = new Map();
        this.counter = 0;
    }

    nextId() {
        this.counter += 1;
        return `o-${this.counter}`;
    }

    save(order) {
        this.store.set(order.id, order);
        return order;
    }

    findById(id) {
        return this.store.get(id) || null;
    }

    findAll() {
        return Array.from(this.store.values());
    }

    delete(id) {
        return this.store.delete(id);
    }
}

module.exports = InMemoryOrdersRepository;