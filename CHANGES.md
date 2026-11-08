# Що змінено

Розпакуйте архів у корінь проєкту (папка, де лежить `package.json`) із заміною файлів.

## Обов'язково вручну
1. Видалити `docs/adr/0003-layered-architecture.md` — замість нього `docs/adr/0002-layered-architecture.md`.
2. Не комітити й не пересилати `.env`, `masterhub.db`, `.idea/` (вони в `.gitignore`, але потрапили в zip).
3. Перезняти `docs/api/swagger_screenshot.png`: контракт змінився (вставте новий `openapi.yaml` у https://editor.swagger.io/).
4. У GitHub: Settings → Actions → General → Workflow permissions: Read and write (для публікації в GHCR); після першої публікації зробити пакети `-api` і `-web` публічними, якщо потрібен доступ ззовні.

## Файли
| Файл | Зміна |
|---|---|
| `README.md` | Переписано як README продукту; практики винесено в `docs/labs.md` |
| `docs/labs.md` | Нова: відповідність «практична → де в проєкті» |
| `REPORT.md` | Звіт по курсовій (раніше — лише по лабі 10) |
| `docs/api/openapi.yaml` | Додано auth, `/user/*`, `/admin/*`, відгуки, `/healthz`, `/ready`; валідовано |
| `docs/adr/0001…0003` | Виправлено пошкоджені шляхи (`../../api`), нумерацію (було два 0003), прибрано «командний» |
| `.github/workflows/ci.yml` | Публікація `api` і `web`, теги `vX.Y.Z` + `sha-`, Trivy, Job Summary, JUnit, `packages: write` лише в publish |
| `.github/dependabot.yml` | Нове: npm, actions, docker |
| `observability/grafana/provisioning/alerting/masterhub-alerts.yaml` | Нове: 2 алерти, contact point, policy |
| `observability/grafana/dashboards/masterhub-red.json` | Додано панель Alert list |
| `tests/audit-reviews.test.js`, `tests/integration-features.test.js` | Ізольована in-memory БД замість `masterhub.db`; пауза між записами аудиту |

## Про тести
`new AuditRepository()` і `new ReviewsRepository()` без аргументів відкривають реальний `masterhub.db`, тому два тести падали на чистому чекауті, а збірка CI була б червоною. Після виправлення 24/24 тестів проходять стабільно (6 запусків поспіль).

## Не перевірено
Docker, Grafana, Kubernetes і сам GitHub Actions я не запускав: перевірено лише синтаксис YAML/JSON, валідність OpenAPI і `npm test`.
