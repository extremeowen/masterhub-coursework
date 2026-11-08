# Звіт до практичної роботи №10
## Тема: Kubernetes, практична частина
**Рівень оцінювання:** 75 балів (Рівень 60 балів + Рівень 75 балів)

---

## 1. Мета роботи
Ознайомитися з повним циклом розгортання та керування сервісом у Kubernetes:
1. Контейнеризація Node.js-застосунку за допомогою Docker.
2. Розгортання сервісу в локальному кластері Minikube за допомогою маніфестів `Deployment` та `Service`.
3. Організація передачі конфігурації через `ConfigMap` та конфіденційних даних через `Secret`.
4. Демонстрація впливу оновлення `ConfigMap` на роботу контейнерів без перезапуску та після `kubectl rollout restart`.
5. Дослідження діагностичних механізмів: `kubectl describe`, `kubectl logs`, а також налаштування перевірок працездатності `livenessProbe` та `readinessProbe`.

---

## 2. Завдання на 60 балів

### 2.1. Підготовка застосунку та локальний запуск
Застосунок являє собою легковажний Express HTTP-сервіс із набором діагностичних та тестових ендпоінтів.

**Команди запуску:**
```bash
npm install
npm run dev
```

**Опис ендпоінтів та результати їх перевірки:**
1. `GET http://localhost:8080/api/status`
   - **Призначення:** повертає поточний статус системи, ім'я застосунку, режим роботи (`mode`) та стан підключення секрету.
   - **Приклад відповіді:**
     ```json
     {
       "status": "ok",
       "app": "k8s-demo-app",
       "mode": "dev",
       "secretConfigured": true,
       "secretToken": "super-secret-token-75"
     }
     ```
2. `GET http://localhost:8080/api/items?filter=a`
   - **Призначення:** повертає список сутностей з підтримкою фільтрації за підрядком.
   - **Приклад відповіді:**
     ```json
     {
       "items": [
         { "id": 1, "name": "Kubernetes deployment" },
         { "id": 2, "name": "ConfigMap and Secret" }
       ]
     }
     ```
3. `GET http://localhost:8080/api/slow?ms=1000`
   - **Призначення:** емулює повільну відповідь із заданою або дефолтною затримкою (для тестування таймаутів).
   - **Приклад відповіді:**
     ```json
     { "status": "completed", "delayMs": 1000 }
     ```
4. `GET http://localhost:8080/api/error`
   - **Призначення:** контрольовано повертає HTTP 500 для перевірки обробки збоїв та аналізу логів.
   - **Приклад відповіді:**
     ```json
     { "error": "DemoError", "message": "Intentional error endpoint for Kubernetes debugging" }
     ```
5. `GET http://localhost:8080/healthz`
   - **Призначення:** Liveness-проба для Kubernetes, перевіряє життєздатність процесу Node.js.
   - **Приклад відповіді:**
     ```json
     { "status": "ok", "app": "k8s-demo-app" }
     ```
6. `GET http://localhost:8080/ready`
   - **Призначення:** Readiness-проба для Kubernetes, сигналізує готовність контейнера приймати мережевий трафік від Service.
   - **Приклад відповіді:**
     ```json
     { "status": "ready", "mode": "dev" }
     ```

---

### 2.2. Контейнеризація застосунку

**Вміст `Dockerfile`:**
```dockerfile
FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY app/ ./app/

ENV PORT=8080
EXPOSE 8080

CMD ["node", "app/server.js"]
```

**Команди збірки та локального запуску контейнера:**
```bash
# Збірка Docker-образу
docker build -t k8s-demo-app:1.0.0 .

# Запуск контейнера з передачею тестового секрету через ENV
docker run --rm -d -p 8080:8080 -e SECRET_TOKEN=local-token --name k8s-demo k8s-demo-app:1.0.0
```

**Перевірка роботи контейнера:**
```bash
curl http://localhost:8080/api/status
```
**Відповідь:**
```json
{
  "status": "ok",
  "app": "k8s-demo-app",
  "mode": "dev",
  "secretConfigured": true,
  "secretToken": "local-token"
}
```

```bash
docker stop k8s-demo
```

---

### 2.3. Запуск Minikube та перевірка кластера

**Команди запуску та конфігурації:**
```bash
minikube start --memory=4096 --cpus=2 --driver=docker
kubectl config use-context minikube
kubectl config current-context
```

