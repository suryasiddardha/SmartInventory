// Feature module: supplier listing and product details.

function getFilteredSuppliers() {
  const query = (document.getElementById("supplierSearchInput")?.value || "").trim().toLowerCase();
  if (!query) return supplierDirectory;

  return supplierDirectory.filter((supplier) => {
    const searchable = [
      supplier.company_name,
      supplier.contact_person,
      supplier.phone,
      supplier.email,
      supplier.status,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return searchable.includes(query);
  });
}

function renderEmptySupplierState(message) {
  const panel = document.getElementById("supplierProductsPanel");
  if (panel) {
    panel.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
  }
}

function renderSuppliersTable() {
  const tbody = document.getElementById("suppliersTableBody");
  if (!tbody) return;

  const canManage = isAdmin() || isManager();
  const colSpan = canManage ? 7 : 6;
  const filtered = getFilteredSuppliers();

  tbody.innerHTML =
    filtered.length === 0
      ? `<tr><td colspan="${colSpan}" style="text-align:center;color:var(--text-muted)">No suppliers found.</td></tr>`
      : filtered
          .map((supplier) => {
            const badgeClass = badgeClassForStatus(supplier.status);
            const isSelected = Number(supplier.id) === Number(selectedSupplierId);
            return `<tr class="supplier-row ${isSelected ? "selected" : ""}" data-supplier-id="${supplier.id}">
                <td>#SUP-${String(supplier.id).padStart(3, "0")}</td>
                <td>${escapeHtml(supplier.company_name)}</td>
                <td>${escapeHtml(supplier.contact_person || "-")}</td>
                <td>${escapeHtml(supplier.phone || "-")}</td>
                <td>${escapeHtml(supplier.email || "-")}</td>
                <td><span class="badge ${badgeClass}">${escapeHtml(supplier.status.charAt(0).toUpperCase() + supplier.status.slice(1))}</span></td>
                ${
                  canManage
                    ? `<td>
                  <div class="supplier-actions">
                    <button class="btn-icon btn-edit" onclick="event.stopPropagation(); openEditSupplier(${supplier.id}, '${(supplier.company_name || "").replace(/'/g, "\\'")}', '${(supplier.contact_person || "").replace(/'/g, "\\'")}', '${(supplier.phone || "").replace(/'/g, "\\'")}', '${(supplier.email || "").replace(/'/g, "\\'")}', '${supplier.status}', '${supplier.on_time_delivery_rate || 95}', '${supplier.quality_rating || 4.5}', '${(supplier.payment_terms || "Net 30").replace(/'/g, "\\'")}')" title="Edit Supplier">Edit</button>
                    ${isAdmin() ? `<button class="btn-icon btn-delete" onclick="event.stopPropagation(); deleteSupplier(${supplier.id}, '${(supplier.company_name || "").replace(/'/g, "\\'")}')" title="Delete Supplier">Delete</button>` : ""}
                  </div>
                </td>`
                    : ""
                }
              </tr>`;
          })
          .join("");

  tbody.querySelectorAll(".supplier-row").forEach((row) => {
    row.addEventListener("click", () => {
      loadSupplierProducts(Number(row.dataset.supplierId));
    });
  });
}

async function loadSupplierProducts(id) {
  try {
    selectedSupplierId = Number(id);
    renderSuppliersTable();

    const supplier = supplierDirectory.find((item) => Number(item.id) === Number(id));
    const products = await API.get(`/api/suppliers/${id}/products`);
    const panel = document.getElementById("supplierProductsPanel");
    if (!panel) return;

    panel.innerHTML = `
      <div class="supplier-block">
        <div class="supplier-block-header">
          <div>
            <h4>${escapeHtml(supplier?.company_name || "Supplier")}</h4>
            <div class="supplier-meta">
              <span>${escapeHtml(supplier?.contact_person || "No contact listed")}</span>
              <span>${escapeHtml(supplier?.phone || "No phone")}</span>
              <span>${escapeHtml(supplier?.email || "No email")}</span>
            </div>
          </div>
          <span class="badge ${badgeClassForStatus(supplier?.status || "active")}">${escapeHtml((supplier?.status || "active").toString())}</span>
        </div>
      </div>

      ${
        products.length === 0
          ? '<div class="empty-state">This supplier has no linked products yet.</div>'
          : `
          <div class="supplier-product-table-wrapper">
            <table class="supplier-product-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Current Stock</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Mapping</th>
                  <th>Low Stock Point</th>
                </tr>
              </thead>
              <tbody>
                ${products
                  .map(
                    (product) => `
                    <tr>
                      <td>
                        <strong>${escapeHtml(product.product_name)}</strong>
                      </td>
                      <td>${Number(product.stock || 0)}</td>
                      <td>${escapeHtml(product.category || "Other")}</td>
                      <td><span class="badge ${badgeClassForStatus(product.stock_status)}">${escapeHtml(product.stock_status)}</span></td>
                      <td><span class="badge ${product.is_active ? "success" : "danger"}" style="font-size:10px;">${product.is_active ? "Active" : "Inactive"}</span></td>
                      <td>${Number(product.reorder_point || 0)}</td>
                    </tr>
                  `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        `
      }
    `;
  } catch (err) {
    console.error("Failed to load supplier products:", err);
    renderEmptySupplierState("Could not load supplier products.");
  }
}

async function loadSuppliers() {
  try {
    supplierDirectory = await API.get("/api/suppliers");
    renderSuppliersTable();

    const filtered = getFilteredSuppliers();
    if (filtered.length === 0) {
      renderEmptySupplierState("No suppliers match your search.");
      return;
    }

    const supplierToLoad =
      filtered.find((supplier) => Number(supplier.id) === Number(selectedSupplierId)) ||
      filtered[0];
    await loadSupplierProducts(supplierToLoad.id);
  } catch (err) {
    console.error("Failed to load suppliers:", err);
  }
}

// Initialize search event listener
document.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("supplierSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      renderSuppliersTable();
    });
  }
});

window.getFilteredSuppliers = getFilteredSuppliers;
window.renderEmptySupplierState = renderEmptySupplierState;
window.renderSuppliersTable = renderSuppliersTable;
window.loadSupplierProducts = loadSupplierProducts;
window.loadSuppliers = loadSuppliers;
