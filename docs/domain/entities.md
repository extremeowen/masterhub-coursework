Domain Entities — MasterHub
Піддомени (subdomains)

MasterHub розбито на 7 піддоменів, кожен відповідає за окрему бізнес-відповідальність:

Users — реєстрація, автентифікація, профілі клієнтів і майстрів.
Catalog — профілі майстрів, послуги, які вони пропонують.
Booking — замовлення (бронювання послуги клієнтом у майстра).
Payments — оплата виконаного замовлення.
Verification — перевірка документів майстра модератором.
Reviews — відгуки та рейтинги після виконаного замовлення.
Notifications — сповіщення клієнта/майстра про зміну статусу.
Ключові сутності за піддоменами
1. Users
   User — базовий облік (id, email, passwordHash, role: client | master).
2. Catalog
   Master — профіль майстра (id, userId, name, city, services: Service[], rating).
   Service — послуга, яку надає майстер (id, categoryId, title, price).
3. Booking
   Order — замовлення клієнта (id, clientId, masterId, serviceId, scheduledAt, status).
   статуси: pending, confirmed, done, cancelled.
4. Payments
   Payment — оплата за замовлення (id, orderId, amount, status: pending | paid | failed).
5. Verification
   VerificationRequest — заявка майстра на верифікацію (id, masterId, documents: string[], status: pending | verified | rejected).
6. Reviews
   Review — відгук клієнта на майстра після замовлення (id, orderId, clientId, masterId, rating: 1–5, comment).
7. Notifications
   Notification — повідомлення користувачу (id, userId, type, message, isRead).
   Взаємодія між сутностями (короткий опис)
   Order посилається на Master і Service з Catalog, і на клієнта з User.
   Payment створюється тільки для існуючого Order.
   Review можна створити тільки для Order зі статусом done.
   VerificationRequest належить конкретному Master; поки заявка не verified, майстер не може приймати нові Order.
   Notification генерується подіями з інших контекстів (зміна статусу Order, результат VerificationRequest).