**Вивід перевірки контексту та вузлів кластера:**
```text
$ kubectl config current-context
minikube

$ kubectl get nodes
NAME       STATUS   ROLES           AGE   VERSION
minikube   Ready    control-plane   5d    v1.30.0

$ kubectl get pods -A
NAMESPACE     NAME                               READY   STATUS    RESTARTS   AGE
kube-system   coredns-7db6d8ff4d-5q8zk           1/1     Running   0          5d
kube-system   etcd-minikube                      1/1     Running   0          5d
kube-system   kube-apiserver-minikube            1/1     Running   0          5d
kube-system   kube-controller-manager-minikube   1/1     Running   0          5d
kube-system   kube-proxy-8f9x2                   1/1     Running   0          5d
kube-system   kube-scheduler-minikube            1/1     Running   0          5d
kube-system   storage-provisioner                1/1     Running   0          5d
```
*Статус ноди Minikube — `Ready`, використовується контекст `minikube`.*

---

### 2.4. Розгортання ресурсів у кластері

Застосовано маніфести з каталогу `k8s/`:
```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

**Перевірка стану ресурсів:**
```bash
$ kubectl get deployment,rs,pods,svc -n k8s-demo
NAME                           READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/k8s-demo-api   2/2     2            2           45s

NAME                                      DESIRED   CURRENT   READY   AGE
replicaset.apps/k8s-demo-api-5bf68c99bc   2         2         2       45s

NAME                                READY   STATUS    RESTARTS   AGE
pod/k8s-demo-api-5bf68c99bc-7k9wx   1/1     Running   0          45s
pod/k8s-demo-api-5bf68c99bc-m4v2p   1/1     Running   0          45s

NAME                   TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)   AGE
service/k8s-demo-api   ClusterIP   10.108.45.120   <none>        80/TCP    45s
```
*Усі поди перебувають у статусі `Running`, стан контейнерів — `READY 1/1`.*

---

### 2.5. Доступ через Service та kubectl port-forward

**Команда прокидання порту:**
```bash
kubectl port-forward svc/k8s-demo-api -n k8s-demo 8080:80
```

**Тестування доступу через другий термінал:**
```bash
$ curl http://localhost:8080/api/status
{"status":"ok","app":"k8s-demo-app","mode":"dev","secretConfigured":true,"secretToken":"super-secret-token-75"}

$ curl http://localhost:8080/api/items
{"items":[{"id":1,"name":"Kubernetes deployment"},{"id":2,"name":"ConfigMap and Secret"},{"id":3,"name":"Ingress routing"}]}
```

**Шлях проходження запиту:**
`Клієнт (curl / браузер на хості)` → `kubectl port-forward (тунель через kube-apiserver до Service)` → `Service k8s-demo-api (ClusterIP віртуальний IP і балансування iptables/ipvs)` → `Один із здорових Pod-ів (endpoint порт 8080)` → `Процес Node.js`.

---

## 3. Завдання на 75 балів

### 3.1. Робота з ConfigMap: початковий стан `APP_MODE`

Перевірка конфігурації у ConfigMap:
```bash
$ kubectl get configmap k8s-demo-config -n k8s-demo -o yaml
```
```yaml
apiVersion: v1
data:
  APP_MODE: dev
  APP_NAME: k8s-demo-app
  PORT: "8080"
  SLOW_MS: "1500"
kind: ConfigMap
metadata:
  name: k8s-demo-config
  namespace: k8s-demo
```

Перевірка змінної середовища безпосередньо всередині запущеного пода:
```bash
$ kubectl exec -n k8s-demo k8s-demo-api-5bf68c99bc-7k9wx -- env | grep APP_MODE
APP_MODE=dev
```

Запит до сервісу:
```bash
$ curl http://localhost:8080/api/status
{"status":"ok","app":"k8s-demo-app","mode":"dev","secretConfigured":true,"secretToken":"super-secret-token-75"}
```

---

### 3.2. Демонстрація ефекту зміни ConfigMap без рестарту pod-ів

Змінюємо значення `APP_MODE` у файлі `k8s/configmap.yaml`:
```yaml
data:
  APP_MODE: "prod"
```

Застосовуємо змінений маніфест:
```bash
$ kubectl apply -f k8s/configmap.yaml
configmap/k8s-demo-config configured

$ kubectl get configmap k8s-demo-config -n k8s-demo -o yaml | grep APP_MODE
  APP_MODE: prod
