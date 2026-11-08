# Практична робота 10 — Kubernetes (рівень 75 балів)

Проєкт містить Express API застосунок та маніфести Kubernetes для виконання завдань 10-ї практичної роботи.

## Структура папки
* `app/server.js` — застосунок Node.js з ендпоінтами `/api/status`, `/api/items`, `/api/slow`, `/api/error`, `/healthz`, `/ready`.
* `Dockerfile` та `.dockerignore` — контейнеризація для Docker.
* `package.json` — конфігурація Node.js залежностей.
* `namespace.yaml` — Namespace `k8s-demo`.
* `configmap.yaml` — ConfigMap `k8s-demo-config` зі змінною `APP_MODE: "dev"`.
* `secret.yaml` (та `secret.example.yaml`) — Secret `k8s-demo-secret`.
* `deployment.yaml` — Deployment `k8s-demo-api` (2 репліки, liveness/readiness probes, envFrom).
* `service.yaml` — Service `k8s-demo-api` (ClusterIP, порт 80 -> 8080).
* `REPORT.md` — детальний текстовий звіт на 75 балів із виводами команд та відповідями на контрольні запитання.

## Швидкий запуск

### 1. Локальний запуск
```bash
npm install
npm run dev
# Перевірка:
curl http://localhost:8080/api/status
```

### 2. Збірка Docker-образу
```bash
docker build -t k8s-demo-app:1.0.0 .
```

### 3. Розгортання в Minikube
```bash
minikube start --driver=docker
kubectl apply -f namespace.yaml
kubectl apply -f configmap.yaml
kubectl apply -f secret.yaml
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml

# Перевірка статусу:
kubectl get deployment,rs,pods,svc -n k8s-demo

# Доступ через port-forward:
kubectl port-forward svc/k8s-demo-api -n k8s-demo 8080:80
```

### 4. Оновлення ConfigMap (демонстрація для 75 балів)
```bash
# Змінити APP_MODE у configmap.yaml на "prod" та застосувати:
kubectl apply -f configmap.yaml

# Перезапуск Deployment для застосування змін:
kubectl rollout restart deployment k8s-demo-api -n k8s-demo
```
