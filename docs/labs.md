# Відповідність практичних робіт і проєкту

Проєкт MasterHub є наскрізним результатом практичних робіт курсу. Таблиця показує, де шукати результат кожної з них.

| № | Тема | Де в проєкті |
|---|---|---|
| 1 | Клієнт → бекенд → БД | `server.js`, `public/`, `repository/`, `init-db.js` |
| 2 | Бізнес-документ і архітектурна діаграма | `docs/business_doc.md`, `docs/Architecture diagram.drawio .png`, `docs/roadmap.md` |
| 3 | DDD: домен і bounded contexts | `docs/domain/` (`entities.md`, `glossary.md`, `context_map`), `domain/` |
| 4 | Контракт API, CRUD, ADR | `docs/api/openapi.yaml`, `docs/api/swagger_screenshot.png`, `docs/adr/0001–0003`, `api/`, `service/`, `tests/orders.service.test.js` |
| 5 | Помилки: ідемпотентність, ретраї, таймаути | `api/orders.routes.js`, `api/middleware.js`, `service/dependency-client.js`, `public/api-client.js`, `tests/api.resilience.test.js` |
| 6 | Docker і docker-compose | `Dockerfile`, `web/Dockerfile`, `.dockerignore`, `docker-compose.yml` |
| 7 | CI/CD на GitHub Actions | `.github/workflows/ci.yml`, `.github/dependabot.yml`, звіт `docs/practical7-report.md` |
| 8 | Observability (Grafana, Loki, Tempo, OTEL) | `telemetry.js`, `observability/`, дашборди `docs/my-demo-red-dashboard.json` (75 балів) та `masterhub-red.json` (100 балів), звіт `docs/practical8-report.md` |
| 9 | Теоретична схема Kubernetes | `docs/practical9-architecture.mmd`, `docs/practical9-defense.md` |
| 10 | Kubernetes, практична частина | `k8s/` (MasterHub), `k8s-practical10/` (демо-сервіс), `docs/practical10-defense.md` |

Демонстраційні репозиторії курсу (`ci-cd-demo`, `observability-demo`, `k8s-demo`) використовувалися для базових рівнів; вищі рівні виконані на самому MasterHub.
