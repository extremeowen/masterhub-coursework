// domain/users/User.js
// Піддомен: Users

class User {
    constructor(id, email, passwordHash, role = "client") {
        this.id = id;
        this.email = email;
        this.passwordHash = passwordHash;
        this.role = role; // "client" | "master"
    }

    isMaster() {
        return this.role === "master";
    }
}

module.exports = User;
