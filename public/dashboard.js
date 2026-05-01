// Feature module: dashboard reporting and stock alerts.

let currentReportStart = null;
let currentReportEnd = null;
let currentReportLabel = "Custom Range";

function parseDateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatReportCurrency(value) {
  return formatCurrency(value || 0, "INR");
}

function getAlertStatus(item) {
  const stock = Number(item.stock || 0);
  const threshold = Number(item.effective_low_stock_point || item.low_stock_point || 0);
  if (stock <= 0) return "out-of-stock";
  if (stock <= Math.max(5, Math.round(threshold * 0.35))) return "critical";
  return "low-stock";
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function initReportDates() {
  const today = new Date();
  const fromInput = document.getElementById("reportFromDate");
  const toInput = document.getElementById("reportToDate");
  if (fromInput && !fromInput.value) fromInput.value = toISODate(today);
  if (toInput && !toInput.value) toInput.value = toISODate(today);
}

function getReportDateRange() {
  const fromInput = document.getElementById("reportFromDate");
  const toInput = document.getElementById("reportToDate");

  const fromVal = fromInput?.value;
  const toVal = toInput?.value;

  if (!fromVal || !toVal) {
    showToast("Please select both From and To dates.", "error");
    return null;
  }

  const start = parseDateOnly(fromVal);
  const end = parseDateOnly(toVal);

  if (!start || !end) {
    showToast("Invalid date values.", "error");
    return null;
  }

  if (start > end) {
    showToast("'From' date cannot be after 'To' date.", "error");
    return null;
  }

  // Build a human-friendly label
  const opts = { month: "short", day: "numeric", year: "numeric" };
  const label = start.getTime() === end.getTime()
    ? start.toLocaleDateString("en-US", opts)
    : `${start.toLocaleDateString("en-US", opts)} – ${end.toLocaleDateString("en-US", opts)}`;

  return { start, end, label };
}

function renderSalesReport(summary, label) {
  const container = document.getElementById("salesReportSummary");
  if (!container) return;

  container.innerHTML = `
    <div class="report-summary-card">
      <div class="report-summary-label">Revenue</div>
      <div class="report-summary-value">${formatReportCurrency(summary.revenue)}</div>
      <div class="report-summary-subtext">${escapeHtml(label)} sales total</div>
    </div>
    <div class="report-summary-card" style="background: rgba(16,185,129,0.1); border-color: rgba(16,185,129,0.3);">
      <div class="report-summary-label" style="color: #34d399;">Net Profit</div>
      <div class="report-summary-value" style="color: #34d399;">${formatReportCurrency(summary.profit)}</div>
      <div class="report-summary-subtext">Revenue minus purchase cost</div>
    </div>
    <div class="report-summary-card">
      <div class="report-summary-label">Orders</div>
      <div class="report-summary-value">${summary.orders}</div>
      <div class="report-summary-subtext">${escapeHtml(label)} orders</div>
    </div>
    <div class="report-summary-card">
      <div class="report-summary-label">Items Sold</div>
      <div class="report-summary-value">${summary.items}</div>
      <div class="report-summary-subtext">Units sold</div>
    </div>
  `;
}

function filterOrdersByRange(orders, start, end) {
  const endOfDay = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
  return orders.filter((order) => {
    const orderDate = parseDateOnly(order.order_date || order.created_at);
    return orderDate && orderDate >= start && orderDate <= endOfDay && order.status === "completed";
  });
}

async function loadSalesReport() {
  try {
    const range = getReportDateRange();
    if (!range) return;

    currentReportStart = range.start;
    currentReportEnd = range.end;
    currentReportLabel = range.label;

    const orders = await API.get("/api/orders");
    const filtered = filterOrdersByRange(orders, range.start, range.end);

    const summary = filtered.reduce(
      (acc, order) => {
        acc.orders += 1;
        const itemsCount = Number(order.items_count || 0);
        const orderRevenue = Number(order.total_amount || 0);
        const orderProfit = Number(order.total_profit || 0);
        
        acc.items += itemsCount;
        acc.revenue += orderRevenue;
        acc.profit += orderProfit;
        return acc;
      },
      { orders: 0, items: 0, revenue: 0, profit: 0 },
    );

    summary.averageOrder = summary.orders > 0 ? summary.revenue / summary.orders : 0;
    renderSalesReport(summary, range.label);
    updateCharts(filtered);
  } catch (err) {
    const container = document.getElementById("salesReportSummary");
    if (container) {
      container.innerHTML = `<div class="empty-state">Failed to generate report: ${escapeHtml(err.message)}</div>`;
    }
  }
}

async function exportSalesReportExcel() {
  try {
    const range = getReportDateRange();
    if (!range) return;

    const orders = await API.get("/api/orders");
    const filtered = filterOrdersByRange(orders, range.start, range.end);

    if (filtered.length === 0) {
      showToast("No completed orders found in the selected range.", "info");
      return;
    }

    const rows = filtered.map((order) => {
      const dateStr = order.created_at
        ? new Date(order.created_at).toLocaleDateString("en-IN", {
            day: "2-digit", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit", hour12: true
          })
        : "";
      return `
      <tr>
        <td>${escapeHtml(order.id)}</td>
        <td>${escapeHtml(dateStr)}</td>
        <td>${escapeHtml(order.customer_name || "")}</td>
        <td>${escapeHtml(order.product_name || "Item")}</td>
        <td>${escapeHtml(order.items_count || 0)}</td>
        <td>${escapeHtml(formatReportCurrency(order.total_amount || 0))}</td>
        <td>${escapeHtml(order.status || "")}</td>
      </tr>
    `;
    }).join("");

    const html = `
      <html>
        <head><meta charset="utf-8" /></head>
        <body>
          <h2>Smart Inventory - Sales Report (${escapeHtml(range.label)})</h2>
          <table border="1">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Product</th>
                <th>Qty</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
      </html>
    `;

    const blob = new Blob([html], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sales-report-${toISODate(range.start)}-to-${toISODate(range.end)}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(err.message || "Failed to export report.");
  }
}

async function loadDashboardAlerts() {
  try {
    const { lowStock, expiring } = await API.get("/api/inventory/alerts");

    const lowTbody = document.getElementById("lowStockTableBody");
    if (lowTbody) {
      lowTbody.innerHTML =
        lowStock.length === 0
          ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No low stock items found.</td></tr>'
          : lowStock
              .map(
                (i) => `
                  <tr>
                    <td>#INV-${String(i.id).padStart(3, "0")}</td>
                    <td>${escapeHtml(i.product_name)}</td>
                    <td>${escapeHtml(i.category || "-")}</td>
                    <td>${i.stock}</td>
                    <td>${Number(i.effective_low_stock_point || i.low_stock_point || 0)}</td>
                    <td><span class="badge ${badgeClassForStatus(getAlertStatus(i))}">${escapeHtml(getAlertStatus(i).replace("-", " "))}</span></td>
                  </tr>`,
              )
              .join("");
    }

    const expTbody = document.getElementById("expiryTableBody");
    if (expTbody) {
      expTbody.innerHTML =
        expiring.length === 0
          ? '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No items expiring soon.</td></tr>'
          : expiring
              .map(
                (i) => `
                  <tr>
                    <td>#INV-${String(i.id).padStart(3, "0")}</td>
                    <td>${escapeHtml(i.product_name)}</td>
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

async function loadPendingApprovals() {
  if (!isAdmin()) {
    const container = document.getElementById("pendingApprovalsContainer");
    if (container) container.style.display = "none";
    return;
  }
  
  const container = document.getElementById("pendingApprovalsContainer");
  if (container) container.style.display = "block";
  const tbody = document.getElementById("pendingApprovalsTableBody");
  if (!tbody) return;
  
  try {
    const pendingItems = await API.get("/api/inventory/pending");
    if (pendingItems.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state" style="padding:20px;">No pending requests.</td></tr>';
      return;
    }
    
    tbody.innerHTML = pendingItems.map(i => `
      <tr>
        <td>${String(i.created_at).slice(0, 10)}</td>
        <td style="font-weight: 600;">${escapeHtml(i.product_name)}</td>
        <td>${escapeHtml(i.category || "-")}</td>
        <td>${escapeHtml(i.supplier_name || "Unknown")}</td>
        <td>${i.stock}</td>
        <td>${formatCurrency(i.unit_cost, "INR")}</td>
        <td>${formatCurrency(i.price, "INR")}</td>
        <td>
          <div style="display:flex; gap:8px;">
            <button onclick="approvePendingItem(${i.id}, '${escapeHtml(i.product_name).replace(/'/g, "\\'")}')" class="btn-icon" style="background:rgba(16,185,129,0.15); color:#34d399; border:1px solid rgba(16,185,129,0.3); padding:4px 8px; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600;">Approve</button>
            <button onclick="reviewPendingItem(${i.id})" class="btn-icon" style="background:rgba(245,158,11,0.15); color:#d97706; border:1px solid rgba(245,158,11,0.3); padding:4px 8px; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600;">Review/Edit</button>
          </div>
        </td>
      </tr>
    `).join("");
  } catch (err) {
    console.error("Failed to load pending approvals:", err);
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state" style="padding:20px; color: var(--danger);">Failed to load requests.</td></tr>';
  }
}

window.approvePendingItem = async function(id, name) {
  if (!confirm(`Are you sure you want to approve "${name}" to be added to inventory?`)) return;
  try {
    await API.post(`/api/inventory/${id}/approve`);
    showToast(`Approved "${name}" successfully.`, "success");
    loadPendingApprovals();
    if (typeof loadInventory === 'function') loadInventory();
  } catch (err) {
    showToast(err.message, "error");
  }
};

window.reviewPendingItem = function(id) {
  // Set flag for review mode
  window.isReviewingPendingItem = true;

  // Switch to the inventory page
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  document.querySelector('[data-page="inventory-page"]').classList.add("active");
  document.querySelectorAll(".page-section").forEach(s => s.classList.remove("active"));
  document.getElementById("inventory-page").classList.add("active");
  
  // Open the edit form
  if (typeof window.openInventoryItemForEdit === 'function') {
    window.openInventoryItemForEdit(id);
    showToast("Please review and adjust the selling price, then click 'Update Item' to approve it.", "info");
    
    // Focus the price field to draw attention to it
    setTimeout(() => {
      const priceInput = document.getElementById("itemPrice");
      if (priceInput) {
        priceInput.focus();
        priceInput.select();
      }
    }, 500);
  }
};

window.loadPendingApprovals = loadPendingApprovals;

function bindReportButtons() {
  document.getElementById("reportGenerateBtn")?.addEventListener("click", () => loadSalesReport());
  document.getElementById("dashboardExcelBtn")?.addEventListener("click", () => exportSalesReportExcel());
}

// ============================================================
// DASHBOARD CHARTS
// ============================================================
let salesChart = null;
let categoryChart = null;
let inventoryChart = null;

const CATEGORY_COLORS = {};
const COLOR_PALETTE = ["#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#f43f5e"];
let nextColorIdx = 0;

function getColorForCategory(cat) {
  if (!CATEGORY_COLORS[cat]) {
    CATEGORY_COLORS[cat] = COLOR_PALETTE[nextColorIdx % COLOR_PALETTE.length];
    nextColorIdx++;
  }
  return CATEGORY_COLORS[cat];
}

function initDashboardCharts() {
  const salesCtx = document.getElementById("salesPerformanceChart")?.getContext("2d");
  const catCtx = document.getElementById("categoryDistributionChart")?.getContext("2d");
  const invCtx = document.getElementById("inventoryMixChart")?.getContext("2d");

  if (salesCtx) {
    salesChart = new Chart(salesCtx, {
      type: "line",
      data: { labels: [], datasets: [{ label: "Revenue", data: [], borderColor: "#f59e0b", backgroundColor: "rgba(245, 158, 11, 0.1)", fill: true, tension: 0.4 }] },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#a8b3c7" } }, x: { grid: { display: false }, ticks: { color: "#a8b3c7" } } }, plugins: { legend: { display: false } } }
    });
  }

  if (catCtx) {
    categoryChart = new Chart(catCtx, {
      type: "doughnut",
      data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWeight: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { color: "#a8b3c7", padding: 20, font: { size: 11 } } } }, cutout: "70%" }
    });
  }

  if (invCtx) {
    inventoryChart = new Chart(invCtx, {
      type: "pie",
      data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWeight: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { color: "#a8b3c7", padding: 20, font: { size: 11 } } } } }
    });
  }
}

async function updateCharts(filteredOrders) {
  if (!salesChart || !categoryChart || !inventoryChart) return;

  // 1. Process Sales Trend (by day)
  const dailyData = {};
  filteredOrders.forEach(o => {
    const date = new Date(o.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
    dailyData[date] = (dailyData[date] || 0) + Number(o.total_amount);
  });

  salesChart.data.labels = Object.keys(dailyData);
  salesChart.data.datasets[0].data = Object.values(dailyData);
  salesChart.update();

  // 2. Process Sales Category Mix
  const catData = {};
  filteredOrders.forEach(o => {
    const cat = o.category || "Uncategorized";
    catData[cat] = (catData[cat] || 0) + 1;
  });

  const catLabels = Object.keys(catData);
  categoryChart.data.labels = catLabels;
  categoryChart.data.datasets[0].data = Object.values(catData);
  categoryChart.data.datasets[0].backgroundColor = catLabels.map(l => getColorForCategory(l));
  categoryChart.update();

  // 3. Process Inventory Mix (Full Catalog)
  try {
    const inventory = await API.get("/api/inventory");
    const invData = {};
    inventory.forEach(i => {
      const cat = i.category || "Uncategorized";
      invData[cat] = (invData[cat] || 0) + 1;
    });

    const invLabels = Object.keys(invData);
    inventoryChart.data.labels = invLabels;
    inventoryChart.data.datasets[0].data = Object.values(invData);
    inventoryChart.data.datasets[0].backgroundColor = invLabels.map(l => getColorForCategory(l));
    inventoryChart.update();
  } catch (err) {
    console.error("Failed to load inventory mix:", err);
  }
}

async function loadDashboardSnapshot() {
  const container = document.getElementById("dailySnapshotContainer");
  if (!container) return;

  try {
    const orders = await API.get("/api/orders");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const stats = {
      today: { revenue: 0, profit: 0, orders: 0 },
      yesterday: { revenue: 0, profit: 0, orders: 0 }
    };

    orders.forEach(o => {
      const orderDate = new Date(o.created_at);
      orderDate.setHours(0, 0, 0, 0);

      if (o.status === "completed") {
        if (orderDate.getTime() === today.getTime()) {
          stats.today.revenue += Number(o.total_amount);
          stats.today.profit += Number(o.total_profit);
          stats.today.orders++;
        } else if (orderDate.getTime() === yesterday.getTime()) {
          stats.yesterday.revenue += Number(o.total_amount);
          stats.yesterday.profit += Number(o.total_profit);
          stats.yesterday.orders++;
        }
      }
    });

    const getTrend = (curr, prev) => {
      if (prev === 0) return curr > 0 ? "up" : "flat";
      return curr >= prev ? "up" : "down";
    };

    const trendIcon = (trend) => trend === "up" ? "↗️" : trend === "down" ? "↘️" : "➡️";
    const trendColor = (trend) => trend === "up" ? "#10b981" : trend === "down" ? "#ef4444" : "var(--text-muted)";

    container.innerHTML = `
      <div class="report-summary-card" style="background: linear-gradient(135deg, rgba(59,130,246,0.1), rgba(59,130,246,0.05)); border-left: 4px solid #3b82f6;">
        <div class="report-summary-label">Today's Revenue</div>
        <div class="report-summary-value" style="color: #60a5fa;">${formatCurrency(stats.today.revenue, "INR")}</div>
        <div class="report-summary-subtext">
          <span style="color: ${trendColor(getTrend(stats.today.revenue, stats.yesterday.revenue))}">
            ${trendIcon(getTrend(stats.today.revenue, stats.yesterday.revenue))} vs Yesterday (${formatCurrency(stats.yesterday.revenue, "INR")})
          </span>
        </div>
      </div>
      <div class="report-summary-card" style="background: linear-gradient(135deg, rgba(16,185,129,0.1), rgba(16,185,129,0.05)); border-left: 4px solid #10b981;">
        <div class="report-summary-label">Today's Profit</div>
        <div class="report-summary-value" style="color: #34d399;">${formatCurrency(stats.today.profit, "INR")}</div>
        <div class="report-summary-subtext">
          <span style="color: ${trendColor(getTrend(stats.today.profit, stats.yesterday.profit))}">
            ${trendIcon(getTrend(stats.today.profit, stats.yesterday.profit))} vs Yesterday (${formatCurrency(stats.yesterday.profit, "INR")})
          </span>
        </div>
      </div>
      <div class="report-summary-card" style="background: linear-gradient(135deg, rgba(245,158,11,0.1), rgba(245,158,11,0.05)); border-left: 4px solid #f59e0b;">
        <div class="report-summary-label">Today's Orders</div>
        <div class="report-summary-value" style="color: #fbbf24;">${stats.today.orders}</div>
        <div class="report-summary-subtext">
           <span style="color: ${trendColor(getTrend(stats.today.orders, stats.yesterday.orders))}">
            ${trendIcon(getTrend(stats.today.orders, stats.yesterday.orders))} vs Yesterday (${stats.yesterday.orders})
          </span>
        </div>
      </div>
    `;
  } catch (err) {
    console.error("Failed to load daily snapshot:", err);
  }
}

bindReportButtons();
initReportDates();
initDashboardCharts();

window.loadSalesReport = loadSalesReport;
window.loadDashboardAlerts = loadDashboardAlerts;
window.loadDashboardSnapshot = loadDashboardSnapshot;
window.exportSalesReportExcel = exportSalesReportExcel;
window.reloadDashboardReport = () => {
  loadSalesReport();
  loadDashboardSnapshot();
};