```
*У самому об'єкті ConfigMap у кластері значення успішно оновилося на `prod`.*

Перевіряємо значення змінної середовища у **тому самому** запущеному поді:
```bash
$ kubectl exec -n k8s-demo k8s-demo-api-5bf68c99bc-7k9wx -- env | grep APP_MODE
APP_MODE=dev
```

Повторний HTTP-запит до сервісу:
```bash
$ curl http://localhost:8080/api/status
{"status":"ok","app":"k8s-demo-app","mode":"dev","secretConfigured":true,"secretToken":"super-secret-token-75"}
```

#### Пояснення явища:
1. **Чому значення `APP_MODE` всередині пода не змінилося?**
   Змінні середовища (`env` / `envFrom`) передаються ядром операційної системи Linux у процес лише **один раз під час створення контейнера** (системний виклик `execve`). Після запуску процесу його таблиця оточення є ізольованою та статичною в оперативній пам'яті. Зміна об'єкта `ConfigMap` у Kubernetes etcd жодним чином автоматично не оновлює пам'ять уже працюючих процесів.
2. **На якому етапі env-змінні потрапляють усередину контейнера?**
   На етапі створення контейнера компонентом `kubelet` спільно з рушієм контейнеризації (containerd/Docker). Kubelet зчитує значення з ConfigMap/Secret, формує специфікацію OCI runtime і передає їх як змінні середовища при старті нового процесу в контейнері.

---

### 3.3. Перезапуск Deployment та підтвердження оновленої конфігурації

Щоб застосунок підхопив оновлений `ConfigMap`, виконуємо плавний перезапуск деплойменту:
```bash
$ kubectl rollout restart deployment k8s-demo-api -n k8s-demo
deployment.apps/k8s-demo-api restarted
```

Спостереження за процесом оновлення:
```bash
$ kubectl get pods -n k8s-demo
NAME                                READY   STATUS              RESTARTS   AGE
k8s-demo-api-5bf68c99bc-7k9wx       1/1     Terminating         0          10m
k8s-demo-api-5bf68c99bc-m4v2p       1/1     Terminating         0          10m
k8s-demo-api-68df7c4897-b2w9q       1/1     Running             0          8s
k8s-demo-api-68df7c4897-rx4zk       1/1     Running             0          7s
```

Перевірка змінної в новоствореному поді:
```bash
$ kubectl exec -n k8s-demo k8s-demo-api-68df7c4897-b2w9q -- env | grep APP_MODE
APP_MODE=prod
```

Перевірка відповіді сервісу через HTTP:
```bash
$ curl http://localhost:8080/api/status
{"status":"ok","app":"k8s-demo-app","mode":"prod","secretConfigured":true,"secretToken":"super-secret-token-75"}
```
*Конфігурація успішно оновилася на `prod` без простою сервісу завдяки стратегії RollingUpdate.*

#### Аналітичні висновки:
* **Роль `kubectl rollout restart`:** команда оновлює анотацію `kubectl.kubernetes.io/restartedAt` у шаблоні PodTemplateSpec деплойменту. Це спонукає контролер Deployment створити новий ReplicaSet і почати поступову заміну старих подів на нові (`RollingUpdate`), що гарантує підхоплення свіжих значень з `ConfigMap` при нульовому простої (zero-downtime).
* **Рекомендований підхід до оновлення конфігурації в продакшені:**
  1. *Через змінні середовища:* внесення змін до ConfigMap + виконання `kubectl rollout restart` (або використання GitOps-інструментів типу ArgoCD / Helm).
  2. *Через монтування томів (Volume Mount):* якщо монтувати ConfigMap як файл (`/etc/config`), Kubernetes автоматично оновлює вміст файлу у файловій системі контейнера без рестарту пода, а застосунок може перечитувати його «на льоту» (hot-reload).
  3. *Хешування конфігурацій (Kustomize `configMapGenerator`):* до імені ConfigMap додається унікальний хеш (наприклад, `k8s-demo-config-7b2fd8h9`). Зміна конфігурації генерує нове ім'я, що автоматично тригерить новий rollout деплойменту.

---

### 3.4. Аналіз health-checkів (Liveness та Readiness)

Детальний опис поду:
```bash
$ kubectl describe pod k8s-demo-api-68df7c4897-b2w9q -n k8s-demo
```

**Фрагмент виводу секції перевірок:**
```text
Containers:
  k8s-demo-api:
    Container ID:   containerd://b4e54...
    Image:          k8s-demo-app:1.0.0
    Port:           8080/TCP
    State:          Running
    Ready:          True
    Liveness:       http-get http://:http/healthz delay=10s timeout=1s period=10s #success=1 #failure=3
    Readiness:      http-get http://:http/ready delay=3s timeout=1s period=5s #success=1 #failure=3
    Environment Variables from:
      k8s-demo-config  ConfigMap  Optional: false
      k8s-demo-secret  Secret     Optional: false
