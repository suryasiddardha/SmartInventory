
// ============================================================
// API HELPER
// ============================================================
const API = {
  token: localStorage.getItem("si_token") || null,

  headers() {
    return {
      "Content-Type": "application/json",
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  },

  async request(method, url, body = null) {
    const opts = { method, headers: this.headers() };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  },

  get(url) {
    return this.request("GET", url);
  },
  post(url, body) {
    return this.request("POST", url, body);
  },
  put(url, body) {
    return this.request("PUT", url, body);
  },
  delete(url) {
    return this.request("DELETE", url);
  },
  async download(url, filename) {
    const res = await fetch(url, {
      method: "GET",
      headers: this.token
        ? { Authorization: `Bearer ${this.token}` }
        : {},
    });
    if (!res.ok) {
      let message = "Download failed";
      try {
        const data = await res.json();
        message = data.error || message;
      } catch {
        // Ignore JSON parsing errors for binary responses.
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
  },
};

// ============================================================
// TOAST NOTIFICATION
// ============================================================
function showToast(message, type = "info") {
  const icons = { success: "✅", error: "❌", info: "💡" };
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || "💡"}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("toast-out");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ============================================================
// STATE
// ============================================================
let currentUser = null; // { id, username, role }
let supplierDirectory = [];
let selectedSupplierId = null;

function isAdmin() {
  return currentUser?.role === "admin";
}
function isManager() {
  return currentUser?.role === "manager";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCurrency(value, currency = "INR") {
  const amount = Number(value || 0);
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency || "INR",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `₹${amount.toFixed(2)}`;
  }
}

function formatDate(value) {
  if (!value) return "No data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function badgeClassForStatus(status) {
  if (["active", "completed", "in-stock", "success"].includes(status))
    return "success";
  if (
    [
      "critical",
      "out-of-stock",
      "inactive",
      "cancelled",
      "danger",
    ].includes(status)
  )
    return "danger";
  return "warning";
}

// ============================================================
// LOGIN
// ============================================================
document
  .getElementById("loginForm")
  .addEventListener("submit", async function (e) {
    e.preventDefault();
    const username = document.getElementById("username").value.trim();
    const role = document.getElementById("role").value.toLowerCase();
    const password = document.getElementById("password").value;
    const remember = document.getElementById("remember").checked;

    try {
      const data = await API.post("/api/auth/login", {
        username,
        password,
        role,
      });

      API.token = data.token;
      currentUser = data.user;

      if (remember) {
        localStorage.setItem("si_token", data.token);
      } else {
        localStorage.removeItem("si_token");
      }

      enterDashboard();
    } catch (err) {
      alert(err.message);
    }
  });

// ============================================================
// AUTO-LOGIN on page load (if token saved)
// ============================================================
window.addEventListener("load", async function () {
  const savedToken = localStorage.getItem("si_token");
  if (!savedToken) return;

  API.token = savedToken;
  try {
    const data = await API.get("/api/auth/me");
    currentUser = data.user;
    enterDashboard();
  } catch {
    // Token expired or invalid
    localStorage.removeItem("si_token");
    API.token = null;
  }
});

// ============================================================
// ENTER DASHBOARD
// ============================================================
function enterDashboard() {
  document.getElementById("loginPage").style.display = "none";
  document.getElementById("dashboard").classList.add("active");
  document.getElementById("userName").textContent = currentUser.username;
  document.getElementById("userRole").textContent = currentUser.role;
  document.getElementById("userAvatar").textContent = currentUser.username
    .charAt(0)
    .toUpperCase();

  applyRBAC(currentUser.role);
  if (isAdmin() || isManager()) {
    if (typeof loadSalesReport === "function") loadSalesReport();
    if (typeof loadDashboardSnapshot === "function") loadDashboardSnapshot();
  }
  loadDashboardAlerts();
  if (typeof window.loadPendingApprovals === "function") window.loadPendingApprovals();
  loadInventory();
  loadOrders();
  loadSuppliers();
  if (!isManager() && !isAdmin()) {
    const monitoringNav = document.querySelector(
      '[data-page="monitoring-page"]',
    );
    if (monitoringNav) monitoringNav.style.display = "none";
  } else {
    loadMonitoringOverview();
  }
  loadOrderInventoryOptions();
  loadItemFormSuppliers();
  if (isAdmin()) {
    loadEmployees();
  }
}

// ============================================================
// LOGOUT
// ============================================================
document
  .getElementById("logoutBtn")
  .addEventListener("click", function () {
    if (confirm("Logout?")) {
      localStorage.removeItem("si_token");
      API.token = null;
      currentUser = null;
      location.reload();
    }
  });

// ============================================================
// RBAC - hide UI elements based on role
// ============================================================
function applyRBAC(role) {
  const navItems = document.querySelectorAll(".nav-item");

  if (role !== "admin") {
    navItems.forEach((item) => {
      if (item.dataset.page === "employees-page")
        item.style.display = "none";
    });
  }

  if (role === "staff") {
    navItems.forEach((item) => {
      if (item.dataset.page === "monitoring-page")
        item.style.display = "none";
    });
  }

  if (role === "staff") {
    const hide = [
      "addInventoryItemBtn",
      "addSupplierBtn",
      "exportExcelBtn",
      "reportPanel",
      "inventoryFormSection",
    ];
    hide.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    });

    const titleEl = document.getElementById("dashboardTitle");
    if (titleEl) titleEl.textContent = "Alerts";

    const descEl = document.getElementById("dashboardDesc");
    if (descEl) descEl.textContent = "Review stock and expiry warnings.";
  } else {
    // Restore for non-staff just in case it's cached/reloaded without refresh
    const titleEl = document.getElementById("dashboardTitle");
    if (titleEl) titleEl.textContent = "Reports and Alerts";

    const descEl = document.getElementById("dashboardDesc");
    if (descEl) descEl.textContent = "Generate sales reports and review stock and expiry warnings.";
  }

  // Show supplier action column for admin & manager
  if (role === "admin" || role === "manager") {
    const actionsHeader = document.getElementById(
      "supplierActionsHeader",
    );
    if (actionsHeader) actionsHeader.style.display = "";
  }
}

// ============================================================
// DASHBOARD - dynamic alerts from API
// ============================================================
async function loadDashboardAlerts() {
  try {
    const { lowStock, expiring } = await API.get("/api/inventory/alerts");

    // Low stock table
    const lowTbody = document.getElementById("lowStockTableBody");
    if (lowTbody) {
      lowTbody.innerHTML =
        lowStock.length === 0
          ? '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">No low stock items 🎉</td></tr>'
          : lowStock
            .map(
              (i) => `
                  <tr>
                    <td>#INV-${String(i.id).padStart(3, "0")}</td>
                    <td>${i.product_name}</td>
                    <td>${i.stock}</td>
                  </tr>`,
            )
            .join("");
    }

    // Expiry table
    const expTbody = document.getElementById("expiryTableBody");
    if (expTbody) {
      expTbody.innerHTML =
        expiring.length === 0
          ? '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No items expiring soon 🎉</td></tr>'
          : expiring
            .map(
              (i) => `
                  <tr>
                    <td>#INV-${String(i.id).padStart(3, "0")}</td>
                    <td>${i.product_name}</td>
                    <td>${new Date(i.expiry_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                    <td>${i.stock}</td>
                  </tr>`,
            )
            .join("");
    }
  } catch (err) {
    console.error("Failed to load alerts:", err);
  }
}

// Removed analytics and reorder dashboard functions because these features are no longer exposed.
async function loadMonitoringOverview() {
  try {
    const data = await API.get("/api/monitoring/overview");
    const teamPerformance = data.teamPerformance || [];
    const recentActivity = data.recentActivity || [];

    const summary = teamPerformance.reduce(
      (acc, user) => {
        acc.teamMembers += 1;
        acc.ordersHandled += Number(user.ordersProcessed || 0);
        acc.inventoryUpdates += Number(user.inventoryUpdates || 0);
        acc.accuracyTotal += Number(user.accuracyRate || 0);
        return acc;
      },
      { teamMembers: 0, ordersHandled: 0, inventoryUpdates: 0, accuracyTotal: 0 },
    );
    const avgAccuracy =
      summary.teamMembers > 0 ? summary.accuracyTotal / summary.teamMembers : 0;

    const teamMembersEl = document.getElementById("monitoringTeamMembers");
    const ordersHandledEl = document.getElementById("monitoringOrdersHandled");
    const inventoryUpdatesEl = document.getElementById("monitoringInventoryUpdates");
    const avgSuccessEl = document.getElementById("monitoringAvgSuccess");

    if (teamMembersEl) teamMembersEl.textContent = String(summary.teamMembers);
    if (ordersHandledEl) ordersHandledEl.textContent = String(summary.ordersHandled);
    if (inventoryUpdatesEl) inventoryUpdatesEl.textContent = String(summary.inventoryUpdates);
    if (avgSuccessEl) avgSuccessEl.textContent = `${avgAccuracy.toFixed(1)}%`;

    const teamPerformanceList = document.getElementById("teamPerformanceList");
    if (teamPerformanceList) {
      teamPerformanceList.innerHTML =
        teamPerformance.length === 0
          ? '<div class="empty-state">No monitoring data available.</div>'
          : teamPerformance
            .map(
              (user) => `
              <div class="monitoring-card-row">
                <div class="monitoring-card-head">
                  <div>
                    <strong>${escapeHtml(user.username || "User")}</strong>
                    <div class="monitoring-role">${escapeHtml((user.role || "staff").replace(/^./, (c) => c.toUpperCase()))}</div>
                  </div>
                  <span class="badge ${Number(user.accuracyRate || 0) >= 90 ? "success" : Number(user.accuracyRate || 0) >= 60 ? "warning" : "danger"}">${Number(user.accuracyRate || 0).toFixed(1)}%</span>
                </div>
                <div class="monitoring-stat-grid">
                  <div class="monitoring-stat">
                    <span>Orders</span>
                    <strong>${Number(user.ordersProcessed || 0)}</strong>
                  </div>
                  <div class="monitoring-stat">
                    <span>Inventory</span>
                    <strong>${Number(user.inventoryUpdates || 0)}</strong>
                  </div>
                <div class="monitoring-stat">
                  <span>Actions</span>
                  <strong>${Number(user.totalActions || 0)}</strong>
                </div>
              </div>
              <div class="monitoring-footer">
                <span>${Number(user.totalActions || 0)} total actions</span>
                <span>${Number(user.ordersProcessed || 0)} orders, ${Number(user.inventoryUpdates || 0)} updates</span>
              </div>
              </div>
            `,
            )
            .join("");
    }

    const auditTrailList = document.getElementById("auditTrailList");
    if (auditTrailList) {
      auditTrailList.innerHTML =
        recentActivity.length === 0
          ? '<div class="empty-state">No audit events available.</div>'
          : recentActivity
            .map(
              (entry) => `
              <div class="monitoring-log-row">
                <div class="monitoring-log-head">
                  <strong>${escapeHtml(entry.action_type || "Activity")}</strong>
                  <span>${escapeHtml(entry.username || "System")}</span>
                </div>
                <div class="monitoring-log-details">${escapeHtml(entry.details || `${entry.entity_type || "record"} updated`)}</div>
                <div class="kpi-subtext">${new Date(entry.created_at).toLocaleString()}</div>
              </div>
            `,
            )
            .join("");
    }
  } catch (err) {
    console.error("Failed to load monitoring data:", err);
  }

  // Show audit log export controls for admin only
  const auditControls = document.getElementById("auditExportControls");
  if (auditControls && isAdmin()) {
    auditControls.style.display = "flex";
    const auditFrom = document.getElementById("auditFromDate");
    const auditTo = document.getElementById("auditToDate");
    if (auditFrom && !auditFrom.value) {
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, "0");
      const d = String(today.getDate()).padStart(2, "0");
      auditFrom.value = `${y}-${m}-${d}`;
      auditTo.value = `${y}-${m}-${d}`;
    }
  }
}

