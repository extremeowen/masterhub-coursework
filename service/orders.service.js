
const Order = require("../domain/booking/Order");
const { ValidationError, NotFoundError, DependencyUnavailableError } = require("./errors");

class OrdersService {
    constructor(ordersRepository) {
        this.repo = ordersRepository;
    }

    isAsync(value) {
        return value && typeof value.then === "function";
    }

    saveCreatedOrder(order) {
        try {
            const result = this.repo.save(order);
            return this.isAsync(result)
                ? result.catch((err) => {
                    throw new DependencyUnavailableError("Orders storage is unavailable", { cause: err.message });
                })
                : result;
        } catch (err) {
            throw new DependencyUnavailableError("Orders storage is unavailable", { cause: err.message });
        }
    }

    create(data) {
        const details = [];
        if (!data.clientId) details.push({ field: "clientId", message: "clientId is required" });
        if (!data.masterId) details.push({ field: "masterId", message: "masterId is required" });
        if (!data.serviceId) details.push({ field: "serviceId", message: "serviceId is required" });
        if (!data.scheduledAt) details.push({ field: "scheduledAt", message: "scheduledAt is required" });

        if (details.length > 0) {
            throw new ValidationError("ORDER_INVALID", details);
        }

        let id;
        try {
            id = this.repo.nextId();
        } catch (err) {
            // Збій сховища стає явною помилкою degraded mode замість загальної відповіді 500.
            throw new DependencyUnavailableError("Orders storage is unavailable", { cause: err.message });
        }
        const buildAndSave = (resolvedId) => {
            const order = new Order(resolvedId, data.clientId, data.masterId, data.serviceId, data.scheduledAt, data.userId || null, data.contactPhone || null);
            const now = new Date().toISOString();
            order.createdAt = now;
            order.updatedAt = now;
            return this.saveCreatedOrder(order);
        };
        return this.isAsync(id) ? id.then(buildAndSave).catch((err) => {
            throw new DependencyUnavailableError("Orders storage is unavailable", { cause: err.message });
        }) : buildAndSave(id);
    }

    list() {
        try {
            const result = this.repo.findAll();
            return this.isAsync(result)
                ? result.then((orders) => orders).catch((err) => {
                    throw new DependencyUnavailableError("Orders storage is unavailable", { cause: err.message });
                })
                : result;
        } catch (err) {
            throw new DependencyUnavailableError("Orders storage is unavailable", { cause: err.message });
        }
    }

    getById(id) {
        let order;
        try {
            order = this.repo.findById(id);
        } catch (err) {
            throw new DependencyUnavailableError("Orders storage is unavailable", { cause: err.message });
        }
        const resolve = (found) => {
            if (!found) throw new NotFoundError("ORDER_NOT_FOUND");
            return found;
        };
        return this.isAsync(order) ? order.then(resolve).catch((err) => {
            if (err instanceof NotFoundError) throw err;
            throw new DependencyUnavailableError("Orders storage is unavailable", { cause: err.message });
        }) : resolve(order);
    }

    update(id, data) {
        let order;
        try {
            order = this.repo.findById(id);
        } catch (err) {
            throw new DependencyUnavailableError("Orders storage is unavailable", { cause: err.message });
        }
        const applyUpdate = (found) => {
            if (!found) throw new NotFoundError("ORDER_NOT_FOUND");
            if (data.clientId !== undefined) found.clientId = data.clientId;
            if (data.masterId !== undefined) found.masterId = data.masterId;
            if (data.serviceId !== undefined) found.serviceId = data.serviceId;
            if (data.scheduledAt) found.scheduledAt = data.scheduledAt;
            if (data.contactPhone !== undefined) found.contactPhone = data.contactPhone;
            if (data.status) {
                try {
                    if (data.status === "confirmed") found.confirm();
                    else if (data.status === "done") found.complete();
                    else if (data.status === "cancelled") found.cancel();
                    else throw new ValidationError("INVALID_STATUS", [
                        { field: "status", message: `Unknown status: ${data.status}` },
                    ]);
                } catch (err) {
                    if (err instanceof ValidationError) throw err;
                    throw new ValidationError("INVALID_TRANSITION", [
                        { field: "status", message: err.message },
                    ]);
                }
            }
            found.updatedAt = new Date().toISOString();
            return this.saveCreatedOrder(found);
        };
        if (this.isAsync(order)) {
            return order.then(applyUpdate).catch((err) => {
                if (err instanceof ValidationError || err instanceof NotFoundError) throw err;
                throw new DependencyUnavailableError("Orders storage is unavailable", { cause: err.message });
            });
        }
        return applyUpdate(order);
    }

    remove(id) {
        let order;
        try {
            order = this.repo.findById(id);
        } catch (err) {
            throw new DependencyUnavailableError("Orders storage is unavailable", { cause: err.message });
        }
        const removeFound = (found) => {
            if (!found) throw new NotFoundError("ORDER_NOT_FOUND");
            try {
                const result = this.repo.delete(id);
                return this.isAsync(result)
                    ? result.catch((err) => {
                        throw new DependencyUnavailableError("Orders storage is unavailable", { cause: err.message });
                    })
                    : result;
            } catch (err) {
                throw new DependencyUnavailableError("Orders storage is unavailable", { cause: err.message });
            }
        };
        if (this.isAsync(order)) {
            return order.then(removeFound).catch((err) => {
                if (err instanceof NotFoundError || err instanceof DependencyUnavailableError) throw err;
                throw new DependencyUnavailableError("Orders storage is unavailable", { cause: err.message });
            });
        }
        return removeFound(order);
    }
}

module.exports = OrdersService;