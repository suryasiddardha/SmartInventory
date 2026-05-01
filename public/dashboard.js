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
    <div class="report-summary-card">
      <div class="report-summary-label">Avg. Order Value</div>
      <div class="report-summary-value">${formatReportCurrency(summary.averageOrder)}</div>
      <div class="report-summary-subtext">Average money per order</div>
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
        acc.items += Number(order.items_count || 0);
        acc.revenue += Number(order.total_amount || 0);
        return acc;
      },
      { orders: 0, items: 0, revenue: 0 },
    );

    summary.averageOrder = summary.orders > 0 ? summary.revenue / summary.orders : 0;
    renderSalesReport(summary, range.label);
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

function bindReportButtons() {
  document.getElementById("reportGenerateBtn")?.addEventListener("click", () => loadSalesReport());
  document.getElementById("dashboardExcelBtn")?.addEventListener("click", () => exportSalesReportExcel());
}

bindReportButtons();
initReportDates();
window.loadSalesReport = loadSalesReport;
window.loadDashboardAlerts = loadDashboardAlerts;
window.exportSalesReportExcel = exportSalesReportExcel;
window.reloadDashboardReport = () => loadSalesReport();