// Audit log download handler
document.getElementById("downloadAuditLogsBtn")?.addEventListener("click", async () => {
  const fromVal = document.getElementById("auditFromDate")?.value;
  const toVal = document.getElementById("auditToDate")?.value;
  if (!fromVal || !toVal) {
    showToast("Please select both From and To dates.", "error");
    return;
  }
  if (new Date(fromVal) > new Date(toVal)) {
    showToast("'From' date cannot be after 'To' date.", "error");
    return;
  }
  try {
    await API.download(
      `/api/monitoring/audits/export?from=${fromVal}&to=${toVal}`,
      `audit-logs-${fromVal}-to-${toVal}.xls`
    );
    showToast("Audit logs downloaded!", "success");
  } catch (err) {
    showToast(err.message || "Failed to download logs.", "error");
  }
});

// ============================================================
// INVENTORY
// ============================================================
async function loadInventory() {
  try {
    const items = await API.get("/api/inventory");
    const tbody = document.getElementById("inventoryTableBody");
    if (!tbody) return;

    tbody.innerHTML =
      items.length === 0
        ? '<tr><td colspan="9" style="text-align:center;color:var(--text-muted)">No inventory items found.</td></tr>'
        : items
          .map((i) => {
            const badgeClass =
              i.status === "in-stock"
                ? "success"
                : i.status === "low-stock"
                  ? "warning"
                  : "danger";
            const label = i.status
              .replace("-", " ")
              .replace(/\b\w/g, (c) => c.toUpperCase());
            return `<tr>
                  <td>#INV-${String(i.id).padStart(3, "0")}</td>
                  <td>${i.product_name}</td>
                  <td>${escapeHtml(i.category || "Other")}</td>
                  <td>${escapeHtml(i.supplier?.company_name || "Unassigned")}</td>
                  <td>${i.stock}</td>
                  <td>${i.low_stock_point ?? "Auto"}</td>
                  <td>${formatCurrency(i.price, "INR")}</td>
                  <td><span class="badge ${badgeClass}">${label}</span></td>
                </tr>`;
          })
          .join("");
  } catch (err) {
    console.error("Failed to load inventory:", err);
  }
}

// ============================================================
// ORDERS
// ============================================================
let orderInventoryCache = new Map();
let selectedOrderInventoryItem = null;