```

**Порівняльна таблиця параметрів перевірок:**

| Параметр | Liveness Probe (`/healthz`) | Readiness Probe (`/ready`) |
|---|---|---|
| **Шлях перевірки** | `/healthz` | `/ready` |
| **Порт** | `http` (8080) | `http` (8080) |
| **initialDelaySeconds** | `10` секунд (час на ініціалізацію Node.js) | `3` секунди (початок перевірки готовності) |
| **periodSeconds** | `10` секунд (інтервал опитування) | `5` секунд (частіший контроль доступності) |
| **failureThreshold** | `3` невдалі спроби | `3` невдалі спроби |
| **Дія при провалі** | `kubelet` примусово вбиває і перезапускає контейнер (`RestartPolicy`) | Pod тимчасово вилучається зі списку Endpoints сервісу; трафік на нього не надсилається, контейнер **не** перезапускається |

#### Різниця між Liveness та Readiness перевірками:
* **Liveness Probe (живучість):** відповідає на запитання *«Чи живий і працездатний процес?»*. Вона діагностує зависання, дедлоки (deadlocks) або незворотні критичні збої. Якщо liveness-перевірка зазнає невдачі `failureThreshold` разів поспіль, Kubernetes перезапускає контейнер.
* **Readiness Probe (готовність):** відповідає на запитання *«Чи готовий контейнер прямо зараз обслуговувати користувачів?»*. Вона контролює прогрів кешу, наявність з'єднання з базою даних, міграції або пікове навантаження. При невдачі контейнер **не перезапускається**, а тимчасово ізолюється від клієнтських запитів у Service. Як тільки готовність відновлюється, трафік повертається на цей Pod.

---

## 4. Відповіді на контрольні запитання

### 1. У чому відмінність між ConfigMap та Secret?
* **ConfigMap** призначений для зберігання відкритої, нечутливої конфігурації (наприклад, порти, рівні логування `APP_MODE`, адреси сторонніх API, таймаути). Дані зберігаються відкритим текстом (`plaintext`).
* **Secret** призначений для зберігання конфіденційних даних (паролі, токени авторизації, приватні сертифікати, ключі шифрування). Значення у маніфестах кодуються у форматі `base64`, а на рівні кластера Secret можна зашифрувати у спокої (Encryption at Rest у etcd) та обмежити доступ через RBAC-політики.

### 2. У чому відмінність між liveness- та readiness-перевірками?
* **Liveness** контролює життєздатність процесу всередині контейнера. У разі провалу перевірки контейнер негайно перезапускається (`restart`).
* **Readiness** контролює здатність застосунку приймати трафік. У разі провалу контейнер **не перезапускається**, а виключається з пулу балансування Service (Endpoints), що запобігає отриманню користувачами помилок 502/503 під час тимчасової деградації.

### 3. Через які ресурси проходить запит при зверненні через `kubectl port-forward`?
Запит іде за ланцюжком:
`Клієнтський виклик на localhost:8080` → `Локальний процес kubectl port-forward` → `Шифрований SPDY/WebSocket тунель до kube-apiserver` → `Внутрішній проксі до Service k8s-demo-api` → `Балансування на один із цільових Pod-ів (IP:порт)` → `Слухаючий процес Node.js всередині контейнера`.

### 4. Як рекомендується оновлювати конфігурацію, якщо вона надходить через env-змінні з ConfigMap?
Оскільки env-змінні не оновлюються динамічно у запущених процесах, рекомендовано застосовувати команду:
```bash
kubectl rollout restart deployment/<deployment-name> -n <namespace>
```
Це ініціює кероване поступове оновлення (`RollingUpdate`): Kubernetes по черзі створює нові поди, які зчитують свіжі змінні з оновленого ConfigMap, дочікується їхньої готовності за `readinessProbe` і лише після цього зупиняє старі поди, забезпечуючи нульовий час простою (zero-downtime deployment).

---

## 5. Висновок
У ході виконання роботи для рівня **75 балів**:
1. Створено та контейнеризовано робочий Express-сервіс із набором ендпоінтів для тестування станів та збоїв.
2. Підготовлено маніфести Kubernetes (`Namespace`, `ConfigMap`, `Secret`, `Deployment`, `Service`).
3. Розгорнуто сервіс у Minikube та перевірено доступ через Service за допомогою `kubectl port-forward`.
4. Практично продемонстровано статичність змінних середовища в контейнерах при зміні `ConfigMap` без рестарту pod-ів.
5. Застосовано `kubectl rollout restart` для безшовної доставки нової конфігурації `APP_MODE=prod`.
6. Детально проаналізовано конфігурацію та принципову різницю між `livenessProbe` та `readinessProbe`.
