(function () {
    const MAX_CONSECUTIVE_FAILURES = 3;
    let consecutiveFailures = 0;
    let degradedTimer;
    let orders = [];
    let ordersState = "loading";
    let ordersError = "";
    let userOrders = [];
    let userOrdersState = "signedOut";
    let userOrdersError = "";
    let adminOrders = [];
    let adminOrdersState = "idle";
    let adminOrdersError = "";
    let users = [];
    let usersState = "idle";
    let usersError = "";
    let currentUser = null;
    let catalog = { masters: [], services: [] };
    let catalogLoaded = false;
    let healthView = null;
    let language = localStorage.getItem("masterhub-language") || "uk";

    // --- State for 5 New Features ---
    const searchQueries = { dashboard: "", user: "", admin: "" };
    const statusFilters = { dashboard: "all", user: "all", admin: "all" };
    const viewModes = { user: "table", admin: "table" };
    const calendarDates = { user: new Date(), admin: new Date() };
    let userReviewsMap = {};
    let masterReviewsSummary = {};
    let auditLogs = [];
    let selectedReviewRating = 5;

    const $ = (id) => document.getElementById(id);
    const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[char]));
    const pack = window.MasterHubI18n || { locales: { uk: "uk-UA" }, dict: { uk: {} } };
    const translations = pack.dict;
    const t = (key, vars) => {
        let text = translations[language]?.[key] || translations.uk?.[key] || key;
        if (vars) Object.entries(vars).forEach(([name, value]) => { text = text.replaceAll(`{${name}}`, value); });
        return text;
    };
    const localeTag = () => pack.locales[language] || "uk-UA";
    const errorCodeKeys = {
        INVALID_EMAIL: "emailInvalid",
        PASSWORD_REQUIRED: "passwordRequired",
        INVALID_CREDENTIALS: "invalidCredentials",
        INVALID_CONTACT_PHONE: "phoneInvalid",
        USER_STATUS_RESTRICTED: "userStatusRestricted",
        CATALOG_NAME_INVALID: "catalogNameInvalid",
        USER_EXISTS: "userExists",
        LAST_ADMIN: "lastAdmin",
        USER_NOT_FOUND: "userNotFound",
        SELF_DELETE: "selfDelete",
        ADMIN_PROTECTED: "adminProtected",
        AUTH_REQUIRED: "authRequired",
        ROLE_REQUIRED: "roleRequired",
        ORDER_ACCESS_DENIED: "orderAccessDenied",
        IDEMPOTENCY_KEY_REQUIRED: "idempotencyRequired",
        IDEMPOTENCY_KEY_REUSED: "idempotencyReused",
        MASTER_NOT_AVAILABLE: "masterUnavailable",
        SERVICE_NOT_AVAILABLE: "serviceUnavailable",
    };
    const routeKeys = {
        dashboard: "overview",
        orders: "orders",
        catalog: "catalog",
        operations: "operations",
        data: "dataManagement",
        users: "users",
        audit: "auditLog",
        about: "about",
    };

    function statusOptions(status) {
        if (status === "confirmed") return ["confirmed", "done", "cancelled"];
        if (status === "done") return ["done"];
        if (status === "cancelled") return ["cancelled"];
        return ["pending", "confirmed", "cancelled"];
    }

    function fillStatusSelect(current) {
        const select = $("modalStatus");
        if (!select) return;
        const value = current || select.dataset.original || select.value || "pending";
        select.innerHTML = statusOptions(value).map((status) => `<option value="${status}">${escapeHtml(t(status))}</option>`).join("");
        select.value = value;
        select.dataset.original = value;
    }

    function updateThemeButton() {
        const themeToggle = $("themeToggle");
        if (!themeToggle) return;
        const light = document.documentElement.dataset.theme === "light";
        themeToggle.textContent = light ? "☾" : "☼";
        themeToggle.title = light ? t("themeDark") : t("themeLight");
        themeToggle.setAttribute("aria-label", themeToggle.title);
    }

    function updateDateLabel() {
        $("todayLabel").textContent = new Intl.DateTimeFormat(localeTag(), { day: "numeric", month: "long", year: "numeric" }).format(new Date());
    }

    function updateBreadcrumb() {
        const route = (window.location.hash || "#dashboard").slice(1) || "dashboard";
        $("breadcrumbCurrent").textContent = t(routeKeys[route] || "overview");
        document.title = `MasterHub — ${t("workspace")}`;
    }

    function syncFormTitles() {
        if (!$("masterCatalogId")?.value) $("masterFormTitle").textContent = t("newMaster");
        if (!$("serviceCatalogId")?.value) $("serviceFormTitle").textContent = t("newService");
    }

    function setLanguage(lang) {
        language = lang;
        localStorage.setItem("masterhub-language", lang);
        document.documentElement.lang = lang;
        $("languageSelect").value = lang;
        document.querySelectorAll("[data-i18n]").forEach((element) => {
            element.textContent = t(element.dataset.i18n);
        });
        document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
            element.placeholder = t(element.dataset.i18nPlaceholder);
        });
        document.querySelectorAll("[data-i18n-title]").forEach((element) => {
            element.title = t(element.dataset.i18nTitle);
        });
        document.querySelectorAll("[data-i18n-aria]").forEach((element) => {
            element.setAttribute("aria-label", t(element.dataset.i18nAria));
        });
        updateThemeButton();
        updateDateLabel();
        updateBreadcrumb();
        syncFormTitles();
        fillStatusSelect();
        renderOrders();
        renderHealth();
        renderCatalogLists(currentUser?.role === "admin");
        renderUserOrders();
        renderAdminOrders();
        renderUsers();
        renderAnalytics();
        updateAccountUi();
    }

    function tCatalog(text) {
        if (!text) return "";
        const catalogDict = {
            en: {
                "Майстер 1": "Master 1",
                "Майстер 2": "Master 2",
                "Універсальні послуги": "Universal services",
                "Консультації": "Consultations",
                "Консультація": "Consultation",
                "Основна послуга": "Core service",
                "Первинна консультація": "Initial consultation",
                "Виконання замовленої послуги": "Execution of ordered service",
            },
            pl: {
                "Майстер 1": "Fachowiec 1",
                "Майстер 2": "Fachowiec 2",
                "Універсальні послуги": "Usługi uniwersalne",
                "Консультації": "Konsultacje",
                "Консультація": "Konsultacja",
                "Основна послуга": "Usługa główna",
                "Первинна консультація": "Konsultacja wstępna",
                "Виконання замовленої послуги": "Realizacja zamówionej usługi",
            },
        };
        return catalogDict[language]?.[text] || text;
    }

    function fillSelect(selectId, items, selectedValue) {
        const select = $(selectId);
        if (!select) return;
        select.innerHTML = items
            .filter((item) => item.active !== false || item.id === selectedValue)
            .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(tCatalog(item.name))}${item.active === false ? ` (${escapeHtml(t("archived"))})` : ""}</option>`)
            .join("");
        if (selectedValue) select.value = selectedValue;
        else if (items[0]) select.value = items[0].id;
    }

    function showToast(message, type = "success") {
        const region = $("toastRegion");
        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        toast.textContent = message;
        region.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    async function apiFetch(url, options = {}) {
        const separator = url.includes("?") ? "&" : "?";
        const normalizedUrl = `${url}${separator}t=${Date.now()}`;
        const headers = { Accept: "application/json", ...(options.headers || {}) };
        try {
            const response = await fetch(normalizedUrl, { ...options, headers });
            trackDegraded(response.status >= 500);
            return response;
        } catch (error) {
            trackDegraded(true);
            throw error;
        }
    }

    function showConsoleResult(response, payload) {
        const output = $("consoleOutput");
        if (!output) return;
        const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
        output.className = `console-output ${response.ok ? "success" : "error"}`;
        output.textContent = `HTTP ${response.status}\n${text || t("emptyResponse")}`;
    }

    async function readResponse(response) {
        const text = await response.text();
        if (!text) return null;
        try { return JSON.parse(text); } catch { return text; }
    }

    function responseMessage(data, fallback) {
        if (!data) return fallback;
        if (typeof data === "string") return data;
        if (data.code && errorCodeKeys[data.code]) return t(errorCodeKeys[data.code]);
        if (data.details?.message) return data.details.message;
        if (typeof data.details === "string") return data.details;
        if (data.error && errorCodeKeys[data.error]) return t(errorCodeKeys[data.error]);
        return data.error || fallback;
    }

    function setFieldError(fieldId, message) {
        const error = $(`${fieldId}Error`);
        if (error) error.textContent = message || "";
        const input = $(fieldId);
        if (input) input.classList.toggle("invalid", Boolean(message));
    }

    function normalizePhone(value) {
        const raw = String(value || "").replace(/[^\d+]/g, "");
        if (!raw) return "";
        let digits = raw.replace(/\D/g, "");
        if (digits.startsWith("380")) digits = digits.slice(3);
        else if (digits.startsWith("0")) digits = digits.slice(1);
        else if (digits.startsWith("80")) digits = digits.slice(2);
        digits = digits.slice(0, 9);
        return digits ? `+380${digits}` : "+380";
    }

    function validPhone(value) {
        return /^\+380\d{9}$/.test(String(value || "").trim());
    }

    function validEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
    }

    function trackDegraded(failed) {
        const banner = $("degradedBanner");
        if (!banner) return;
        clearTimeout(degradedTimer);
        const success = failed === false;
        if (failed === true) consecutiveFailures += 1;
        else if (success) consecutiveFailures = 0;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            banner.textContent = t("degradedBanner");
            banner.hidden = false;
            degradedTimer = setTimeout(() => { consecutiveFailures = 0; banner.hidden = true; banner.textContent = ""; }, 12000);
        } else if (success) { banner.hidden = true; banner.textContent = ""; }
    }

    function catalogName(kind, id) {
        const item = catalog[kind]?.find((entry) => entry.id === id);
        return item ? tCatalog(item.name) : (id || "—");
    }

    function formatWhen(iso, includeTime = false) {
        if (!iso) return "—";
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return iso;
        const options = { day: "2-digit", month: "short", year: "numeric" };
        if (includeTime) { options.hour = "2-digit"; options.minute = "2-digit"; }
        return new Intl.DateTimeFormat(localeTag(), options).format(date);
    }

    function localDateTime(iso) {
        const date = iso ? new Date(iso) : new Date(Date.now() + 86400000);
        if (Number.isNaN(date.getTime())) return "";
        const pad = (num) => String(num).padStart(2, "0");
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function orderClientParts(order) {
        const raw = String(order.clientId || "");
        if (raw.includes(" · ")) {
            const [name, contact] = raw.split(" · ");
            return { name: name.trim(), contact: contact.trim() };
        }
        return { name: raw || "—", contact: order.contactPhone || "" };
    }

    function statusClass(status) {
        if (status === "confirmed") return "status-confirmed";
        if (status === "done") return "status-done";
        if (status === "cancelled") return "status-cancelled";
        return "status-pending";
    }

    function emptyRow(colspan, text) {
        return `<tr><td colspan="${colspan}" class="empty-state">${escapeHtml(text)}</td></tr>`;
    }

    // --- Search & Filter Helper ---
    function filterOrders(list, query, status) {
        return list.filter((order) => {
            if (status && status !== "all" && order.status !== status) return false;
            if (!query) return true;
            const q = query.toLowerCase().trim();
            const client = (order.clientId || "").toLowerCase();
            const phone = (order.contactPhone || "").toLowerCase();
            const id = (order.id || "").toLowerCase();
            const service = (catalogName("services", order.serviceId) || order.serviceId || "").toLowerCase();
            const master = (catalogName("masters", order.masterId) || order.masterId || "").toLowerCase();
            return client.includes(q) || phone.includes(q) || id.includes(q) || service.includes(q) || master.includes(q);
        });
    }

    // --- Analytics Charts Renderer ---
    function renderAnalytics() {
        const container = $("trendChartContainer");
        const statusContainer = $("statusChartContainer");
        if (!container || !statusContainer) return;

        // 1. Last 7 days orders trend
        const now = new Date();
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
            const pad = (n) => String(n).padStart(2, "0");
            const dayStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            const label = new Intl.DateTimeFormat(localeTag(), { weekday: "short", day: "numeric" }).format(d);
            days.push({ dayStr, label, count: 0 });
        }

        orders.forEach((order) => {
            if (!order.scheduledAt) return;
            const dStr = order.scheduledAt.slice(0, 10);
            const match = days.find((day) => day.dayStr === dStr);
            if (match) match.count += 1;
        });

        const maxCount = Math.max(1, ...days.map((d) => d.count));
        const totalTrend = days.reduce((sum, d) => sum + d.count, 0);
        const badge = $("trendTotalBadge");
        if (badge) badge.textContent = `${totalTrend} ${t("orders")}`;

        const svgWidth = 320;
        const svgHeight = 130;
        const barWidth = 28;
        const gap = Math.max(8, (svgWidth - days.length * barWidth) / (days.length + 1));

        const barsSvg = days.map((day, idx) => {
            const x = gap + idx * (barWidth + gap);
            const barHeight = Math.max(4, Math.round((day.count / maxCount) * 75));
            const y = svgHeight - 25 - barHeight;
            const isToday = idx === days.length - 1;
            const fill = isToday ? "var(--accent)" : "rgba(10, 132, 255, 0.45)";
            return `
                <g class="chart-col">
                    <text x="${x + barWidth / 2}" y="${y - 4}" text-anchor="middle" font-size="10" font-weight="600" fill="var(--ink)">${day.count ? day.count : ""}</text>
                    <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" fill="${fill}" />
                    <text x="${x + barWidth / 2}" y="${svgHeight - 8}" text-anchor="middle" font-size="9" fill="var(--muted)">${escapeHtml(day.label)}</text>
                </g>
            `;
        }).join("");

        container.innerHTML = `<svg class="svg-chart" viewBox="0 0 ${svgWidth} ${svgHeight}">${barsSvg}</svg>`;

        // 2. Status Breakdown
        const total = Math.max(1, orders.length);
        const statuses = [
            { key: "pending", name: t("pending"), count: orders.filter((o) => o.status === "pending").length, fillClass: "fill-pending" },
            { key: "confirmed", name: t("confirmed"), count: orders.filter((o) => o.status === "confirmed").length, fillClass: "fill-confirmed" },
            { key: "done", name: t("done"), count: orders.filter((o) => o.status === "done").length, fillClass: "fill-done" },
            { key: "cancelled", name: t("cancelled"), count: orders.filter((o) => o.status === "cancelled").length, fillClass: "fill-cancelled" },
        ];

        statusContainer.innerHTML = `
            <div class="status-bars-wrap">
                ${statuses.map((st) => {
                    const pct = Math.round((st.count / total) * 100);
                    return `
                        <div class="status-bar-row">
                            <div class="status-bar-meta">
                                <span>${escapeHtml(st.name)}</span>
                                <strong>${st.count} (${pct}%)</strong>
                            </div>
                            <div class="status-bar-track">
                                <div class="status-bar-fill ${st.fillClass}" style="width: ${orders.length ? pct : 0}%"></div>
                            </div>
                        </div>
                    `;
                }).join("")}
            </div>
        `;
    }

    // --- Calendar View Renderer ---
    function renderCalendar(viewType = "user", filteredList = []) {
        const gridId = viewType === "admin" ? "adminCalendarGrid" : "userCalendarGrid";
        const titleId = viewType === "admin" ? "adminCalMonthTitle" : "userCalMonthTitle";
        const grid = $(gridId);
        const title = $(titleId);
        if (!grid) return;

        const currentMonth = calendarDates[viewType] || new Date();
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();

        const monthFormat = new Intl.DateTimeFormat(localeTag(), { month: "long", year: "numeric" });
        if (title) title.textContent = monthFormat.format(currentMonth);

        const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
        const headerHtml = weekdays.map((day) => `<div class="calendar-weekday">${escapeHtml(day)}</div>`).join("");

        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        let startDayOfWeek = firstDay.getDay() - 1;
        if (startDayOfWeek === -1) startDayOfWeek = 6;

        const totalDays = lastDay.getDate();
        const today = new Date();
        const isThisMonth = today.getFullYear() === year && today.getMonth() === month;

        let cellsHtml = "";
        for (let i = 0; i < startDayOfWeek; i++) {
            cellsHtml += `<div class="calendar-day-cell other-month"></div>`;
        }

        for (let day = 1; day <= totalDays; day++) {
            const isToday = isThisMonth && today.getDate() === day;
            const pad = (n) => String(n).padStart(2, "0");
            const dayDateStr = `${year}-${pad(month + 1)}-${pad(day)}`;

            const dayOrders = filteredList.filter((order) => {
                if (!order.scheduledAt) return false;
                return order.scheduledAt.startsWith(dayDateStr);
            });

            const pills = dayOrders.map((order) => {
                const time = order.scheduledAt.slice(11, 16);
                const client = orderClientParts(order);
                const titleText = `#${shortOrderId(order.id)} ${client.name} (${statusText(order.status)})`;
                return `<div class="cal-order-pill status-${order.status}" title="${escapeHtml(titleText)}" data-cal-order="${escapeHtml(order.id)}">
                    <span>${time} ${escapeHtml(client.name.split(" ")[0])}</span>
                </div>`;
            }).join("");

            cellsHtml += `
                <div class="calendar-day-cell ${isToday ? "today" : ""}">
                    <span class="cal-day-num">${day}</span>
                    ${pills}
                </div>
            `;
        }

        grid.innerHTML = headerHtml + cellsHtml;

        grid.querySelectorAll("[data-cal-order]").forEach((pill) => {
            pill.addEventListener("click", () => {
                const oId = pill.dataset.calOrder;
                const order = filteredList.find((o) => o.id === oId);
                if (order) openOrderForm(order);
            });
        });
    }

    function renderOrders() {
        $("navOrderCount").textContent = orders.length;
        $("totalOrders").textContent = orders.length;
        $("pendingOrders").textContent = orders.filter((order) => order.status === "pending").length;
        $("doneOrders").textContent = orders.filter((order) => order.status === "done").length;
        $("ordersTrend").textContent = orders.length ? t("trendStored") : t("trendEmpty");

        renderAnalytics();

        const body = $("ordersBody");
        if (!body) return;
        if (ordersState === "loading") {
            body.innerHTML = emptyRow(7, t("loadingOrders"));
            return;
        }
        if (ordersState === "error") {
            body.innerHTML = emptyRow(7, ordersError || t("loadOrdersFail"));
            return;
        }

        const filtered = filterOrders(orders, searchQueries.dashboard, statusFilters.dashboard);
        if ($("ordersSummary")) $("ordersSummary").textContent = filtered.length ? t("ordersShown", { n: filtered.length }) : t("noMatchingOrders");

        if (!filtered.length) {
            body.innerHTML = emptyRow(7, orders.length ? t("noMatchingOrders") : t("ordersNone"));
            return;
        }
        body.innerHTML = filtered.slice().reverse().map((order) => {
            const actions = currentUser?.role === "admin"
                ? `<div class="modal-row-actions"><button data-order-edit="${escapeHtml(order.id)}">${escapeHtml(t("edit"))}</button><button data-order-delete="${escapeHtml(order.id)}">${escapeHtml(t("delete"))}</button></div>`
                : "";
            const client = orderClientParts(order);
            return `<tr><td class="order-id" title="${escapeHtml(order.id)}">#${escapeHtml(shortOrderId(order.id))}</td><td>${escapeHtml(client.name)}<small class="table-subtext">${escapeHtml(client.contact)}</small></td><td>${escapeHtml(catalogName("masters", order.masterId))}</td><td>${escapeHtml(catalogName("services", order.serviceId))}</td><td>${escapeHtml(formatWhen(order.scheduledAt, false))}</td><td><span class="status-badge ${statusClass(order.status)}">${escapeHtml(statusText(order.status))}</span></td><td>${actions}</td></tr>`;
        }).join("");
        body.querySelectorAll("[data-order-edit]").forEach((button) => button.addEventListener("click", () => {
            const order = orders.find((item) => item.id === button.dataset.orderEdit);
            if (order) openOrderForm(order);
        }));
        body.querySelectorAll("[data-order-delete]").forEach((button) => button.addEventListener("click", () => deleteOrder(button.dataset.orderDelete)));
    }

    function statusText(status) {
        const label = t(status);
        return label === status ? (status || "") : label;
    }

    function renderHealth() {
        if (!healthView) return;
        const { failed, healthy, latencyMs, storage } = healthView;
        if (failed) {
            $("healthPill").innerHTML = `<span class="status-dot" style="background:#ff7e98"></span>${escapeHtml(t("apiDownPill"))}`;
            $("apiStatus").textContent = t("apiDown");
            $("apiLatency").textContent = `${t("latencyError")} · /health`;
            $("storageStatus").textContent = t("storageDown");
            $("operationsApiStatus").textContent = t("apiDown");
            $("operationsApiLatency").textContent = t("connectionError");
            return;
        }
        const storageName = storage === "postgres" ? "PostgreSQL" : storage === "sqlite" ? "SQLite" : storage === "memory" ? t("storageMemory") : t("storageConnected");
        $("healthPill").innerHTML = `<span class="status-dot"></span>${escapeHtml(healthy ? t("healthOk") : t("healthLimited"))}`;
        $("apiStatus").textContent = healthy ? t("apiOk") : t("apiLimited");
        $("apiLatency").textContent = `${latencyMs} ms · /health`;
        $("storageStatus").textContent = healthy ? `${t("storageStable")} · ${storageName}` : t("storageCheck");
        $("operationsApiStatus").textContent = healthy ? t("apiOk") : t("healthLimited");
        $("operationsApiLatency").textContent = `${latencyMs} ms · /health`;
    }

    async function loadHealth() {
        const startedAt = performance.now();
        try {
            const response = await apiFetch("/health/details");
            const data = await readResponse(response);
            const healthy = response.ok && data && data.status === "ok";
            healthView = { failed: false, healthy, latencyMs: Math.round(performance.now() - startedAt), storage: data?.storage };
        } catch (error) {
            healthView = { failed: true };
        }
        renderHealth();
    }

    async function loadOrders() {
        ordersState = "loading";
        renderOrders();
        try {
            if (currentUser) await loadCatalog(currentUser.role === "admin");
            const response = await apiFetch(currentUser?.role === "admin" ? "/admin/orders" : (currentUser ? "/user/orders" : "/orders"));
            const data = await readResponse(response);
            if (!response.ok) throw new Error(responseMessage(data, t("loadOrdersFail")));
            orders = Array.isArray(data) ? data : [];
            ordersState = "ready";
            ordersError = "";
            renderOrders();
        } catch (error) {
            orders = [];
            ordersState = "error";
            ordersError = error.message || t("loadOrdersFail");
            renderOrders();
        }
    }

    // --- Reviews State & Modal Logic ---
    async function loadUserReviews() {
        if (!currentUser) { userReviewsMap = {}; return; }
        try {
            const res = await apiFetch("/user/reviews");
            if (res.ok) {
                const list = await readResponse(res);
                userReviewsMap = {};
                if (Array.isArray(list)) {
                    list.forEach((r) => { userReviewsMap[r.orderId] = r; });
                }
            }
        } catch {}
    }

    function openReviewModal(order) {
        const modal = $("reviewModal");
        if (!modal) return;
        $("reviewOrderId").value = order.id;
        const client = orderClientParts(order);
        $("reviewOrderInfo").textContent = `${t("colOrder")}: #${shortOrderId(order.id)} · ${t("colMaster")}: ${catalogName("masters", order.masterId)}`;
        $("reviewComment").value = "";
        selectedReviewRating = 5;
        updateStarPicker(5);
        $("reviewFormMessage").textContent = "";
        modal.hidden = false;
    }

    function updateStarPicker(val) {
        selectedReviewRating = val;
        $("reviewRatingInput").value = val;
        $("starPicker").querySelectorAll(".star-btn").forEach((btn) => {
            const num = Number(btn.dataset.val);
            btn.classList.toggle("active", num <= val);
        });
    }

    async function submitReview(event) {
        event.preventDefault();
        const orderId = $("reviewOrderId").value;
        const rating = Number($("reviewRatingInput").value) || 5;
        const comment = $("reviewComment").value.trim();

        try {
            const res = await apiFetch("/user/reviews", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ orderId, rating, comment }),
            });
            const data = await readResponse(res);
            if (!res.ok) {
                $("reviewFormMessage").textContent = responseMessage(data, "Помилка збереження відгуку");
                return;
            }
            showToast(t("reviewSaved"), "success");
            $("reviewModal").hidden = true;
            await loadUserReviews();
            await loadUserOrders();
            await loadCatalog(false);
        } catch (err) {
            $("reviewFormMessage").textContent = err.message;
        }
    }

    function renderUserOrders() {
        const body = $("userOrdersBody");
        const tableWrap = $("userOrdersTableWrap");
        const calWrap = $("userOrdersCalendarWrap");
        if (!currentUser || userOrdersState === "signedOut") {
            body.innerHTML = emptyRow(6, t("signInOrders"));
            return;
        }
        if (userOrdersState === "loading") {
            body.innerHTML = emptyRow(6, t("loading"));
            return;
        }
        if (userOrdersState === "error") {
            body.innerHTML = emptyRow(6, userOrdersError || t("loadOrdersFail"));
            return;
        }

        const filtered = filterOrders(userOrders, searchQueries.user, statusFilters.user);

        if (viewModes.user === "calendar") {
            if (tableWrap) tableWrap.hidden = true;
            if (calWrap) calWrap.hidden = false;
            renderCalendar("user", filtered);
            return;
        }

        if (tableWrap) tableWrap.hidden = false;
        if (calWrap) calWrap.hidden = true;

        body.innerHTML = filtered.length ? filtered.map((order) => {
            const client = orderClientParts(order);
            const actions = [];
            if (order.status === "pending") actions.push(`<button data-user-edit="${escapeHtml(order.id)}">${escapeHtml(t("edit"))}</button>`);
            if (order.status === "pending" || order.status === "confirmed") actions.push(`<button data-user-cancel="${escapeHtml(order.id)}">${escapeHtml(t("cancelAction"))}</button>`);
            if (order.status === "done") {
                const reviewed = userReviewsMap[order.id];
                if (reviewed) {
                    actions.push(`<span class="reviewed-badge">★ ${reviewed.rating}</span>`);
                } else {
                    actions.push(`<button class="review-btn" data-user-review="${escapeHtml(order.id)}">⭐ ${escapeHtml(t("leaveReview"))}</button>`);
                }
            }
            const actionCell = actions.length ? `<div class="modal-row-actions">${actions.join("")}</div>` : "—";
            return `<tr><td>${escapeHtml(client.name)}<small class="table-subtext">${escapeHtml(client.contact)}</small></td><td>${escapeHtml(catalogName("masters", order.masterId))}</td><td>${escapeHtml(catalogName("services", order.serviceId))}</td><td>${escapeHtml(formatWhen(order.scheduledAt, true))}</td><td><span class="status-badge ${statusClass(order.status)}">${escapeHtml(statusText(order.status))}</span></td><td>${actionCell}</td></tr>`;
        }).join("") : emptyRow(6, userOrders.length ? t("noMatchingOrders") : t("noUserOrders"));

        body.querySelectorAll("[data-user-edit]").forEach((button) => button.addEventListener("click", () => {
            const order = userOrders.find((item) => item.id === button.dataset.userEdit);
            if (order) openOrderForm(order);
        }));
        body.querySelectorAll("[data-user-cancel]").forEach((button) => button.addEventListener("click", () => deleteOrder(button.dataset.userCancel)));
        body.querySelectorAll("[data-user-review]").forEach((button) => button.addEventListener("click", () => {
            const order = userOrders.find((item) => item.id === button.dataset.userReview);
            if (order) openReviewModal(order);
        }));
    }

    async function loadUserOrders() {
        if (!currentUser) {
            userOrders = [];
            userOrdersState = "signedOut";
            renderUserOrders();
            return;
        }
        try {
            await loadCatalog(false);
            await loadUserReviews();
            userOrdersState = "loading";
            renderUserOrders();
            const response = await apiFetch("/user/orders");
            const data = await readResponse(response);
            if (!response.ok) {
                userOrdersState = "error";
                userOrdersError = responseMessage(data, t("loadOrdersFail"));
                renderUserOrders();
                return;
            }
            userOrders = Array.isArray(data) ? data : [];
            userOrdersState = "ready";
            userOrdersError = "";
            renderUserOrders();
        } catch (error) {
            userOrdersState = "error";
            userOrdersError = t("serviceDown");
            renderUserOrders();
        }
    }

    function toggleMenu(open) {
        const sidebar = $("sidebar");
        const burgerToggle = $("burgerToggle");
        if (!sidebar) return;
        const isOpen = open !== undefined ? open : !sidebar.classList.contains("open");
        sidebar.classList.toggle("open", isOpen);
        if (burgerToggle) burgerToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    }

    function setRoute(route) {
        toggleMenu(false);
        const admin = currentUser?.role === "admin";
        const normalized = route || "dashboard";
        if (["data", "users", "admin-orders", "operations", "audit"].includes(normalized) && !admin) {
            window.location.hash = "dashboard";
            return;
        }
        document.querySelectorAll("[data-view]").forEach((view) => {
            const viewName = view.dataset.view;
            const isOrders = normalized === "orders";
            view.hidden = viewName === "dashboard" ? normalized !== "dashboard"
                : viewName === "orders" ? !isOrders || admin
                    : viewName === "admin-orders" ? !isOrders || !admin
                        : viewName === "data" ? normalized !== "data" || !admin
                            : viewName === "users" ? normalized !== "users" || !admin
                                : viewName === "audit" ? normalized !== "audit" || !admin
                                    : viewName === "operations" ? normalized !== "operations" || (view.classList.contains("admin-only") && !admin)
                                        : normalized !== viewName;
        });
        document.querySelectorAll(".nav-item, .dock-item[href]").forEach((item) => {
            item.classList.toggle("active", item.getAttribute("href") === `#${normalized}`);
        });
        updateBreadcrumb();
        if (normalized === "orders") {
            if (admin) loadAdminOrders();
            else loadUserOrders();
        } else if (normalized === "catalog") {
            if (currentUser) loadCatalog();
            else {
                showToast(t("signInCatalog"), "error");
                openLoginModal();
            }
        } else if (normalized === "data" && admin) {
            loadCatalog(true);
        } else if (normalized === "users" && admin) {
            loadUsers();
        } else if (normalized === "audit" && admin) {
            loadAuditLogs();
        }
    }

    function shortOrderId(id) {
        return String(id || "").length > 14 ? `${String(id).slice(0, 10)}…` : String(id || "");
    }

    // --- Audit Log Loader & Renderer ---
    async function loadAuditLogs() {
        if (currentUser?.role !== "admin") return;
        const body = $("auditBody");
        if (!body) return;
        body.innerHTML = emptyRow(4, t("loading"));
        try {
            const res = await apiFetch("/admin/audit");
            const list = await readResponse(res);
            if (!res.ok) throw new Error(responseMessage(list, "Помилка завантаження журналу"));
            auditLogs = Array.isArray(list) ? list : [];
            renderAuditLogs();
        } catch (err) {
            body.innerHTML = emptyRow(4, err.message);
        }
    }

    function renderAuditLogs() {
        const body = $("auditBody");
        if (!body) return;
        if (!auditLogs.length) {
            body.innerHTML = emptyRow(4, t("noAuditLogs"));
            return;
        }
        body.innerHTML = auditLogs.map((log) => {
            let badgeClass = "badge-order";
            if (log.action.includes("STATUS")) badgeClass = "badge-status";
            else if (log.action.includes("ROLE")) badgeClass = "badge-role";
            else if (log.action.includes("USER")) badgeClass = "badge-user";
            else if (log.action.includes("REVIEW")) badgeClass = "badge-review";
            else if (log.action.includes("DELETE") || log.action.includes("CANCEL")) badgeClass = "badge-danger";

            const userText = log.userEmail || log.userId || "—";
            const when = formatWhen(log.timestamp, true);
            return `<tr>
                <td><small class="table-subtext">${escapeHtml(when)}</small></td>
                <td><strong>${escapeHtml(userText)}</strong></td>
                <td><span class="audit-badge ${badgeClass}">${escapeHtml(log.action)}</span></td>
                <td>${escapeHtml(log.details)}</td>
            </tr>`;
        }).join("");
    }

    async function runCreate() {
        await loadOrders();
    }
    async function runResource(method) {
        await loadOrders();
    }
    async function runBadCreate() {}
    async function runBadRead() {}

    function renderAdminOrders() {
        if (currentUser?.role !== "admin" || adminOrdersState === "idle") return;
        const body = $("adminOrdersBody");
        const tableWrap = $("adminOrdersTableWrap");
        const calWrap = $("adminOrdersCalendarWrap");
        if (adminOrdersState === "loading") {
            body.innerHTML = emptyRow(7, t("loading"));
            return;
        }
        if (adminOrdersState === "error") {
            $("adminOrdersMessage").textContent = adminOrdersError || t("loadOrdersFail");
            return;
        }

        const filtered = filterOrders(adminOrders, searchQueries.admin, statusFilters.admin);

        if (viewModes.admin === "calendar") {
            if (tableWrap) tableWrap.hidden = true;
            if (calWrap) calWrap.hidden = false;
            renderCalendar("admin", filtered);
            return;
        }

        if (tableWrap) tableWrap.hidden = false;
        if (calWrap) calWrap.hidden = true;

        body.innerHTML = filtered.length ? filtered.map((order) => {
            const client = orderClientParts(order);
            return `<tr><td class="order-id" title="${escapeHtml(order.id)}">#${escapeHtml(shortOrderId(order.id))}</td><td>${escapeHtml(client.name)}<small class="table-subtext">${escapeHtml(client.contact)}</small></td><td>${escapeHtml(catalogName("masters", order.masterId))}</td><td>${escapeHtml(catalogName("services", order.serviceId))}</td><td>${escapeHtml(formatWhen(order.scheduledAt, true))}</td><td><span class="status-badge ${statusClass(order.status)}">${escapeHtml(statusText(order.status))}</span></td><td><div class="modal-row-actions"><button data-admin-edit="${escapeHtml(order.id)}">${escapeHtml(t("edit"))}</button><button data-admin-delete="${escapeHtml(order.id)}">${escapeHtml(t("delete"))}</button></div></td></tr>`;
        }).join("") : emptyRow(7, adminOrders.length ? t("noMatchingOrders") : t("ordersNone"));

        body.querySelectorAll("[data-admin-edit]").forEach((button) => button.addEventListener("click", () => {
            const order = adminOrders.find((item) => item.id === button.dataset.adminEdit);
            if (order) openOrderForm(order);
        }));
        body.querySelectorAll("[data-admin-delete]").forEach((button) => button.addEventListener("click", () => deleteOrder(button.dataset.adminDelete)));
    }

    async function loadAdminOrders() {
        if (currentUser?.role !== "admin") return;
        adminOrdersState = "loading";
        renderAdminOrders();
        await loadCatalog(true);
        const response = await apiFetch("/admin/orders");
        const data = await readResponse(response);
        if (!response.ok) {
            adminOrdersState = "error";
            adminOrdersError = responseMessage(data, t("loadOrdersFail"));
            renderAdminOrders();
            return;
        }
        adminOrders = Array.isArray(data) ? data : [];
        adminOrdersState = "ready";
        adminOrdersError = "";
        $("adminOrdersMessage").textContent = "";
        renderAdminOrders();
    }

    async function openOrderForm(order = null) {
        if (!currentUser) { openLoginModal(); return; }
        const isAdmin = currentUser.role === "admin";
        await loadCatalog(isAdmin);
        const client = orderClientParts(order || {});
        $("modalOrderId").value = order?.id || "";
        $("modalClientName").value = client.name;
        $("modalClientContact").value = client.contact;
        $("modalMasterId").value = order?.masterId || "";
        $("modalServiceId").value = order?.serviceId || "";
        $("modalScheduledAt").value = localDateTime(order?.scheduledAt);
        const showStatus = isAdmin && Boolean(order);
        fillStatusSelect(order?.status || "pending");
        $("modalStatus").previousElementSibling.style.display = showStatus ? "" : "none";
        $("modalStatus").style.display = showStatus ? "" : "none";
        fillSelect("modalMasterId", catalog.masters, order?.masterId);
        fillSelect("modalServiceId", catalog.services, order?.serviceId);
        $("orderFormTitle").textContent = order ? t("editOrder") : t("newOrder");
        $("orderFormMessage").textContent = "";
        setFieldError("modalClientContact", "");
        $("orderFormModal").hidden = false;
        $("modalClientName").focus();
    }

    async function submitOrderForm(event) {
        event.preventDefault();
        const id = $("modalOrderId").value;
        const scheduled = new Date($("modalScheduledAt").value);
        if (Number.isNaN(scheduled.getTime())) {
            showToast(t("badDateTime"), "error");
            return;
        }
        const contactPhone = normalizePhone($("modalClientContact").value);
        $("modalClientContact").value = contactPhone;
        if (!validPhone(contactPhone)) {
            setFieldError("modalClientContact", t("phoneInvalid"));
            $("modalClientContact").focus();
            return;
        }
        setFieldError("modalClientContact", "");
        const payload = {
            clientId: $("modalClientName").value.trim(),
            contactPhone,
            masterId: $("modalMasterId").value.trim(),
            serviceId: $("modalServiceId").value.trim(),
            scheduledAt: scheduled.toISOString(),
        };
        const isAdmin = currentUser?.role === "admin";
        if (isAdmin && id) payload.status = $("modalStatus").value;
        const endpoint = isAdmin
            ? `/admin/orders${id ? `/${encodeURIComponent(id)}` : ""}`
            : `/user/orders${id ? `/${encodeURIComponent(id)}` : ""}`;
        const options = {
            method: id ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        };
        if (!id) options.headers["Idempotency-Key"] = `order-${Date.now()}`;
        const response = await apiFetch(endpoint, options);
        const data = await readResponse(response);
        if (!response.ok) {
            const errorText = responseMessage(data, t("saveOrderFail"));
            if (data?.code === "INVALID_CONTACT_PHONE") setFieldError("modalClientContact", errorText);
            $("orderFormMessage").textContent = errorText;
            showToast(errorText, "error");
            return;
        }
        $("orderFormModal").hidden = true;
        showToast(id ? t("orderUpdated") : t("orderCreated"));
        await loadOrders();
        await loadAdminOrders();
        await loadUserOrders();
    }

    async function deleteOrder(id) {
        const isAdmin = currentUser?.role === "admin";
        const message = isAdmin ? t("deleteConfirm") : t("cancelConfirm");
        if (!confirm(message)) return;
        const endpoint = isAdmin ? `/admin/orders/${encodeURIComponent(id)}` : `/user/orders/${encodeURIComponent(id)}`;
        const response = await apiFetch(endpoint, { method: "DELETE" });
        const data = await readResponse(response);
        if (!response.ok) {
            showToast(responseMessage(data, t("deleteOrderFail")), "error");
            return;
        }
        showToast(isAdmin ? t("orderDeleted") : t("orderCancelled"));
        await loadOrders();
        await loadAdminOrders();
        await loadUserOrders();
    }

    function updateAccountUi() {
        const accountButton = $("accountButton");
        if (!accountButton) return;
        document.querySelectorAll(".admin-only:not([data-view])").forEach((element) => {
            element.hidden = !currentUser || currentUser.role !== "admin";
        });
        if (!currentUser) {
            accountButton.textContent = t("signIn");
            accountButton.classList.remove("signed-in");
            $("accountMenu").hidden = true;
            return;
        }
        accountButton.textContent = currentUser.displayName || currentUser.email;
        accountButton.classList.add("signed-in");
        $("accountName").textContent = currentUser.displayName;
        $("accountRole").textContent = currentUser.role === "admin" ? t("admin") : t("user");
    }

    async function loadCurrentUser() {
        try {
            const response = await apiFetch("/auth/me");
            currentUser = response.ok ? await readResponse(response) : null;
        } catch {
            currentUser = null;
        }
        updateAccountUi();
    }

    function openLoginModal() {
        $("loginMessage").textContent = "";
        setFieldError("loginEmail", "");
        setFieldError("loginPassword", "");
        $("loginOverlay").hidden = false;
        $("loginEmail").focus();
    }

    async function login(event) {
        event.preventDefault();
        const message = $("loginMessage");
        const button = $("loginSubmit");
        setFieldError("loginEmail", "");
        setFieldError("loginPassword", "");
        const email = $("loginEmail").value.trim();
        const password = $("loginPassword").value;
        if (!validEmail(email)) {
            setFieldError("loginEmail", t("emailInvalid"));
            $("loginEmail").focus();
            return;
        }
        if (!password) {
            setFieldError("loginPassword", t("passwordRequired"));
            $("loginPassword").focus();
            return;
        }
        button.disabled = true;
        button.textContent = t("signingIn");
        message.textContent = "";
        try {
            const response = await apiFetch("/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });
            const data = await readResponse(response);
            if (!response.ok) {
                message.textContent = responseMessage(data, t("loginFail"));
                if (data?.code === "INVALID_CREDENTIALS") {
                    setFieldError("loginEmail", t("invalidCredentials"));
                    setFieldError("loginPassword", t("invalidCredentials"));
                }
                showToast(message.textContent, "error");
                return;
            }
            currentUser = data;
            localStorage.setItem("masterhub-last-email", email);
            updateAccountUi();
            $("loginOverlay").hidden = true;
            showToast(t("loginSuccess"));
            setRoute(window.location.hash.slice(1) || "dashboard");
            await loadOrders();
            await loadUserOrders();
            if (currentUser.role === "admin") {
                await loadAdminOrders();
                await loadUsers();
            }
        } catch (error) {
            message.textContent = t("serviceDown");
            showToast(message.textContent, "error");
        } finally {
            button.disabled = false;
            button.textContent = t("login");
        }
    }

    async function logout() {
        try {
            await apiFetch("/auth/logout", { method: "POST" });
        } finally {
            currentUser = null;
            updateAccountUi();
            $("accountMenu").hidden = true;
            showToast(t("loggedOut"));
            setRoute("dashboard");
            await loadOrders();
            await loadUserOrders();
        }
    }

    function renderUsers() {
        if (currentUser?.role !== "admin" || usersState === "idle") return;
        const body = $("usersBody");
        if (usersState === "loading") {
            body.innerHTML = emptyRow(5, t("loadingUsers"));
            return;
        }
        if (usersState === "error") {
            body.innerHTML = emptyRow(5, usersError || t("loadUsersFail"));
            return;
        }
        body.innerHTML = users.length ? users.map((user) => {
            const isSelf = currentUser && user.id === currentUser.id;
            const roleSelect = isSelf
                ? `<span class="status-badge status-confirmed">${escapeHtml(t(user.role))}</span>`
                : `<select data-role-select="${escapeHtml(user.id)}"><option value="user" ${user.role === "user" ? "selected" : ""}>${escapeHtml(t("user"))}</option><option value="admin" ${user.role === "admin" ? "selected" : ""}>${escapeHtml(t("admin"))}</option></select>`;
            const deleteBtn = isSelf
                ? `<small class="table-subtext">${escapeHtml(t("currentAccount"))}</small>`
                : `<button class="danger-button text-button" data-delete-user="${escapeHtml(user.id)}">${escapeHtml(t("deleteAccount"))}</button>`;
            return `<tr><td>${escapeHtml(user.displayName)}</td><td>${escapeHtml(user.email)}</td><td>${escapeHtml(t(user.role))}</td><td>${roleSelect}</td><td>${deleteBtn}</td></tr>`;
        }).join("") : emptyRow(5, t("noUsers"));
        body.querySelectorAll("[data-role-select]").forEach((select) => select.addEventListener("change", (event) => changeUserRole(select.dataset.roleSelect, event.target.value)));
        body.querySelectorAll("[data-delete-user]").forEach((button) => button.addEventListener("click", () => deleteUser(button.dataset.deleteUser)));
    }

    async function loadUsers() {
        if (currentUser?.role !== "admin") return;
        usersState = "loading";
        renderUsers();
        try {
            const response = await apiFetch("/admin/users");
            const data = await readResponse(response);
            if (!response.ok) {
                usersState = "error";
                usersError = responseMessage(data, t("loadUsersFail"));
                renderUsers();
                return;
            }
            users = Array.isArray(data) ? data : [];
            usersState = "ready";
            usersError = "";
            renderUsers();
        } catch (error) {
            usersState = "error";
            usersError = t("serviceDown");
            renderUsers();
        }
    }

    async function changeUserRole(userId, newRole) {
        const response = await apiFetch(`/admin/users/${encodeURIComponent(userId)}/role`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: newRole }),
        });
        const data = await readResponse(response);
        if (!response.ok) {
            showToast(responseMessage(data, t("changeRoleFail")), "error");
            await loadUsers();
            return;
        }
        showToast(t("roleUpdated"));
        await loadUsers();
    }

    async function deleteUser(userId) {
        if (!confirm(t("deleteUserConfirm"))) return;
        const response = await apiFetch(`/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
        const data = await readResponse(response);
        if (!response.ok) {
            showToast(responseMessage(data, t("deleteUserFail")), "error");
            return;
        }
        showToast(t("userDeleted"));
        await loadUsers();
    }

    async function loadCatalog(adminView = false) {
        const response = await apiFetch(adminView ? "/admin/catalog/masters" : "/user/catalog");
        const payload = await readResponse(response);
        if (!response.ok) {
            showToast(responseMessage(payload, t("loadCatalogFail")), "error");
            return;
        }
        if (adminView) {
            catalog.masters = payload;
            const servicesResponse = await apiFetch("/admin/catalog/services");
            const services = await readResponse(servicesResponse);
            if (!servicesResponse.ok) {
                showToast(responseMessage(services, t("loadServicesFail")), "error");
                return;
            }
            catalog.services = services;
        } else {
            catalog = payload;
            if (payload?.reviewsSummary) {
                masterReviewsSummary = payload.reviewsSummary;
            }
        }
        // Also fetch reviews summary if empty
        if (!Object.keys(masterReviewsSummary).length) {
            try {
                const revRes = await apiFetch("/reviews");
                if (revRes.ok) {
                    const revData = await readResponse(revRes);
                    if (revData?.summary) masterReviewsSummary = revData.summary;
                }
            } catch {}
        }
        catalogLoaded = true;
        if ($("modalMasterId")) fillSelect("modalMasterId", catalog.masters);
        if ($("modalServiceId")) fillSelect("modalServiceId", catalog.services);
        renderCatalogLists(adminView);
    }

    function renderCatalogLists(adminView) {
        if (!$("userMastersList")) return;
        $("userMastersList").innerHTML = catalog.masters.filter((item) => item.active !== false).map((item) => {
            const rev = masterReviewsSummary[item.id];
            const ratingBadge = rev && rev.count > 0
                ? `<span class="master-rating-badge">★ ${rev.avgRating} (${rev.count})</span>`
                : "";
            return `<article class="catalog-item">
                <div>
                    <strong>${escapeHtml(tCatalog(item.name))}</strong>
                    ${ratingBadge}
                </div>
                <small>${escapeHtml(tCatalog(item.specialty) || t("noSpecialty"))}</small>
            </article>`;
        }).join("") || `<p class="empty-state">${escapeHtml(t("noMasters"))}</p>`;

        $("userServicesList").innerHTML = catalog.services.filter((item) => item.active !== false).map((item) =>
            `<article class="catalog-item"><strong>${escapeHtml(tCatalog(item.name))}</strong><small>${escapeHtml(tCatalog(item.description) || t("noDescription"))}</small></article>`
        ).join("") || `<p class="empty-state">${escapeHtml(t("noServices"))}</p>`;

        if (!adminView) return;
        $("adminMastersList").innerHTML = catalog.masters.map((item) => {
            const rev = masterReviewsSummary[item.id];
            const ratingBadge = rev && rev.count > 0
                ? `<span class="master-rating-badge">★ ${rev.avgRating} (${rev.count})</span>`
                : "";
            return `<article class="catalog-item ${item.active ? "" : "inactive"}">
                <div>
                    <strong>${escapeHtml(tCatalog(item.name))}</strong>
                    ${ratingBadge}
                    <small>${escapeHtml(tCatalog(item.specialty) || t("noSpecialty"))}${item.active ? "" : ` · ${escapeHtml(t("archived"))}`}</small>
                </div>
                <div class="modal-row-actions">
                    <button data-master-edit="${escapeHtml(item.id)}">${escapeHtml(t("edit"))}</button>
                    ${item.active ? `<button data-master-delete="${escapeHtml(item.id)}">${escapeHtml(t("archive"))}</button>` : `<button data-master-restore="${escapeHtml(item.id)}">${escapeHtml(t("restore"))}</button>`}
                </div>
            </article>`;
        }).join("");

        $("adminServicesList").innerHTML = catalog.services.map((item) =>
            `<article class="catalog-item ${item.active ? "" : "inactive"}"><div><strong>${escapeHtml(tCatalog(item.name))}</strong><small>${escapeHtml(tCatalog(item.description) || t("noDescription"))}${item.active ? "" : ` · ${escapeHtml(t("archivedFem"))}`}</small></div><div class="modal-row-actions"><button data-service-edit="${escapeHtml(item.id)}">${escapeHtml(t("edit"))}</button>${item.active ? `<button data-service-delete="${escapeHtml(item.id)}">${escapeHtml(t("archive"))}</button>` : `<button data-service-restore="${escapeHtml(item.id)}">${escapeHtml(t("restore"))}</button>`}</div></article>`
        ).join("");

        $("adminMastersList").querySelectorAll("[data-master-edit]").forEach((button) => button.addEventListener("click", () => {
            const item = catalog.masters.find((entry) => entry.id === button.dataset.masterEdit);
            $("masterCatalogId").value = item.id;
            $("masterCatalogName").value = item.name;
            $("masterCatalogSpecialty").value = item.specialty;
            $("masterFormTitle").textContent = t("editMaster");
        }));
        $("adminServicesList").querySelectorAll("[data-service-edit]").forEach((button) => button.addEventListener("click", () => {
            const item = catalog.services.find((entry) => entry.id === button.dataset.serviceEdit);
            $("serviceCatalogId").value = item.id;
            $("serviceCatalogName").value = item.name;
            $("serviceCatalogDescription").value = item.description;
            $("serviceFormTitle").textContent = t("editService");
        }));
        $("adminMastersList").querySelectorAll("[data-master-delete]").forEach((button) => button.addEventListener("click", () => archiveCatalogItem("masters", button.dataset.masterDelete)));
        $("adminServicesList").querySelectorAll("[data-service-delete]").forEach((button) => button.addEventListener("click", () => archiveCatalogItem("services", button.dataset.serviceDelete)));
        $("adminMastersList").querySelectorAll("[data-master-restore]").forEach((button) => button.addEventListener("click", () => restoreCatalogItem("masters", button.dataset.masterRestore)));
        $("adminServicesList").querySelectorAll("[data-service-restore]").forEach((button) => button.addEventListener("click", () => restoreCatalogItem("services", button.dataset.serviceRestore)));
    }

    async function submitCatalogForm(kind, event) {
        event.preventDefault();
        const isMaster = kind === "masters";
        const id = $(isMaster ? "masterCatalogId" : "serviceCatalogId").value;
        const name = $(isMaster ? "masterCatalogName" : "serviceCatalogName").value.trim();
        const extraKey = isMaster ? "specialty" : "description";
        const extra = $(isMaster ? "masterCatalogSpecialty" : "serviceCatalogDescription").value.trim();
        const response = await apiFetch(`/admin/catalog/${kind}${id ? `/${encodeURIComponent(id)}` : ""}`, {
            method: id ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, [extraKey]: extra }),
        });
        const data = await readResponse(response);
        if (!response.ok) {
            $("catalogMessage").textContent = responseMessage(data, t("saveFail"));
            showToast($("catalogMessage").textContent, "error");
            return;
        }
        $(isMaster ? "masterFormReset" : "serviceFormReset").click();
        await loadCatalog(true);
        showToast(isMaster ? t("masterSaved") : t("serviceSaved"));
    }

    async function archiveCatalogItem(kind, id) {
        if (!confirm(t("archiveConfirm"))) return;
        const response = await apiFetch(`/admin/catalog/${kind}/${encodeURIComponent(id)}`, { method: "DELETE" });
        const data = await readResponse(response);
        if (!response.ok) {
            showToast(responseMessage(data, t("archiveFail")), "error");
            return;
        }
        await loadCatalog(true);
        showToast(t("archivedToast"));
    }

    async function restoreCatalogItem(kind, id) {
        const response = await apiFetch(`/admin/catalog/${kind}/${encodeURIComponent(id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: true }),
        });
        const data = await readResponse(response);
        if (!response.ok) {
            showToast(responseMessage(data, t("restoreFail")), "error");
            return;
        }
        await loadCatalog(true);
        showToast(t("restoredToast"));
    }

    function applyRegistrationError(data, message) {
        if (data?.code === "USER_EXISTS") {
            setFieldError("registerEmail", t("userExists"));
            return;
        }
        const details = String(data?.details || "");
        if (details.includes("email")) setFieldError("registerEmail", t("emailInvalid"));
        else if (details.includes("Ім'я") || details.toLowerCase().includes("name")) setFieldError("registerName", t("nameLength"));
        else if (details.includes("Пароль") || details.toLowerCase().includes("password")) setFieldError("registerPassword", t("passwordLength"));
        else message.textContent = message.textContent || t("registerFail");
    }

    async function register(event) {
        event.preventDefault();
        const message = $("registerMessage");
        const button = $("registerSubmit");
        setFieldError("registerName", "");
        ["registerEmail", "registerPassword", "registerPasswordConfirm"].forEach((id) => setFieldError(id, ""));
        const displayName = $("registerName").value.trim();
        const email = $("registerEmail").value.trim();
        const password = $("registerPassword").value;
        const confirmation = $("registerPasswordConfirm").value;
        if (displayName.length < 2 || displayName.length > 80) {
            setFieldError("registerName", t("nameLength"));
            $("registerName").focus();
            return;
        }
        if (!validEmail(email)) {
            setFieldError("registerEmail", t("emailInvalid"));
            $("registerEmail").focus();
            return;
        }
        if (password.length < 8) {
            setFieldError("registerPassword", t("passwordLength"));
            $("registerPassword").focus();
            return;
        }
        if (password !== confirmation) {
            setFieldError("registerPasswordConfirm", t("passwordMismatch"));
            $("registerPasswordConfirm").focus();
            return;
        }
        button.disabled = true;
        button.textContent = t("creating");
        message.textContent = "";
        try {
            const response = await apiFetch("/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ displayName, email, password }),
            });
            const data = await readResponse(response);
            if (!response.ok) {
                message.textContent = responseMessage(data, t("registerFail"));
                if (data?.code === "INVALID_REGISTRATION" || data?.code === "USER_EXISTS") applyRegistrationError(data, message);
                showToast(message.textContent, "error");
                return;
            }
            $("registerForm").reset();
            $("registerOverlay").hidden = true;
            openLoginModal();
            $("loginEmail").value = data.email;
            localStorage.setItem("masterhub-last-email", data.email);
            $("loginMessage").textContent = t("accountCreatedLogin");
            showToast(t("accountCreated"));
        } catch (error) {
            message.textContent = t("serviceDown");
            showToast(message.textContent, "error");
        } finally {
            button.disabled = false;
            button.textContent = t("register");
        }
    }

    function bind() {
        setLanguage(language);
        const rememberedEmail = localStorage.getItem("masterhub-last-email");
        if (rememberedEmail && $("loginEmail")) $("loginEmail").value = rememberedEmail;
        $("languageSelect").addEventListener("change", (event) => setLanguage(event.target.value));
        const themeToggle = $("themeToggle");
        themeToggle.addEventListener("click", () => {
            const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
            document.documentElement.dataset.theme = next;
            localStorage.setItem("masterhub-theme", next);
            updateThemeButton();
        });
        $("accountButton").addEventListener("click", () => {
            if (currentUser) $("accountMenu").hidden = !$("accountMenu").hidden;
            else openLoginModal();
        });
        $("loginForm").addEventListener("submit", login);
        $("loginClose").addEventListener("click", () => { $("loginOverlay").hidden = true; });
        $("registerOpen").addEventListener("click", () => { $("loginOverlay").hidden = true; $("registerOverlay").hidden = false; });
        $("registerForm").addEventListener("submit", register);
        $("registerClose").addEventListener("click", () => { $("registerOverlay").hidden = true; });
        $("logoutButton").addEventListener("click", logout);
        $("orderForm").addEventListener("submit", submitOrderForm);
        $("orderFormClose").addEventListener("click", () => { $("orderFormModal").hidden = true; });
        $("orderFormCancel").addEventListener("click", () => { $("orderFormModal").hidden = true; });
        window.doCreate = runCreate;
        window.doList = loadOrders;
        window.doRead = () => runResource("GET");
        window.doUpdate = () => runResource("PUT");
        window.doDelete = () => runResource("DELETE");
        window.doBadCreate = runBadCreate;
        window.doBadRead = runBadRead;
        $("refreshButton").addEventListener("click", () => { loadHealth(); loadOrders(); });
        $("dockRefresh")?.addEventListener("click", () => { loadHealth(); loadOrders(); });
        $("loadOrdersButton")?.addEventListener("click", loadOrders);
        $("operationsRefresh")?.addEventListener("click", loadHealth);

        // --- Search & Filter Listeners ---
        $("dashboardSearchInput")?.addEventListener("input", (e) => {
            searchQueries.dashboard = e.target.value;
            renderOrders();
        });
        $("dashboardStatusFilter")?.addEventListener("change", (e) => {
            statusFilters.dashboard = e.target.value;
            renderOrders();
        });
        $("userOrdersSearchInput")?.addEventListener("input", (e) => {
            searchQueries.user = e.target.value;
            renderUserOrders();
        });
        $("userOrdersStatusFilter")?.addEventListener("change", (e) => {
            statusFilters.user = e.target.value;
            renderUserOrders();
        });
        $("adminOrdersSearchInput")?.addEventListener("input", (e) => {
            searchQueries.admin = e.target.value;
            renderAdminOrders();
        });
        $("adminOrdersStatusFilter")?.addEventListener("change", (e) => {
            statusFilters.admin = e.target.value;
            renderAdminOrders();
        });

        // --- Segmented Table/Calendar Toggle Listeners ---
        $("userViewTableBtn")?.addEventListener("click", () => {
            viewModes.user = "table";
            $("userViewTableBtn").classList.add("active");
            $("userViewCalBtn").classList.remove("active");
            renderUserOrders();
        });
        $("userViewCalBtn")?.addEventListener("click", () => {
            viewModes.user = "calendar";
            $("userViewCalBtn").classList.add("active");
            $("userViewTableBtn").classList.remove("active");
            renderUserOrders();
        });
        $("adminViewTableBtn")?.addEventListener("click", () => {
            viewModes.admin = "table";
            $("adminViewTableBtn").classList.add("active");
            $("adminViewCalBtn").classList.remove("active");
            renderAdminOrders();
        });
        $("adminViewCalBtn")?.addEventListener("click", () => {
            viewModes.admin = "calendar";
            $("adminViewCalBtn").classList.add("active");
            $("adminViewTableBtn").classList.remove("active");
            renderAdminOrders();
        });

        // --- Calendar Navigation Listeners ---
        $("userCalPrev")?.addEventListener("click", () => {
            calendarDates.user = new Date(calendarDates.user.getFullYear(), calendarDates.user.getMonth() - 1, 1);
            renderUserOrders();
        });
        $("userCalNext")?.addEventListener("click", () => {
            calendarDates.user = new Date(calendarDates.user.getFullYear(), calendarDates.user.getMonth() + 1, 1);
            renderUserOrders();
        });
        $("userCalToday")?.addEventListener("click", () => {
            calendarDates.user = new Date();
            renderUserOrders();
        });
        $("adminCalPrev")?.addEventListener("click", () => {
            calendarDates.admin = new Date(calendarDates.admin.getFullYear(), calendarDates.admin.getMonth() - 1, 1);
            renderAdminOrders();
        });
        $("adminCalNext")?.addEventListener("click", () => {
            calendarDates.admin = new Date(calendarDates.admin.getFullYear(), calendarDates.admin.getMonth() + 1, 1);
            renderAdminOrders();
        });
        $("adminCalToday")?.addEventListener("click", () => {
            calendarDates.admin = new Date();
            renderAdminOrders();
        });

        // --- Review Modal Listeners ---
        $("reviewForm")?.addEventListener("submit", submitReview);
        $("reviewClose")?.addEventListener("click", () => { $("reviewModal").hidden = true; });
        $("reviewCancelBtn")?.addEventListener("click", () => { $("reviewModal").hidden = true; });
        $("starPicker")?.querySelectorAll(".star-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                updateStarPicker(Number(btn.dataset.val));
            });
        });

        // --- Audit Log Refresh ---
        $("adminRefreshAudit")?.addEventListener("click", loadAuditLogs);

        $("loadUsersButton")?.addEventListener("click", loadUsers);
        $("adminCreateOrder")?.addEventListener("click", () => openOrderForm());
        $("adminRefreshOrders")?.addEventListener("click", loadAdminOrders);
        $("masterCatalogForm")?.addEventListener("submit", (event) => submitCatalogForm("masters", event));
        $("serviceCatalogForm")?.addEventListener("submit", (event) => submitCatalogForm("services", event));
        $("masterFormReset")?.addEventListener("click", () => {
            $("masterCatalogForm").reset();
            $("masterCatalogId").value = "";
            $("masterFormTitle").textContent = t("newMaster");
        });
        $("serviceFormReset")?.addEventListener("click", () => {
            $("serviceCatalogForm").reset();
            $("serviceCatalogId").value = "";
            $("serviceFormTitle").textContent = t("newService");
        });
        const burgerToggle = $("burgerToggle");
        const burgerClose = $("burgerClose");
        const sidebarBackdrop = $("sidebarBackdrop");

        if (burgerToggle) burgerToggle.addEventListener("click", () => toggleMenu());
        if (burgerClose) burgerClose.addEventListener("click", () => toggleMenu(false));
        if (sidebarBackdrop) sidebarBackdrop.addEventListener("click", () => toggleMenu(false));

        document.querySelectorAll(".nav-item, .dock-item[href]").forEach((item) => {
            item.addEventListener("click", () => {
                const href = item.getAttribute("href");
                if (href?.startsWith("#")) setRoute(href.slice(1));
            });
        });
        window.addEventListener("hashchange", () => setRoute(window.location.hash.slice(1)));
        $("userCreateOrder")?.addEventListener("click", () => {
            if (!currentUser) {
                openLoginModal();
                return;
            }
            openOrderForm();
        });
        $("modalClientContact")?.addEventListener("input", () => {
            $("modalClientContact").value = normalizePhone($("modalClientContact").value);
            if (validPhone($("modalClientContact").value)) setFieldError("modalClientContact", "");
        });
        ["loginEmail", "loginPassword", "registerName", "registerEmail", "registerPassword", "registerPasswordConfirm"].forEach((id) => {
            $(id)?.addEventListener("input", () => setFieldError(id, ""));
        });
        loadHealth();
        loadCurrentUser().then(async () => {
            setRoute(window.location.hash.slice(1) || "dashboard");
            await loadOrders();
            await loadUsers();
            await loadUserOrders();
        });
    }
    document.addEventListener("DOMContentLoaded", bind);
}());