async function loadOrders() {
  try {
    const orders = await API.get("/api/orders");
    const orderQuery = (document.getElementById("orderSearchInput")?.value || "").trim().toLowerCase();
    const visibleOrders = orderQuery
      ? orders.filter((order) => {
        const searchable = [
          `ORD-${String(order.id).padStart(4, "0")}`,
          order.customer_name,
          order.product_name,
          order.items_count,
          order.total_amount,
          order.order_date,
          order.status,
        ]
          .filter((value) => value !== undefined && value !== null)
          .join(" ")
          .toLowerCase();
        return searchable.includes(orderQuery);
      })
      : orders;
    const canManageOrders = isAdmin() || isManager();
    const totalCountEl = document.getElementById("ordersTotalCount");
    const revenueEl = document.getElementById("ordersRevenue");
    const completedEl = document.getElementById("ordersCompletedCount");
    const pendingEl = document.getElementById("ordersPendingCount");

    const summary = orders.reduce(
      (acc, order) => {
        acc.total += 1;
        if (order.status === "completed") acc.completed += 1;
        if (order.status === "pending") acc.pending += 1;
        if (order.status === "completed") {
          acc.revenue += Number(order.total_amount || 0);
        }
        return acc;
      },
      { total: 0, revenue: 0, completed: 0, pending: 0 },
    );

    if (totalCountEl) totalCountEl.textContent = String(summary.total);
    if (revenueEl) revenueEl.textContent = formatCurrency(summary.revenue, "INR");
    if (completedEl) completedEl.textContent = String(summary.completed);
    if (pendingEl) pendingEl.textContent = String(summary.pending);

    const tbody = document.getElementById("ordersTableBody");
    if (!tbody) return;

    tbody.innerHTML =
      orders.length === 0
        ? '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">No orders found.</td></tr>'
        : visibleOrders.length === 0
          ? '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">No orders match your search.</td></tr>'
          : visibleOrders
            .map((o) => {
              const badgeClass =
                o.status === "completed"
                  ? "success"
                  : o.status === "cancelled"
                    ? "danger"
                    : "warning";

              const breakdownBtn = isAdmin() && o.status === "completed"
                ? `<button onclick="openOrderBreakdown(${o.id})" title="Price Breakdown"
                    style="background:rgba(139,92,246,0.15); color:#a78bfa; border:1px solid rgba(139,92,246,0.3); padding:4px 10px; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600; margin-left:4px;">
                    Breakdown
                   </button>`
                : "";

              return `<tr>
                  <td>#ORD-${String(o.id).padStart(4, "0")}</td>
                  <td>${o.customer_name}</td>
                  <td>${o.items_count}x ${o.product_name || "Item"}</td>
                  <td>${formatCurrency(o.total_amount, "INR")}</td>
                  <td>${new Date(o.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}</td>
                  <td><span class="badge ${badgeClass}">${o.status.charAt(0).toUpperCase() + o.status.slice(1)}</span></td>
                  <td>
                    <div class="orders-actions">
                      ${canManageOrders
                  ? `<button class="btn-icon btn-edit orders-edit-btn" onclick="openEditOrder(${o.id}, '${(o.customer_name || "").replace(/'/g, "\\'")}', '${o.status}')" title="Edit Order">Edit</button>`
                  : '<span style="color:var(--text-muted); font-size:12px;">View only</span>'
                }
                      ${breakdownBtn}
                      ${o.status === 'completed' ? `
                        <button class="btn-icon" onclick="generateInvoice(${o.id})" title="Print Invoice" 
                          style="background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.3); padding:4px 10px; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600; margin-left:4px;">
                          Invoice
                        </button>
                      ` : ''}
                    </div>
                  </td>
                </tr>`;
            })
            .join("");
  } catch (err) {
    console.error("Failed to load orders:", err);
  }
}

async function loadOrderInventoryOptions() {
  try {
    const items = await API.get(`/api/inventory?t=${Date.now()}`);

    orderInventoryCache = new Map(
      items.map((item) => [String(item.id), item]),
    );

    const searchInput = document.getElementById("orderInventorySearch");
    const resultsPopover = document.getElementById("orderInventorySearchResults");
    const hiddenItemInput = document.getElementById("orderInventorySelect");
    const supplierContainer = document.getElementById("supplierSelectionContainer");
    const supplierCards = document.getElementById("orderSupplierCards");
    const detailsBox = document.getElementById("orderItemDetails");

    if (!searchInput || !resultsPopover) return;

    // Clear previous state
    resultsPopover.innerHTML = "";
    resultsPopover.style.display = "none";

    searchInput.addEventListener("input", function () {
      const query = this.value.toLowerCase().trim();
      if (!query) {
        resultsPopover.style.display = "none";
        return;
      }

      const matches = items.filter(i =>
        i.product_name.toLowerCase().includes(query) ||
        (i.category && i.category.toLowerCase().includes(query))
      ).slice(0, 8); // Limit results for UI

      if (matches.length > 0) {
        resultsPopover.innerHTML = matches.map(i => `
                <div class="search-result-item" data-id="${i.id}">
                  <span class="product-name">${escapeHtml(i.product_name)}</span>
                  <span class="product-info">${escapeHtml(i.category || "General")} • Total Stock: ${i.stock}</span>
                </div>
              `).join("");
        resultsPopover.style.display = "block";

        // Add click listeners to results
        resultsPopover.querySelectorAll(".search-result-item").forEach(item => {
          item.addEventListener("click", function () {
            const id = this.getAttribute("data-id");
            selectOrderItem(id);
          });
        });
      } else {
        resultsPopover.innerHTML = '<div style="padding:12px; color:var(--text-muted)">No matching products found.</div>';
        resultsPopover.style.display = "block";
      }
    });

    // Close search popover on outside click
    document.addEventListener("click", function (e) {
      if (!searchInput.contains(e.target) && !resultsPopover.contains(e.target)) {
        resultsPopover.style.display = "none";
      }
    });

    function selectOrderItem(id) {
      const item = orderInventoryCache.get(String(id));
      if (!item) return;

      searchInput.value = item.product_name;
      hiddenItemInput.value = item.id;
      resultsPopover.style.display = "none";

      selectedOrderInventoryItem = item;
      renderSupplierCards(item);
    }

    function renderSupplierCards(item) {
      supplierContainer.style.display = "block";
      detailsBox.style.display = "none";
      document.getElementById("orderSupplierSelect").value = "";

      const suppliers = item.all_suppliers || [];
      if (suppliers.length === 0 && item.supplier) {
        suppliers.push({
          id: item.supplier.id,
          company_name: item.supplier.company_name,
          stock: item.stock,
          unit_cost: item.price
        });
      }

      if (suppliers.length > 0) {
        supplierCards.innerHTML = suppliers.map(s => `
                <div class="supplier-card" data-id="${s.id}" data-stock="${s.stock}" data-price="${s.selling_price || item.price}">
                  <div class="supplier-name">${escapeHtml(s.company_name)}</div>
                  <div class="supplier-stock ${s.stock > 10 ? 'high' : 'low'}">${s.stock} in stock</div>
                  <div class="supplier-price">${formatCurrency(s.selling_price || item.price, 'INR')}</div>
                </div>
              `).join("");

        supplierCards.querySelectorAll(".supplier-card").forEach(card => {
          card.addEventListener("click", function () {
            // Update styles
            supplierCards.querySelectorAll(".supplier-card").forEach(c => c.classList.remove("selected"));
            this.classList.add("selected");

            // Update hidden input
            const supplierId = this.getAttribute("data-id");
            document.getElementById("orderSupplierSelect").value = supplierId;

            // Update preview
            updateOrderPreviewWithData(
              parseInt(this.getAttribute("data-stock")),
              parseFloat(this.getAttribute("data-price")),
              item.product_name
            );
          });
        });
      } else {
        supplierCards.innerHTML = '<div class="empty-state">No suppliers found for this item.</div>';
      }
    }

    function updateOrderPreviewWithData(stock, price, productName) {
      const orderCountInput = document.getElementById("orderItemsCount");
      const orderDetailsBox = document.getElementById("orderItemDetails");
      const orderTotalPreview = document.getElementById("orderTotalPreview");

      orderDetailsBox.style.display = "block";
      orderCountInput.setAttribute("max", stock);

      orderDetailsBox.innerHTML = `
              <div class="order-summary-title">${escapeHtml(productName)}</div>
              <div class="order-summary-grid">
                 <div class="order-summary-chip ${stock > 5 ? "success" : "warning"}">
                   Stock: ${stock}
                 </div>
                 <div class="order-summary-chip">
                  Price: ${formatCurrency(price, "INR")}
                 </div>
              </div>
            `;

      // Trigger total update
      const count = parseInt(orderCountInput.value, 10);
      if (!isNaN(count) && count > 0) {
        if (count > stock) {
          orderTotalPreview.innerHTML = `<span style="color:var(--danger)">Exceeds available stock!</span>`;
        } else {
          orderTotalPreview.textContent = `Total Amount: ${formatCurrency(count * price, "INR")}`;
        }
      }
    }

  } catch (err) {
    console.error(err);
  }
}

function openEditOrder(id, customerName, status) {
  const modal = document.getElementById("editOrderModal");
  document.getElementById("editOrderId").value = id;
  document.getElementById("editOrderCustomerName").value = customerName;
  document.getElementById("editOrderStatus").value = status || "pending";
  if (modal) modal.style.display = "flex";
}

document
  .getElementById("editOrderForm")
  ?.addEventListener("submit", async function (e) {
    e.preventDefault();
    const id = document.getElementById("editOrderId").value;
    const body = {
      customer_name: document.getElementById("editOrderCustomerName").value.trim(),
      status: document.getElementById("editOrderStatus").value,
    };
    try {
      await API.put(`/api/orders/${id}`, body);
      alert("Order updated successfully!");
      document.getElementById("editOrderModal").style.display = "none";
      loadOrders();
      loadInventory();
      loadDashboardAlerts();
      if (typeof loadMonitoringOverview === "function") loadMonitoringOverview();
      if (typeof window.reloadDashboardReport === "function") {
        window.reloadDashboardReport();
      }
    } catch (err) {
      alert(err.message);
    }
  });

function updateOrderPreview() {
  const orderSelect = document.getElementById("orderInventorySelect");
  const orderCountInput = document.getElementById("orderItemsCount");
  const orderDetailsBox = document.getElementById("orderItemDetails");
  const orderTotalPreview = document.getElementById("orderTotalPreview");

  if (!orderSelect || !orderCountInput || !orderDetailsBox) return;

  const selectedOpt = orderSelect.options[orderSelect.selectedIndex];
  if (!selectedOpt || selectedOpt.value === "") {
    orderDetailsBox.style.display = "block";
    orderDetailsBox.innerHTML =
      '<div class="empty-state" style="padding: 0">Select an inventory item to see stock and price.</div>';
    if (orderTotalPreview) orderTotalPreview.textContent = "";
    orderCountInput.removeAttribute("max");
    selectedOrderInventoryItem = null;
    return;
  }

  selectedOrderInventoryItem =
    orderInventoryCache.get(String(parseInt(selectedOpt.value, 10))) || null;

  const dataStock = selectedOpt.dataset.stock ?? selectedOpt.getAttribute("data-stock");
  const stock = Number(
    dataStock !== undefined && dataStock !== null
      ? dataStock
      : selectedOrderInventoryItem?.stock ?? 0,
  );
  const price = Number(
    selectedOpt.dataset.price ??
    selectedOpt.getAttribute("data-price") ??
    selectedOrderInventoryItem?.price ??
    0,
  );
  const productName =
    selectedOrderInventoryItem?.product_name ||
    selectedOpt.dataset.name ||
    selectedOpt.textContent.replace(/\s*\(\d+\s+in stock\)\s*$/, "").trim();

  orderCountInput.setAttribute("max", stock);
  orderDetailsBox.style.display = "block";
  orderDetailsBox.innerHTML = `
          <div class="order-summary-title">${escapeHtml(productName || "Selected Item")}</div>
          <div class="order-summary-grid">
             <div class="order-summary-chip ${stock > 5 ? "success" : "warning"}">
               Stock: ${Number.isFinite(stock) ? stock : 0}
             </div>
             <div class="order-summary-chip">
              Price: ${formatCurrency(price, "INR")}
             </div>
          </div>
        `;

  const count = parseInt(orderCountInput.value, 10);
  if (!isNaN(count) && count > 0) {
    if (count > stock) {
      orderTotalPreview.innerHTML = `<span style="color:var(--danger)">Exceeds available stock!</span>`;
    } else {
      orderTotalPreview.textContent = `Total Amount: ${formatCurrency(count * price, "INR")}`;
    }
  } else {
    if (orderTotalPreview) orderTotalPreview.textContent = "";
  }
}

setTimeout(() => {
  document
    .getElementById("orderItemsCount")
    ?.addEventListener("input", function () {
      // This will only work if we have all the data needed (selected item + supplier)
      // The renderSupplierCards function now handles specific updates, 
      // but we can add a generic trigger here if a supplier is already selected.
      const supplierId = document.getElementById("orderSupplierSelect").value;
      if (supplierId && selectedOrderInventoryItem) {
        const selectedCard = document.querySelector(".supplier-card.selected");
        if (selectedCard) {
          const stock = parseInt(selectedCard.getAttribute("data-stock"));
          const price = parseFloat(selectedCard.getAttribute("data-price"));

          const orderTotalPreview = document.getElementById("orderTotalPreview");
          const count = parseInt(this.value, 10);
          if (!isNaN(count) && count > 0) {
            if (count > stock) {
              orderTotalPreview.innerHTML = `<span style="color:var(--danger)">Exceeds available stock!</span>`;
            } else {
              orderTotalPreview.textContent = `Total Amount: ${formatCurrency(count * price, "INR")}`;
            }
          } else {
            orderTotalPreview.textContent = "";
          }
        }
      }
    });
}, 0);

// Add a reset for the search UI when the Add Order button is clicked
document.getElementById("addOrderBtn")?.addEventListener("click", () => {
  // Clear Search UI
  const searchInput = document.getElementById("orderInventorySearch");
  if (searchInput) searchInput.value = "";

  const phoneInput = document.getElementById("orderCustomerPhone");
  if (phoneInput) phoneInput.value = "";

  const emailInput = document.getElementById("orderCustomerEmail");
  if (emailInput) emailInput.value = "";

  const hiddenItemInput = document.getElementById("orderInventorySelect");
  if (hiddenItemInput) hiddenItemInput.value = "";

  const hiddenSupplierInput = document.getElementById("orderSupplierSelect");
  if (hiddenSupplierInput) hiddenSupplierInput.value = "";

  const supplierContainer = document.getElementById("supplierSelectionContainer");
  if (supplierContainer) supplierContainer.style.display = "none";

  const supplierCards = document.getElementById("orderSupplierCards");
  if (supplierCards) supplierCards.innerHTML = "";

  const detailsBox = document.getElementById("orderItemDetails");
  if (detailsBox) detailsBox.style.display = "none";

  const orderTotalPreview = document.getElementById("orderTotalPreview");
  if (orderTotalPreview) orderTotalPreview.textContent = "";

  selectedOrderInventoryItem = null;
});

// ============================================================


function openEditSupplier(
  id,
  company,
  contact,
  phone,
  email,
  status,
  onTimeRate = 95,
  qualityRating = 4.5,
  paymentTerms = "Net 30",
) {
  document.getElementById("editSupplierId").value = id;
  document.getElementById("editSupplierCompany").value = company;
  document.getElementById("editSupplierContact").value = contact;
  document.getElementById("editSupplierPhone").value = phone;
  document.getElementById("editSupplierEmail").value = email;
  document.getElementById("editSupplierStatus").value = status;
  document.getElementById("editSupplierOnTimeRate").value = onTimeRate;
  document.getElementById("editSupplierQualityRating").value =
    qualityRating;
  document.getElementById("editSupplierPaymentTerms").value =
    paymentTerms;
  document.getElementById("editSupplierModal").style.display = "flex";
}

document
  .getElementById("editSupplierForm")
  ?.addEventListener("submit", async function (e) {
    e.preventDefault();
    const id = document.getElementById("editSupplierId").value;
    const body = {
      company_name: document.getElementById("editSupplierCompany").value,
      contact_person: document.getElementById("editSupplierContact")
        .value,
      phone: document.getElementById("editSupplierPhone").value,
      email: document.getElementById("editSupplierEmail").value,
      status: document.getElementById("editSupplierStatus").value,
      on_time_delivery_rate: document.getElementById(
        "editSupplierOnTimeRate",
      ).value,
      quality_rating: document.getElementById("editSupplierQualityRating")
        .value,
      payment_terms: document.getElementById("editSupplierPaymentTerms")
        .value,
    };
    try {
      await API.put(`/api/suppliers/${id}`, body);
      showToast("Supplier updated successfully!", "success");
      document.getElementById("editSupplierModal").style.display = "none";
      loadSuppliers();
    } catch (err) {
      alert(err.message);
    }
  });

// Delete Supplier
async function deleteSupplier(id, name) {
  if (
    !confirm(
      `Are you sure you want to delete supplier "${name}"?\n\nThis action cannot be undone.`,
    )
  )
    return;
  try {
    await API.delete(`/api/suppliers/${id}`);
    alert("Supplier deleted successfully!");
    if (selectedSupplierId === Number(id)) {
      selectedSupplierId = null;
    }
    loadSuppliers();
  } catch (err) {
    alert(err.message);
  }
}

// Edit Supplier modal controls
(function () {
  const modal = document.getElementById("editSupplierModal");
  document.getElementById("closeEditSupplierModal").onclick = () =>
    (modal.style.display = "none");
  document.getElementById("cancelEditSupplierBtn").onclick = () =>
    (modal.style.display = "none");
  modal.onclick = (e) => {
    if (e.target === modal) modal.style.display = "none";
  };
})();

// ============================================================
// EMPLOYEES
// ============================================================
async function loadEmployees() {
  try {
    const employees = await API.get("/api/employees");
    const tbody = document.getElementById("employeeTableBody");
    if (!tbody) return;

    tbody.innerHTML = employees
      .map(
        (u) => `
            <tr>
              <td>${escapeHtml(u.username)}</td>
                  <td>${escapeHtml(u.full_name || "-")}</td>
                  <td>${escapeHtml(u.phone || "-")}</td>
                  <td>${escapeHtml(u.email || "-")}</td>
                  <td>${escapeHtml(u.address || "-")}</td>
              <td>${u.role.charAt(0).toUpperCase() + u.role.slice(1)}</td>
              <td><span class="badge ${u.status === "active" ? "success" : "danger"}">${u.status.charAt(0).toUpperCase() + u.status.slice(1)}</span></td>
              <td>
                <div style="display:flex; gap:8px;">
                  <button onclick="openEditEmployee(${u.id}, '${u.username.replace(/'/g, "\\'")}', '${(u.full_name || "").replace(/'/g, "\\'")}', '${u.role}', '${u.status}', '${(u.phone || "").replace(/'/g, "\\'")}', '${(u.email || "").replace(/'/g, "\\'")}', '${(u.address || "").replace(/'/g, "\\'")}')" class="btn-icon btn-edit" title="Edit User">Edit</button>
                  ${u.role !== "admin"
            ? `<button onclick="deleteEmployee(${u.id})" class="btn-icon btn-delete" title="Delete User">Delete</button>`
            : '<span style="color:var(--text-muted);font-size:12px; margin-top:6px;">Protected</span>'
          }
                </div>
              </td>
            </tr>`,
      )
      .join("");
  } catch (err) {
    console.error("Failed to load employees:", err);
  }
}

async function deleteEmployee(id) {
  if (!confirm("Are you sure you want to delete this employee?")) return;
  try {
    await API.delete(`/api/employees/${id}`);
    alert("Employee deleted successfully!");
    loadEmployees();
    if (typeof loadMonitoringOverview === "function") loadMonitoringOverview();
  } catch (err) {
    alert(err.message);
  }
}

// ============================================================
// SIDEBAR TOGGLE
// ============================================================
document
  .getElementById("menuToggle")
  .addEventListener("click", function () {
    document.getElementById("sidebar").classList.toggle("collapsed");
    document.getElementById("mainContent").classList.toggle("expanded");
  });

// ============================================================
// NAVIGATION
// ============================================================
const navItems = document.querySelectorAll(".nav-item");
const pageSections = document.querySelectorAll(".page-section");

navItems.forEach((item) => {
  item.addEventListener("click", function () {
    if (this.dataset.page === "employees-page" && !isAdmin()) {
      alert("Access denied. Admin only.");
      return;
    }
    if (this.dataset.page === "customers-page") {
      loadCustomers();
    }
    navItems.forEach((nav) => nav.classList.remove("active"));
    this.classList.add("active");
    pageSections.forEach((s) => s.classList.remove("active"));
    document.getElementById(this.dataset.page).classList.add("active");
  });
});

// ============================================================
// MODALS
// ============================================================
function setupModal(openBtnId, modalId, closeBtnId, cancelBtnId) {
  const openBtn = document.getElementById(openBtnId);
  const modal = document.getElementById(modalId);
  const closeBtn = document.getElementById(closeBtnId);
  const cancelBtn = document.getElementById(cancelBtnId);
  if (openBtn) openBtn.onclick = () => (modal.style.display = "flex");
  if (closeBtn) closeBtn.onclick = () => (modal.style.display = "none");
  if (cancelBtn) cancelBtn.onclick = () => (modal.style.display = "none");
  if (modal)
    modal.onclick = (e) => {
      if (e.target === modal) modal.style.display = "none";
    };
}

setupModal(
  "addSupplierBtn",
  "addSupplierModal",
  "closeSupplierModal",
  "cancelSupplierBtn",
);
setupModal(
  "addOrderBtn",
  "addOrderModal",
  "closeOrderModal",
  "cancelOrderBtn",
);
setupModal(
  "openChangePassLink",
  "changePasswordModal",
  "closePasswordModal",
  "cancelPasswordBtn",
);
setupModal(
  "addCustomerBtn",
  "addCustomerModal",
  "closeCustomerModal",
  "cancelCustomerBtn",
);

document.getElementById("changePasswordForm")?.addEventListener("submit", handlePasswordChange);

async function handlePasswordChange(e) {
  e.preventDefault();
  const username = document.getElementById("changePassUsername").value.trim();
  const role = document.getElementById("changePassRole").value;
  const current_password = document.getElementById("currentPassword").value;
  const new_password = document.getElementById("newPassword").value;
  const confirm = document.getElementById("confirmNewPassword").value;

  if (new_password !== confirm) {
    showToast("Passwords do not match!", "error");
    return;
  }

  try {
    const res = await API.post("/api/auth/change-password-public", { 
      username, 
      role, 
      current_password, 
      new_password 
    });
    showToast(res.message, "success");
    document.getElementById("changePasswordModal").style.display = "none";
    e.target.reset();
  } catch (err) {
    showToast(err.message, "error");
  }
}

document.getElementById("addOrderBtn")?.addEventListener("click", async () => {
  if (typeof loadOrderInventoryOptions === "function") {
    await loadOrderInventoryOptions();
  }
  if (typeof loadCustomers === "function") loadCustomers();
});

document.getElementById("addCustomerForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = {
    name: document.getElementById("addCustomerName").value,
    phone: document.getElementById("addCustomerPhone").value,
    email: document.getElementById("addCustomerEmail").value,
    address: document.getElementById("addCustomerAddress").value,
  };
  try {
    await API.post("/api/customers", data);
    showToast("Customer added!", "success");
    document.getElementById("addCustomerModal").style.display = "none";
    e.target.reset();
    if (typeof loadCustomers === "function") loadCustomers();
  } catch (err) {
    showToast(err.message, "error");
  }
});

const editOrderModal = document.getElementById("editOrderModal");
document.getElementById("closeEditOrderModal").onclick = () =>
  (editOrderModal.style.display = "none");
document.getElementById("cancelEditOrderBtn").onclick = () =>
  (editOrderModal.style.display = "none");
if (editOrderModal) {
  editOrderModal.onclick = (e) => {
    if (e.target === editOrderModal) editOrderModal.style.display = "none";
  };
}

// Employee modals - admin guard
const addEmpBtn = document.getElementById("addEmployeeBtn");
const addEmpModal = document.getElementById("addEmployeeModal");
if (addEmpBtn)
  addEmpBtn.onclick = () => {
    if (!isAdmin()) {
      alert("Admin only.");
      return;
    }
    addEmpModal.style.display = "flex";
  };
document.getElementById("closeEmployeeModal").onclick = () =>
  (addEmpModal.style.display = "none");
document.getElementById("cancelEmployeeBtn").onclick = () =>
  (addEmpModal.style.display = "none");
if (addEmpModal)
  addEmpModal.onclick = (e) => {
    if (e.target === addEmpModal) addEmpModal.style.display = "none";
  };

// Edit Employee Modal
const editEmpModal = document.getElementById("editEmployeeModal");
document.getElementById("closeEditEmployeeModal").onclick = () =>
  (editEmpModal.style.display = "none");
document.getElementById("cancelEditEmployeeBtn").onclick = () =>
  (editEmpModal.style.display = "none");
if (editEmpModal)
  editEmpModal.onclick = (e) => {
    if (e.target === editEmpModal) editEmpModal.style.display = "none";
  };

// ============================================================
// EDIT EMPLOYEE LOGIC
// ============================================================
window.openEditEmployee = function (
  id,
  username,
  fullName = "",
  role,
  status,
  phone = "",
  email = "",
  address = "",
) {
  document.getElementById("editEmployeeId").value = id;
  document.getElementById("editEmployeeUsername").value = username;
  document.getElementById("editEmployeeFullName").value = fullName;
  document.getElementById("editEmployeeRole").value = role;
  document.getElementById("editEmployeeStatus").value = status;
  document.getElementById("editEmployeePhone").value = phone;
  document.getElementById("editEmployeeEmail").value = email;
  document.getElementById("editEmployeeAddress").value = address;
  document.getElementById("editEmployeeModal").style.display = "flex";
};

document
  .getElementById("editEmployeeForm")
  ?.addEventListener("submit", async function (e) {
    e.preventDefault();
    const id = document.getElementById("editEmployeeId").value;
    const body = {
      username: document
        .getElementById("editEmployeeUsername")
        .value.trim(),
      full_name: document
        .getElementById("editEmployeeFullName")
        .value.trim(),
      role: document.getElementById("editEmployeeRole").value,
      status: document.getElementById("editEmployeeStatus").value,
      phone:
        document.getElementById("editEmployeePhone").value.trim() || null,
      email:
        document.getElementById("editEmployeeEmail").value.trim() || null,
      address:
        document.getElementById("editEmployeeAddress").value.trim() ||
        null,
    };

    try {
      await API.put(`/api/employees/${id}`, body);
      showToast("Employee updated successfully!", "success");
      document.getElementById("editEmployeeModal").style.display = "none";

      // If I renamed myself, update the UI header
      if (parseInt(id) === currentUser.id) {
        currentUser.username = body.username;
        currentUser.role = body.role;
        document.getElementById("userName").textContent =
          currentUser.username;
        document.getElementById("userAvatar").textContent =
          currentUser.username.charAt(0).toUpperCase();
      }

      loadEmployees();
      if (typeof loadMonitoringOverview === "function") loadMonitoringOverview();
    } catch (err) {
      showToast(err.message, "error");
    }
  });

// ============================================================
// FORM SUBMISSIONS - wired to real API
// ============================================================

document
  .getElementById("addOrderForm")
  ?.addEventListener("submit", async function (e) {
    e.preventDefault();
    const payload = {
      customer_name: document.getElementById("orderCustomerName").value,
      customer_phone: document.getElementById("orderCustomerPhone").value,
      customer_email: document.getElementById("orderCustomerEmail").value,
      inventory_id: parseInt(document.getElementById("orderInventorySelect").value, 10),
      supplier_id: Number(document.getElementById("orderSupplierSelect").value),
      items_count: Number(document.getElementById("orderItemsCount").value),
    };

    if (!payload.supplier_id) {
      showToast("Please select a specific supplier for the order.", "error");
      return;
    }
    try {
      await API.post("/api/orders", payload);
      alert("Order added successfully!");
      this.reset();
      document.getElementById("addOrderModal").style.display = "none";
      loadOrders();
      loadInventory();
      loadDashboardAlerts();
      loadOrderInventoryOptions();
      if (typeof loadMonitoringOverview === "function") loadMonitoringOverview();
      if (typeof window.reloadDashboardReport === "function") {
        window.reloadDashboardReport();
      }
    } catch (err) {
      alert(err.message);
    }
  });

document
  .getElementById("addSupplierForm")
  ?.addEventListener("submit", async function (e) {
    e.preventDefault();
    const inputs = this.querySelectorAll("input");
    const body = {
      company_name: inputs[0].value,
      contact_person: inputs[1].value,
      phone: inputs[2].value,
      email: inputs[3].value,
      status: this.querySelector("select").value,
    };
    try {
      await API.post("/api/suppliers", body);
      showToast("Supplier added successfully!", "success");
      this.reset();
      document.getElementById("addSupplierModal").style.display = "none";
      loadSuppliers();
    } catch (err) {
      alert(err.message);
    }
  });

document
  .getElementById("supplierSearchInput")
  ?.addEventListener("input", async function () {
    renderSuppliersTable();
    const filtered = getFilteredSuppliers();
    if (filtered.length === 0) {
      renderEmptySupplierState("No suppliers match your search.");
      return;
    }

    if (
      !filtered.some((supplier) => supplier.id === selectedSupplierId)
    ) {
      await loadSupplierProducts(filtered[0].id);
    }
  });

document
  .getElementById("addEmployeeForm")
  ?.addEventListener("submit", async function (e) {
    e.preventDefault();
    const body = {
      username: document
        .getElementById("addEmployeeUsername")
        .value.trim(),
      full_name: document
        .getElementById("addEmployeeFullName")
        .value.trim(),
      role: document.getElementById("addEmployeeRole").value,
      password: document.getElementById("addEmployeePassword").value,
      phone:
        document.getElementById("addEmployeePhone").value.trim() || null,
      email:
        document.getElementById("addEmployeeEmail").value.trim() || null,
      address:
        document.getElementById("addEmployeeAddress").value.trim() ||
        null,
    };
    try {
      await API.post("/api/employees", body);
      alert("Employee added successfully!");
      this.reset();
      document.getElementById("addEmployeeModal").style.display = "none";
      loadEmployees();
      if (typeof loadMonitoringOverview === "function") loadMonitoringOverview();
    } catch (err) {
      alert(err.message);
    }
  });

// Load suppliers into the add/update form dropdown
async function loadItemFormSuppliers() {
  try {
    const suppliers = await API.get("/api/suppliers");
    const select = document.getElementById("itemSupplier");
    if (!select) return;
    const active = suppliers.filter((s) => s.status !== "inactive");
    select.innerHTML =
      '<option value="" disabled selected>Select supplier</option>' +
      active
        .map((s) => `<option value="${s.id}">${s.company_name}</option>`)
        .join("");
  } catch (err) {
    const select = document.getElementById("itemSupplier");
    if (select)
      select.innerHTML =
        '<option value="" disabled selected>Could not load suppliers</option>';
  }
}

document
  .getElementById("itemForm")
  ?.addEventListener("submit", async function (e) {
    e.preventDefault();
    const isEditing =
      typeof window.editingInventoryItemId === "number" &&
      Number.isFinite(window.editingInventoryItemId);
    const enteredStock = Number(document.getElementById("itemStock").value || 0);
    const currentStock = Number(window.editingInventoryCurrentStock || 0);
    const body = {
      product_name: document
        .getElementById("itemProductName")
        .value.trim(),
      category: document.getElementById("itemCategory").value,
      supplier_id: document.getElementById("itemSupplier").value,
      stock: isEditing ? currentStock + enteredStock : enteredStock,
      unit_cost: document.getElementById("itemUnitCost").value,
      price: document.getElementById("itemPrice").value,
      expiry_date: document.getElementById("itemExpiryDate").value || null,
      low_stock_point: document.getElementById("itemReorderLevel").value || null,
      description:
        document.getElementById("itemDescription").value.trim() || null,
    };
    const submitBtn = document.getElementById("itemFormSubmitBtn");
    const request = isEditing
      ? API.put(`/api/inventory/${window.editingInventoryItemId}`, body)
      : API.post("/api/inventory", body);
    submitBtn.disabled = true;
    submitBtn.textContent = isEditing ? "Updating..." : "Saving...";
    try {
      await request;
      showToast(
        isEditing ? "Item updated successfully!" : "Item saved successfully!",
        "success",
      );
      this.reset();
      if (typeof window.resetInventoryFormMode === "function") {
        window.resetInventoryFormMode();
      }

      loadInventory();
      loadDashboardAlerts();
      loadOrderInventoryOptions();
      if (typeof window.loadSuppliers === "function") {
        window.loadSuppliers();
      }
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent =
        typeof window.editingInventoryItemId === "number" &&
          Number.isFinite(window.editingInventoryItemId)
          ? "Update Item"
          : "Save Item";
    }
  });

document.getElementById("itemForm")?.addEventListener("reset", () => {
  if (typeof window.resetInventoryFormMode === "function") {
    window.resetInventoryFormMode();
  }
});

// ============================================================
// BARCODE SCANNER
// ============================================================
const scannerDevice = document.getElementById("scannerDevice");
const scannerModal = document.getElementById("scannerModal");
const closeScannerBtn = document.getElementById("closeScannerBtn");
const barcodeInput = document.getElementById("barcodeInput");

scannerDevice?.addEventListener("click", () => {
  scannerModal.classList.add("active");
  barcodeInput.focus();
});
closeScannerBtn?.addEventListener("click", () =>
  scannerModal.classList.remove("active"),
);
barcodeInput?.addEventListener("keypress", function (e) {
  if (e.key === "Enter") {
    alert("Scanned: " + this.value);
    this.value = "";
  }
});

async function exportDailyOrdersExcel() {
  const today = new Date().toISOString().slice(0, 10);
  await API.download(
    `/api/exports/daily?format=excel&date=${today}`,
    `daily-orders-${today}.xls`,
  );
}

document
  .getElementById("exportExcelBtn")
  ?.addEventListener("click", () =>
    exportDailyOrdersExcel().catch((err) => alert(err.message)),
  );

document
  .getElementById("orderSearchInput")
  ?.addEventListener("input", () => loadOrders());

// ============================================================
// ORDER PRICE BREAKDOWN MODAL (Admin only)
// ============================================================
async function openOrderBreakdown(orderId) {
  const modal = document.getElementById("orderBreakdownModal");
  const content = document.getElementById("orderBreakdownContent");
  if (!modal || !content) return;

  content.innerHTML = `<div style="padding:40px; text-align:center; color:#94a3b8;">Loading breakdown…</div>`;
  modal.style.display = "flex";

  try {
    const d = await API.get(`/api/orders/${orderId}/breakdown`);

    const profitColor = d.total_profit >= 0 ? "#34d399" : "#f87171";
    const marginColor = d.margin_pct >= 20 ? "#34d399" : d.margin_pct >= 10 ? "#fbbf24" : "#f87171";

    content.innerHTML = `
      <div style="padding:20px 24px; border-bottom:1px solid rgba(139,92,246,0.25); display:flex; align-items:flex-start; justify-content:space-between; gap:12px;">
        <div>
          <div style="font-size:11px; color:#a78bfa; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; margin-bottom:4px;">Price Breakdown · Admin Only</div>
          <h2 style="margin:0; font-size:18px; font-weight:700; color:#e2e8f0;">#ORD-${String(d.order_id).padStart(4,"0")} — ${escapeHtml(d.product_name)}</h2>
          <div style="font-size:12px; color:#64748b; margin-top:4px;">
            ${escapeHtml(d.customer_name)} &nbsp;·&nbsp; ${new Date(d.order_date).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}
            &nbsp;·&nbsp; Supplier: <strong style="color:#94a3b8;">${escapeHtml(d.supplier_name || "—")}</strong>
          </div>
        </div>
        <button onclick="closeOrderBreakdown()" style="background:none; border:none; font-size:22px; cursor:pointer; color:#64748b; flex-shrink:0; line-height:1;">×</button>
      </div>

      <div style="padding:20px 24px; display:flex; flex-direction:column; gap:12px;">

        <!-- Qty -->
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; background:#16203a; border-radius:10px;">
          <span style="color:#94a3b8; font-size:13px;">Quantity Sold</span>
          <span style="font-weight:700; color:#e2e8f0; font-size:15px;">${d.items_count} units</span>
        </div>

        <!-- Selling Price section -->
        <div style="background:#16203a; border-radius:10px; overflow:hidden;">
          <div style="padding:10px 16px; background:rgba(52,211,153,0.08); border-bottom:1px solid rgba(52,211,153,0.15);">
            <span style="font-size:11px; font-weight:700; color:#34d399; letter-spacing:0.07em; text-transform:uppercase;">Revenue</span>
          </div>
          <div style="padding:12px 16px; display:flex; justify-content:space-between;">
            <span style="color:#94a3b8; font-size:13px;">Unit Selling Price (Max Batch Rate)</span>
            <span style="font-weight:600; color:#e2e8f0;">${formatCurrency(d.unit_selling_price, "INR")}</span>
          </div>
          <div style="padding:12px 16px; display:flex; justify-content:space-between; border-top:1px solid #1e2d3d;">
            <span style="color:#e2e8f0; font-size:14px; font-weight:600;">Total Revenue</span>
            <span style="font-weight:700; color:#34d399; font-size:16px;">${formatCurrency(d.total_amount, "INR")}</span>
          </div>
        </div>

        <!-- Cost section -->
        <div style="background:#16203a; border-radius:10px; overflow:hidden;">
          <div style="padding:10px 16px; background:rgba(251,191,36,0.08); border-bottom:1px solid rgba(251,191,36,0.15);">
            <span style="font-size:11px; font-weight:700; color:#fbbf24; letter-spacing:0.07em; text-transform:uppercase;">Cost (FIFO Blended)</span>
          </div>
          <div style="padding:12px 16px; display:flex; justify-content:space-between;">
            <span style="color:#94a3b8; font-size:13px;">Avg Unit Purchase Cost</span>
            <span style="font-weight:600; color:#e2e8f0;">${formatCurrency(d.unit_cost, "INR")}</span>
          </div>
          <div style="padding:12px 16px; display:flex; justify-content:space-between; border-top:1px solid #1e2d3d;">
            <span style="color:#e2e8f0; font-size:14px; font-weight:600;">Total Cost</span>
            <span style="font-weight:700; color:#fbbf24; font-size:16px;">${formatCurrency(d.total_cost, "INR")}</span>
          </div>
        </div>

        <!-- Profit section -->
        <div style="background:#16203a; border-radius:10px; overflow:hidden; border:1px solid ${d.total_profit >= 0 ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'};">
          <div style="padding:14px 16px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-size:13px; color:#94a3b8; margin-bottom:2px;">Net Profit</div>
              <div style="font-size:11px; color:#64748b;">Revenue − Cost</div>
            </div>
            <div style="text-align:right;">
              <div style="font-weight:800; color:${profitColor}; font-size:22px;">${formatCurrency(d.total_profit, "INR")}</div>
              <div style="font-size:12px; font-weight:700; color:${marginColor}; margin-top:2px;">${d.margin_pct}% margin</div>
            </div>
          </div>
        </div>

        <!-- Method note -->
        <div style="padding:10px 14px; background:rgba(139,92,246,0.08); border:1px solid rgba(139,92,246,0.2); border-radius:8px; font-size:11px; color:#94a3b8; display:flex; align-items:center; gap:8px;">
          <span style="color:#a78bfa; font-size:14px;">ℹ</span>
          <span><strong style="color:#a78bfa;">Pricing Method:</strong> Customer charged the highest selling price across all active batches for this supplier. Cost is blended from actual FIFO batch purchase prices.</span>
        </div>

      </div>

      <div style="padding:14px 24px; border-top:1px solid rgba(139,92,246,0.2); text-align:right;">
        <button onclick="closeOrderBreakdown()" style="padding:9px 22px; background:#1e2d3d; color:#94a3b8; border:1px solid #374151; border-radius:8px; cursor:pointer; font-weight:600; font-size:13px;">Close</button>
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<div style="padding:40px; text-align:center; color:#f87171;">Failed to load breakdown: ${escapeHtml(err.message)}</div>`;
  }
}

function closeOrderBreakdown() {
  const modal = document.getElementById("orderBreakdownModal");
  if (modal) modal.style.display = "none";
}

document.getElementById("orderBreakdownModal")?.addEventListener("click", function (e) {
  if (e.target === this) closeOrderBreakdown();
});

window.openOrderBreakdown = openOrderBreakdown;
window.closeOrderBreakdown = closeOrderBreakdown;

// ============================================================
// CUSTOMERS
// ============================================================
async function loadCustomers() {
  try {
    const customers = await API.get("/api/customers");
    const tbody = document.getElementById("customersTableBody");
    const datalist = document.getElementById("customerSuggestions");

    if (datalist) {
      datalist.innerHTML = customers.map(c => `<option value="${escapeHtml(c.name)}">`).join("");
    }

    if (!tbody) return;

    if (customers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No customers found.</td></tr>`;
      return;
    }

    tbody.innerHTML = customers.map(c => `
      <tr>
        <td>#C-${String(c.id).padStart(3, "0")}</td>
        <td><strong>${escapeHtml(c.name)}</strong></td>
        <td>${escapeHtml(c.phone || "—")}</td>
        <td>${escapeHtml(c.email || "—")}</td>
        <td>${new Date(c.created_at).toLocaleDateString("en-IN")}</td>
        <td>
          <button class="btn-icon" onclick="viewCustomerHistory(${c.id}, '${escapeHtml(c.name).replace(/'/g, "\\'")}')" title="Order History">📜</button>
          <button class="btn-icon" onclick="deleteCustomer(${c.id})" title="Delete Customer">🗑️</button>
        </td>
      </tr>
    `).join("");
  } catch (err) {
    console.error("Failed to load customers:", err);
  }
}

