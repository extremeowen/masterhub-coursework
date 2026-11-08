# Практична 9 — Kubernetes-архітектура та deployment

## Мета

MasterHub розгортається в Kubernetes як окремі frontend та API deployments,
доступні через один Ingress. Namespace ізолює ресурси практичної, Services
дають стабільні DNS-імена всередині кластера, а PostgreSQL StatefulSet з PVC
демонструє збереження даних. Схема потоку: **Client → DNS → Ingress/Gateway →
Service → Pods**; API має дві репліки для rolling update та базової
відмовостійкості.

## Що входить у manifests

- `k8s/namespace.yaml` — namespace `masterhub`;
- `k8s/configmap.yaml` — не секретні налаштування API та OTLP endpoints;
- `k8s/secret.example.yaml` — шаблон секретів PostgreSQL, який треба замінити
  перед реальним deploy;
- `k8s/api.yaml` — API Deployment із 2 replicas, ClusterIP Service, ресурсами,
  rolling update, `/ready` readiness, `/healthz` liveness/startup probes і портом метрик
  `9465`; JSON application logs мають `emptyDir` mount для подальшого збору
  Promtail/агентом;
- `k8s/frontend.yaml` — frontend Deployment із 2 replicas та ClusterIP Service;
- `k8s/postgres.yaml` — навчальний PostgreSQL StatefulSet з headless Service і
  PVC `1Gi`;
- `k8s/ingress.yaml` — host `masterhub.local`: `/orders`, `/health`, `/healthz`
  і `/ready` ідуть до API, `/` — до frontend;
- `k8s/kustomization.yaml` — один entrypoint для `kubectl apply -k`;
- `docs/practical9-architecture.mmd` — діаграма архітектури та CI/CD flow.

У production PostgreSQL краще винести в керовану зовнішню БД, а Secret подавати
через Sealed Secrets, External Secrets або cloud secret manager. StatefulSet у
цьому завданні потрібен як відтворюваний локальний навчальний варіант, а не як
повна production HA-конфігурація.

## Підготовка образів

Маніфести очікують образи `masterhub-api:latest` та `masterhub-web:latest`.
Для Minikube:

```bash
minikube start
minikube image build -t masterhub-api:latest -f Dockerfile .
minikube image build -t masterhub-web:latest -f web/Dockerfile .
```

Важливо: `masterhub-api:latest` у Minikube — локальний image, а в
`k8s/api.yaml` встановлено `imagePullPolicy: IfNotPresent`. Після змін у
`server.js` Kubernetes не побачить новий код автоматично, якщо image має той
самий tag. Для оновлення API виконайте:

```bash
minikube image build -t masterhub-api:latest -f Dockerfile .
kubectl apply -k k8s/
kubectl -n masterhub rollout restart deployment/masterhub-api
kubectl -n masterhub rollout status deployment/masterhub-api
kubectl -n masterhub get pods -l app.kubernetes.io/name=masterhub-api \
  -o custom-columns=NAME:.metadata.name,IMAGE:.spec.containers[0].image,IMAGE_ID:.status.containerStatuses[0].imageID
```

`kubectl apply -k k8s/` оновлює manifests, а `rollout restart` гарантовано
створює нові Pods і змушує їх використати щойно завантажений локальний image.
Якщо змінювався frontend, аналогічно виконайте `minikube image build -t
masterhub-web:latest -f web/Dockerfile .` та restart для
`masterhub-frontend`. У production краще використовувати незмінний tag за
commit SHA замість повторного використання `latest`.

Для звичайного кластера замініть `image` у `k8s/api.yaml` і
`k8s/frontend.yaml` на приватний/public registry та додайте `imagePullSecrets`
за потреби. Практична 7 вже публікує API image у GHCR; frontend image треба
зібрати та опублікувати окремим pipeline або використати локальний registry.

## Deploy і перевірка

```bash
kubectl apply -f k8s/secret.example.yaml
kubectl apply -k k8s/
kubectl -n masterhub get all
kubectl -n masterhub get ingress
kubectl -n masterhub rollout status deployment/masterhub-api
kubectl -n masterhub rollout status deployment/masterhub-frontend
```

Додайте локальний DNS-запис у `hosts` або використайте адресу Ingress
Controller:

```text
127.0.0.1 masterhub.local
```

Після цього перевірте:

```bash
curl http://masterhub.local/healthz
curl http://masterhub.local/ready
curl http://masterhub.local/orders
```

Якщо `/healthz` повертає `404`, спочатку перевірте image у Pod:

```bash
kubectl -n masterhub logs deployment/masterhub-api
kubectl -n masterhub get pods -l app.kubernetes.io/name=masterhub-api \
  -o custom-columns=NAME:.metadata.name,IMAGE_ID:.status.containerStatuses[0].imageID
```

Логи зі старим повідомленням або старим `IMAGE_ID` означають, що Pod працює зі
старим image; повторіть rebuild і `rollout restart` вище. Поточний source
підтримує `/health`, `/healthz` і `/ready`, тому після оновлення image всі три
маршрути мають відповідати `200` за готової PostgreSQL.

Readiness API перевіряє реальну готовність PostgreSQL через `/ready`. Для
зворотної сумісності `/health` залишається робочим alias, а `/healthz` є
liveness endpoint. OTEL
параметри вже передані в API Deployment і очікують Collector Service
`otel-collector.observability.svc.cluster.local`; у кластері його можна
підключити до наявного observability stack із Практичної 8.

## CI/CD потік

1. Git push або pull request запускає GitHub Actions.
2. Workflow виконує `npm ci` і `npm test`, після чого збирає Docker image.
3. Образ публікується в GHCR з тегом commit SHA.
4. Deployment у Kubernetes отримує новий image tag через `kubectl set image`
   або GitOps-рішення (Argo CD/Flux), після чого робить rolling update.

Для локальної структурної перевірки без кластера:

```bash
kubectl kustomize k8s
kubectl apply --dry-run=client --validate=false -k k8s
```

`kubectl kustomize` є повністю локальним рендерингом. `kubectl apply
--dry-run=client` без `--validate=false` може спробувати завантажити OpenAPI
schema з активного кластера; якщо cluster не запущений, використовуйте
наведений варіант із вимкненою server-side schema validation.

95–100 балів можна розширити додаванням Grafana Alerting, HPA, NetworkPolicy,
TLS через cert-manager та GitOps-синхронізацією; це свідомо не включено в
орієнтир близько 90 балів.
