# Практична 10 — Kubernetes hands-on на Node.js, Docker і Minikube

## Мета

Практична 10 ізольована від manifests Практичної 9 у каталозі
`k8s-practical10/` та namespace `masterhub-p10`. Demo app має Deployment із
двома replicas, ClusterIP Service, ConfigMap, Secret, Ingress для
`k8s-demo.local` і окремий debug pod/Service/Ingress. Це дає відтворюваний
сценарій **Client → Ingress → Service → Pods** без зміни існуючого MasterHub API.

## Demo API

| Endpoint | Призначення |
|---|---|
| `/api/status` | app name, environment і факт наявності Secret |
| `/api/items` | приклад JSON-списку |
| `/api/slow?ms=2000` | контрольована затримка для debug/Ingress timeout |
| `/api/error` | навмисний HTTP 500 для перевірки помилок |
| `/healthz` | liveness health endpoint |
| `/ready` | readiness endpoint |
| `/debug/` | NGINX debug pod через окремий Ingress path |

## Підготовка Minikube

```bash
minikube start
minikube addons enable ingress
docker build -f k8s-practical10/Dockerfile -t masterhub-k8s-demo:latest .
minikube image load masterhub-k8s-demo:latest
```

Для `imagePullPolicy: IfNotPresent` Minikube використовує завантажений локальний
image і не потребує registry. У звичайному кластері замініть image на GHCR або
інший registry і додайте `imagePullSecrets`, якщо він приватний.

## Deploy

Спочатку замініть `DEMO_SECRET` у `k8s-practical10/secret.example.yaml`, потім
застосуйте весь Kustomize-набір (він створить Namespace і Secret у правильному
порядку):

```bash
kubectl apply -k k8s-practical10/
kubectl -n masterhub-p10 get pods,svc,ingress
kubectl -n masterhub-p10 rollout status deployment/k8s-demo
```

Для локального DNS:

```bash
minikube ip
```

Додайте IP з попередньої команди до `hosts`:

```text
<MINIKUBE_IP> k8s-demo.local
```

## Демонстрація

```bash
curl http://k8s-demo.local/healthz
curl http://k8s-demo.local/ready
curl http://k8s-demo.local/api/status
curl http://k8s-demo.local/api/items
curl -i http://k8s-demo.local/api/error
curl -i "http://k8s-demo.local/api/slow?ms=2000"
curl -i http://k8s-demo.local/debug/
```

Покажіть, що Ingress розділяє трафік: `/api/*`, `/healthz` і `/ready` потрапляють
у Node.js Service, а `/debug/` — безпосередньо до debug Service. Для debug:

```bash
kubectl -n masterhub-p10 describe ingress k8s-demo
kubectl -n masterhub-p10 logs deployment/k8s-demo
kubectl -n masterhub-p10 exec deploy/k8s-demo -- printenv | findstr "APP_ DEMO_SECRET"
kubectl -n masterhub-p10 run curl --rm -it --image=curlimages/curl -- \
  curl http://k8s-demo/api/status
```

Остання команда демонструє Service discovery всередині namespace. У Linux/macOS
замість `findstr` використайте `grep`.

## Структурна перевірка без кластера

```bash
kubectl kustomize k8s-practical10
kubectl apply --dry-run=client --validate=false -k k8s-practical10
npm test
```

`kubectl kustomize` перевіряє рендеринг Kustomize локально. `--validate=false`
потрібен, якщо Kubernetes API server не запущений і kubectl не може завантажити
OpenAPI schema. Реальний Minikube deployment у цьому середовищі не є обов'язковим.

## Що показати у звіті

1. `kubectl get pods,svc,ingress -n masterhub-p10`;
2. `/api/status` і `/api/items` через `k8s-demo.local`;
3. `/api/error` або `/api/slow` для debug-сценарію;
4. `/debug/` як доказ роботи окремого debug Ingress path;
5. фрагмент `kubectl describe ingress` із host, paths і backend Services.

Це відповідає рівню близько 90 балів: Deployment, Service, ConfigMap, Secret,
health endpoints, Ingress і debug pod/Ingress. Повний production-рівень можна
розширити TLS, HPA, NetworkPolicy та CI/CD rollout за image SHA.