async function deleteCustomer(id) {
  if (!confirm("Are you sure? This will not delete their orders.")) return;
  try {
    await API.delete(`/api/customers/${id}`);
    showToast("Customer deleted.", "success");
    loadCustomers();
  } catch (err) {
    showToast(err.message, "error");
  }
}

window.loadCustomers = loadCustomers;
window.deleteCustomer = deleteCustomer;

async function viewCustomerHistory(id, name) {
  try {
    const orders = await API.get(`/api/customers/${id}/orders`);
    const modal = document.getElementById("customerHistoryModal");
    const tbody = document.getElementById("customerHistoryTableBody");
    const title = document.getElementById("customerHistoryTitle");

    if (title) title.textContent = `📜 Order History: ${name}`;

    if (orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No orders found for this customer.</td></tr>`;
    } else {
      tbody.innerHTML = orders.map(o => {
        const badgeClass = o.status === "completed" ? "success" : o.status === "cancelled" ? "danger" : "warning";
        return `
          <tr>
            <td>#ORD-${String(o.id).padStart(4, "0")}</td>
            <td>${escapeHtml(o.product_name)}</td>
            <td>${o.items_count}</td>
            <td>${formatCurrency(o.total_amount, "INR")}</td>
            <td>${new Date(o.created_at).toLocaleDateString("en-IN")}</td>
            <td><span class="badge ${badgeClass}">${o.status.charAt(0).toUpperCase() + o.status.slice(1)}</span></td>
          </tr>
        `;
      }).join("");
    }

    modal.style.display = "flex";
  } catch (err) {
    showToast(err.message, "error");
  }
}

window.viewCustomerHistory = viewCustomerHistory;


// ============================================================
// INVOICE GENERATION
// ============================================================
async function generateInvoice(orderId) {
  try {
    const o = await API.get(`/api/orders/${orderId}`);
    if (o.status !== "completed") {
      showToast("Invoices can only be generated for COMPLETED orders.", "warning");
      return;
    }
    const modal = document.getElementById("invoiceModal");
    const printArea = document.getElementById("invoicePrintArea");

    const invoiceNum = `INV-${String(o.id).padStart(6, "0")}`;
    const date = new Date(o.created_at).toLocaleDateString("en-IN", { day:"2-digit", month:"long", year:"numeric" });

    printArea.innerHTML = `
      <div style="display: flex; justify-content: space-between; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px;">
        <div>
          <h1 style="margin: 0; color: #1e293b; font-size: 28px; text-transform: uppercase;">Smart Inventory</h1>
          <p style="margin: 5px 0; color: #64748b;">Premium Retail & Stock Management</p>
        </div>
        <div style="text-align: right;">
          <h2 style="margin: 0; color: #333;">INVOICE</h2>
          <p style="margin: 5px 0; font-weight: 700;"># ${invoiceNum}</p>
          <p style="margin: 5px 0;">Date: ${date}</p>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 40px;">
        <div style="color: #1e293b;">
          <h4 style="margin: 0 0 10px; color: #64748b; text-transform: uppercase; font-size: 12px; letter-spacing: 1px;">Billed To:</h4>
          <p style="margin: 0; font-weight: 700; font-size: 16px; color: #1e293b;">${escapeHtml(o.customer_name)}</p>
          <p style="margin: 5px 0; font-size: 14px; color: #1e293b;">${escapeHtml(o.customer_email || "No Email")}</p>
          <p style="margin: 5px 0; font-size: 14px; color: #1e293b;">${escapeHtml(o.customer_phone || "No Phone")}</p>
          <p style="margin: 5px 0; font-size: 14px; white-space: pre-wrap; color: #1e293b;">${escapeHtml(o.customer_address || "")}</p>
        </div>
        <div style="text-align: right; color: #1e293b;">
          <h4 style="margin: 0 0 10px; color: #64748b; text-transform: uppercase; font-size: 12px; letter-spacing: 1px;">Order Source:</h4>
          <p style="margin: 0; font-weight: 700; font-size: 14px; color: #1e293b;">${escapeHtml(o.supplier_name || "Direct Stock")}</p>
          <p style="margin: 5px 0; font-size: 14px; color: #1e293b;">Status: <span style="text-transform: uppercase; font-weight: 700; color: #10b981;">${o.status}</span></p>
        </div>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
        <thead>
          <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
            <th style="padding: 12px; text-align: left; font-size: 14px; color: #64748b;">Description</th>
            <th style="padding: 12px; text-align: center; font-size: 14px; color: #64748b;">Qty</th>
            <th style="padding: 12px; text-align: right; font-size: 14px; color: #64748b;">Unit Price</th>
            <th style="padding: 12px; text-align: right; font-size: 14px; color: #64748b;">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom: 1px solid #e2e8f0; color: #1e293b;">
            <td style="padding: 15px 12px; font-weight: 600; color: #1e293b;">${escapeHtml(o.product_name)}</td>
            <td style="padding: 15px 12px; text-align: center; color: #1e293b;">${o.items_count}</td>
            <td style="padding: 15px 12px; text-align: right; color: #1e293b;">${formatCurrency(o.total_amount / o.items_count, "INR")}</td>
            <td style="padding: 15px 12px; text-align: right; font-weight: 700; color: #1e293b;">${formatCurrency(o.total_amount, "INR")}</td>
          </tr>
        </tbody>
      </table>

      <div style="display: flex; justify-content: flex-end;">
        <div style="width: 250px; color: #1e293b;">
          <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee;">
            <span style="color: #64748b;">Subtotal</span>
            <span style="color: #1e293b;">${formatCurrency(o.total_amount, "INR")}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee;">
            <span style="color: #64748b;">Tax (GST 0%)</span>
            <span style="color: #1e293b;">₹0.00</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 15px 0; font-size: 18px; font-weight: 800; color: #1e293b;">
            <span>Total</span>
            <span>${formatCurrency(o.total_amount, "INR")}</span>
          </div>
        </div>
      </div>

      <div style="margin-top: 50px; padding-top: 20px; border-top: 1px dashed #cbd5e1; text-align: center; color: #94a3b8; font-size: 12px;">
        <p>Thank you for choosing Smart Inventory. This is a computer generated invoice.</p>
      </div>
    `;

    modal.style.display = "flex";
  } catch (err) {
    showToast(err.message, "error");
  }
}

function printInvoice() {
  const content = document.getElementById("invoicePrintArea").innerHTML;
  const printWindow = window.open("", "_blank");
  printWindow.document.write(`
    <html>
      <head>
        <title>Invoice</title>
        <style>
          body { font-family: 'Inter', sans-serif; -webkit-print-color-adjust: exact; }
          @media print {
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>${content}</body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 500);
}

window.generateInvoice = generateInvoice;
window.printInvoice = printInvoice;


