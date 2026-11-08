# MasterHub

[![CI/CD](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)

MasterHub — маркетплейс, що з'єднує клієнтів із перевіреними майстрами побутових послуг в Україні. Клієнт вибирає майстра й послугу, створює замовлення, після виконання залишає відгук; адміністратор керує довідниками, ролями та замовленнями. Курсовий проєкт з архітектури, DevOps і спостережуваності.

## Можливості

- Реєстрація й вхід (підписаний HttpOnly cookie, паролі в scrypt-хешах), ролі `user` та `admin`.
- Замовлення: створення (ідемпотентне), перегляд, скасування; телефон у форматі `+380XXXXXXXXX`.
- Довідники майстрів і послуг з архівуванням (`active=false`) замість видалення.
- Відгуки та рейтинги майстрів після виконаного замовлення.
- Адмін-панель: усі замовлення, користувачі й ролі, довідники, журнал аудиту.
- Надійність API: `X-Request-Id`, єдиний формат помилки, `Idempotency-Key`, rate limit (`429` + `Retry-After`), degraded mode (`503`).
- Фронтенд — hash-based SPA на чистому JS (`public/`), українська локалізація, світла/темна тема.

## Архітектура

Модульний моноліт (ADR 0001) із шарами `api/ → service/ → domain/` та `repository/` (ADR 0002).

| Шар | Призначення |
|---|---|
| `api/` | Express-роути та middleware, відповіді за контрактом OpenAPI |
| `service/` | Use-cases, валідація, помилки |
| `domain/` | Сутності за піддоменами: catalog, booking, users, reviews, payments, verification, notifications |
| `repository/` | In-memory (тести), SQLite (локально), PostgreSQL (Docker/Kubernetes) |

Документація: `docs/business_doc.md`, `docs/domain/`, `docs/adr/`, `docs/api/openapi.yaml`, діаграми в `docs/`.

## Швидкий старт

### Локально (SQLite)

```bash
npm install
npm start        # http://localhost:8080
npm test
```

Щоб створити початкових користувачів, задайте змінні перед запуском:

```bash
export SESSION_SECRET="long-random-value"
export MASTERHUB_ADMIN_EMAIL="admin@example.com"
export MASTERHUB_ADMIN_PASSWORD="use-at-least-8-characters"
# необов'язково:
export MASTERHUB_USER_EMAIL="user@example.com"
export MASTERHUB_USER_PASSWORD="use-at-least-8-characters"
```

У PowerShell: `$env:SESSION_SECRET="..."` тощо.

### Docker Compose (повний стек)

Облікові дані не зберігаються в `docker-compose.yml`; задайте змінні вище в поточному shell (або у файлі `.env`, який не комітиться), потім:

```bash
docker compose config            # перевірка конфігурації
docker compose up -d --build
docker compose ps
docker compose down              # без -v, щоб зберегти дані PostgreSQL
```

| Сервіс | Адреса |
|---|---|
| Frontend (Nginx) | http://localhost:3001 |
| API | http://localhost:8081 (`/health`, `/healthz`, `/ready`) |
| PostgreSQL | localhost:5433 |
| Grafana | http://localhost:3002 (`admin` / `admin`) |
| Prometheus | http://localhost:9090 |
| Loki / Tempo | http://localhost:3100 / http://localhost:3200 |
| OTLP Collector | HTTP `:4318`, gRPC `:4319` |

Перевірка:

```bash
curl -i http://localhost:8081/health
docker compose exec db psql -U masterhub -d masterhub -c "\dt"
```

Не використовуйте `docker compose down -v`, якщо потрібно зберегти дані.

## API

Контракт: [`docs/api/openapi.yaml`](docs/api/openapi.yaml) (OpenAPI 3.0.3). Скріншот рендеру в Swagger Editor: `docs/api/swagger_screenshot.png`. Приклад ідемпотентного створення:

```bash
curl -i -X POST http://localhost:8081/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: demo-1" \
  -d '{"clientId":"c-1","masterId":"m-1","serviceId":"s-1","scheduledAt":"2026-09-20T10:00:00Z"}'
# повтор тим самим ключем повертає той самий id
```

Формат помилки: `{ "error", "code", "details", "requestId" }` (ADR 0003).

## Спостережуваність

`api` надсилає traces і метрики через OpenTelemetry (`service.name=masterhub-api`) у OTEL Collector → Tempo/Prometheus; JSON-логи потрапляють у Loki через Promtail.

Grafana → **Dashboards → MasterHub → MasterHub RED**: RPS, частка 5xx, p95 latency, логи, список алертів. Правила алертів (5xx > 5% та p95 > 500 мс за 5 хвилин) підтягуються автоматично з `observability/grafana/provisioning/alerting/`; стан — у **Alerting → Alert rules**. Трейси: **Explore → Tempo**, фільтр `service.name=masterhub-api`.

## CI/CD

Workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

- тести на Node.js 22 із кешем npm, JUnit-звіт як артефакт, Job Summary;
- на `push` у `main`, теги `v*` та вручну — збірка й публікація образів `api` і `web` у GHCR: `ghcr.io/<owner>/<repo>-api` і `ghcr.io/<owner>/<repo>-web`;
- теги образів: `vX.Y.Z` (для тегів релізу), `sha-<commit>`, `latest` (для `main`);
- Trivy-скан образів (звіт, `exit-code: 0`), мінімальні `permissions`, `concurrency` із `cancel-in-progress`, Dependabot (npm, actions, docker).

## Kubernetes

Маніфести в `k8s/` (namespace `masterhub`): API (2 репліки, probes `/healthz` і `/ready`), frontend, PostgreSQL StatefulSet, ConfigMap, шаблон Secret, Ingress `masterhub.local`.

```bash
minikube start
minikube addons enable ingress
minikube image build -t masterhub-api:latest -f Dockerfile .
kubectl apply -k k8s/
kubectl -n masterhub rollout status deployment/masterhub-api
curl http://masterhub.local/healthz
```

Для Secret скопіюйте `k8s/secret.example.yaml` і підставте власні значення. Після змін у коді API перебудуйте образ і виконайте `kubectl -n masterhub rollout restart deployment/masterhub-api`.

Навчальне демо з окремим сервісом і host `k8s-demo.local` лежить у `k8s-practical10/` і розгортається незалежно.

## Тести

```bash
npm test
```

Юніт-тести сервісів (замовлення, авторизація, валідація контактів), тести надійності API (idempotency, rate limit, degraded mode), аудит і відгуки.

## Відповідність практичним роботам

Таблиця «практична → де в проєкті»: [`docs/labs.md`](docs/labs.md). Звіт по курсовій: [`REPORT.md`](REPORT.md).
