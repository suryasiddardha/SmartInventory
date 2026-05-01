// Feature module: inventory, orders, and form helpers.

window.editingInventoryItemId = null;
window.editingInventoryCurrentStock = 0;
let inventoryDirectory = [];

function getFilteredInventoryItems() {
  const query = (document.getElementById("inventorySearchInput")?.value || "").trim().toLowerCase();
  if (!query) return inventoryDirectory;

  return inventoryDirectory.filter((item) => {
    const searchable = [
      `INV-${String(item.id).padStart(3, "0")}`,
      item.product_name,
      item.category,
      item.supplier?.company_name,
      item.supplier?.status,
      item.stock,
      item.low_stock_point,
      item.price,
      item.status,
    ]
      .filter((value) => value !== undefined && value !== null)
      .join(" ")
      .toLowerCase();

    return searchable.includes(query);
  });
}

function renderInventoryTable(items, emptyMessage = "No inventory items found.") {
  const tbody = document.getElementById("inventoryTableBody");
  if (!tbody) return;

  tbody.innerHTML =
    items.length === 0
      ? `<tr><td colspan="9" style="text-align:center;color:var(--text-muted)">${escapeHtml(emptyMessage)}</td></tr>`
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
            const supplierCount = Number(i.supplier_count || 0);
            const supplierBadge = supplierCount > 1
              ? `<span class="badge-suppliers" onclick="viewAlternativeSuppliers(${i.id}, '${escapeHtml(i.product_name).replace(/'/g, "\\'")}'); event.stopPropagation();" style="cursor:pointer;" title="View ${supplierCount} suppliers">${supplierCount} suppliers</span>`
              : "";

            const canEdit = isAdmin() || isManager();
            const editAction = canEdit
              ? `<button class="btn-icon btn-edit" type="button" onclick="openInventoryItemForEdit(${i.id})" title="Edit Item">Edit</button>`
              : `<span style="color:var(--text-muted);font-size:12px;">View only</span>`;

            return `<tr>
                  <td>#INV-${String(i.id).padStart(3, "0")}</td>
                  <td>${escapeHtml(i.product_name)}</td>
                  <td>${escapeHtml(i.category || "Other")}</td>
                  <td>
                    <div style="display:flex; flex-direction:column; gap:4px;">
                      <div style="display:flex; align-items:center; gap:8px;">
                        <span>${escapeHtml(i.supplier?.company_name || "Unassigned")}</span>
                        ${supplierBadge}
                      </div>
                      ${i.supplier?.status ? `<span class="badge ${badgeClassForStatus(i.supplier.status)}" style="width:fit-content; font-size:10px; padding:2px 8px;">${i.supplier.status.charAt(0).toUpperCase() + i.supplier.status.slice(1)}</span>` : ""}
                    </div>
                  </td>
                  <td>${i.stock}</td>
                  <td>${i.low_stock_point ?? "Auto"}</td>
                  <td>${formatCurrency(i.price, "INR")}</td>
                  <td><span class="badge ${badgeClass}">${label}</span></td>
                  <td>
                    <div class="supplier-actions">
                      ${editAction}
                    </div>
                  </td>
                </tr>`;
          })
          .join("");
}

function getInventoryFormElements() {
  return {
    form: document.getElementById("itemForm"),
    submitBtn: document.getElementById("itemFormSubmitBtn"),
    feedback: document.getElementById("itemFormFeedback"),
    idDisplay: document.getElementById("itemIdDisplay"),
    productName: document.getElementById("itemProductName"),
    category: document.getElementById("itemCategory"),
    supplier: document.getElementById("itemSupplier"),
    stock: document.getElementById("itemStock"),
    price: document.getElementById("itemPrice"),
    expiryDate: document.getElementById("itemExpiryDate"),
    reorderLevel: document.getElementById("itemReorderLevel"),
    description: document.getElementById("itemDescription"),
  };
}

function clearInventoryFormFeedback() {
  const feedback = document.getElementById("itemFormFeedback");
  if (!feedback) return;
  feedback.style.display = "none";
  feedback.textContent = "";
}

function setInventoryFormFeedback(message, type = "info") {
  const feedback = document.getElementById("itemFormFeedback");
  if (!feedback) return;

  const palette = {
    success: "rgba(52, 211, 153, 0.12)",
    error: "rgba(251, 113, 133, 0.12)",
    info: "rgba(245, 158, 11, 0.12)",
  };

  feedback.style.display = "block";
  feedback.style.padding = "12px 14px";
  feedback.style.borderRadius = "14px";
  feedback.style.border = "1px solid rgba(148, 163, 184, 0.14)";
  feedback.style.background = palette[type] || palette.info;
  feedback.style.color = "var(--text)";
  feedback.textContent = message;
}

function setInventoryFormMode(item = null) {
  const { submitBtn, idDisplay, stock } = getInventoryFormElements();
  const stockLabel = document.getElementById("itemStockLabel");
  window.editingInventoryItemId = item?.id ? Number(item.id) : null;
  window.editingInventoryCurrentStock = item?.stock ? Number(item.stock) : 0;

  if (idDisplay) {
    idDisplay.value = window.editingInventoryItemId
      ? `#INV-${String(window.editingInventoryItemId).padStart(3, "0")}`
      : "";
  }

  if (submitBtn) {
    submitBtn.textContent = window.editingInventoryItemId
      ? "Update Item"
      : "Save Item";
  }

  if (stockLabel) {
    stockLabel.textContent = window.editingInventoryItemId
      ? `Add Stock Quantity (available: ${window.editingInventoryCurrentStock})`
      : "Stock Quantity";
  }

  if (stock) {
    stock.placeholder = window.editingInventoryItemId
      ? "Enter quantity to add"
      : "Enter quantity";
  }
}

function populateInventoryForm(item) {
  const elements = getInventoryFormElements();
  if (!elements.form || !item) return;

  elements.productName.value = item.product_name || "";
  elements.category.value = item.category || "";
  elements.supplier.value = item.supplier?.id || item.supplier_id || "";
  elements.stock.value = "0";
  elements.price.value = item.price ?? "";
  elements.expiryDate.value = item.expiry_date
    ? String(item.expiry_date).slice(0, 10)
    : "";
  elements.reorderLevel.value = item.low_stock_point ?? "";
  elements.description.value = item.description || "";
  clearInventoryFormFeedback();
  setInventoryFormMode(item);
  elements.form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function openInventoryItemForEdit(id) {
  try {
    const item = await API.get(`/api/inventory/${id}`);
    populateInventoryForm(item);
  } catch (err) {
    showToast(err.message || "Failed to load item.", "error");
  }
}

function resetInventoryFormMode() {
  window.editingInventoryItemId = null;
  window.editingInventoryCurrentStock = 0;
  setInventoryFormMode(null);
  clearInventoryFormFeedback();
}

async function loadInventory() {
  try {
    inventoryDirectory = await API.get("/api/inventory");
    const items = getFilteredInventoryItems();
    renderInventoryTable(
      items,
      inventoryDirectory.length === 0 ? "No inventory items found." : "No items match your search.",
    );
  } catch (err) {
    console.error("Failed to load inventory:", err);
  }
}

async function loadItemFormSuppliers() {
  try {
    const suppliers = await API.get("/api/suppliers");
    const select = document.getElementById("itemSupplier");
    if (!select) return;
    const active = suppliers.filter((s) => s.status !== "inactive");
    select.innerHTML =
      '<option value="" disabled selected>Select supplier</option>' +
      active.map((s) => `<option value="${s.id}">${escapeHtml(s.company_name)}</option>`).join("");
  } catch (err) {
    const select = document.getElementById("itemSupplier");
    if (select) select.innerHTML = '<option value="" disabled selected>Could not load suppliers</option>';
  }
}

async function viewAlternativeSuppliers(inventoryId, productName) {
  try {
    const data = await API.get(`/api/inventory/${inventoryId}/alternative-suppliers?t=${Date.now()}`);
    const modal = document.getElementById("suppliersModal");
    const content = document.getElementById("suppliersModalContent");
    
    if (!modal || !content) return;

    const canEdit = isAdmin() || isManager();

    const suppliersHtml = data.alternatives.length === 0
      ? '<div style="padding:20px; text-align:center; color:var(--text-muted)">No alternative suppliers available</div>'
      : `
        <table style="width:100%; border-collapse:collapse;">
          <thead style="background:var(--bg-secondary); border-bottom:1px solid var(--border);">
            <tr>
              <th style="padding:12px; text-align:left; font-weight:600;">Supplier</th>
              <th style="padding:12px; text-align:right; font-weight:600;">Unit Cost</th>
              <th style="padding:12px; text-align:right; font-weight:600;">Stock</th>
              <th style="padding:12px; text-align:right; font-weight:600;">Lead Time</th>
              <th style="padding:12px; text-align:center; font-weight:600;">Status</th>
              ${canEdit ? '<th style="padding:12px; text-align:center; font-weight:600;"></th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${data.alternatives.map(s => `
              <tr style="border-bottom:1px solid var(--border); ${s.is_current ? 'background:rgba(52,211,153,0.08);' : ''}">
                <td style="padding:12px;">
                  <div>
                    <strong>${escapeHtml(s.company_name)}</strong>
                    ${s.is_current ? ' <span style="background:#34d399; color:#fff; padding:2px 6px; border-radius:3px; font-size:11px; font-weight:600;">Current</span>' : ''}
                    ${s.is_preferred ? ' <span style="background:#3b82f6; color:#fff; padding:2px 6px; border-radius:3px; font-size:11px; font-weight:600;">Preferred</span>' : ''}
                  </div>
                  <small style="color:var(--text-muted);">${escapeHtml(s.contact_person || '-')}</small>
                </td>
                <td style="padding:12px; text-align:right;" id="cost-cell-${inventoryId}-${s.id}">
                  <span class="static-val"><strong>${formatCurrency(s.unit_cost, 'INR')}</strong></span>
                  <input type="number" class="edit-input" value="${s.unit_cost}" style="display:none; width:80px; padding:4px; text-align:right;">
                </td>
                <td style="padding:12px; text-align:right;" id="stock-cell-${inventoryId}-${s.id}">
                  <span class="static-val">${s.stock !== undefined ? s.stock : '-'}</span>
                  <input type="number" class="edit-input" value="${s.stock}" style="display:none; width:60px; padding:4px; text-align:right;">
                </td>
                <td style="padding:12px; text-align:right;">
                  <span>${s.lead_time_days} days</span>
                </td>
                <td style="padding:12px; text-align:center;">
                  <span class="badge ${badgeClassForStatus(s.status || 'active')}" style="font-size:12px; padding:4px 10px;">
                    ${(s.status || 'active').charAt(0).toUpperCase() + (s.status || 'active').slice(1)}
                  </span>
                </td>
                ${canEdit ? `
                <td style="padding:12px; text-align:center;">
                  <div style="display:flex; gap:6px; justify-content:center;">
                    <button class="btn-edit-sp" onclick="toggleEditSP(${inventoryId}, ${s.id})" title="Edit stock/price" style="background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.3); padding:4px 8px; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600;">Edit</button>
                    <button class="btn-save-sp" onclick="saveSP(${inventoryId}, ${s.id})" title="Save changes" style="display:none; background:rgba(16,185,129,0.15); color:#34d399; border:1px solid rgba(16,185,129,0.3); padding:4px 8px; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600;">Save</button>
                    <button onclick="removeSupplier(${inventoryId}, ${s.id}); event.stopPropagation();" title="Remove supplier" style="background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3); padding:4px 8px; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600;">Remove</button>
                  </div>
                </td>` : ''}
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

    content.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <div>
          <h3 style="margin:0; font-size:18px;">${escapeHtml(productName)}</h3>
          <p style="margin:4px 0 0 0; color:var(--text-muted); font-size:13px;">Available from ${data.alternatives.length} supplier${data.alternatives.length !== 1 ? 's' : ''}</p>
        </div>
        <div style="display:flex; gap:8px;">
          ${canEdit ? `<button onclick="openAddSupplierForm(${inventoryId}, '${escapeHtml(productName).replace(/'/g, "\\'")}'); event.stopPropagation();" style="background:#3b82f6; color:#fff; border:none; padding:8px 14px; border-radius:8px; cursor:pointer; font-size:12px; font-weight:600;">+ Add Supplier</button>` : ''}
          <button onclick="document.getElementById('suppliersModal').style.display='none'" style="background:none; border:none; font-size:24px; cursor:pointer; color:var(--text-muted);">×</button>
        </div>
      </div>
      ${suppliersHtml}
    `;

    modal.style.display = 'flex';
  } catch (err) {
    showToast(err.message || 'Failed to load suppliers', 'error');
  }
}

function toggleEditSP(invId, suppId) {
  const row = document.querySelector(`#cost-cell-${invId}-${suppId}`).parentElement;
  const staticVals = row.querySelectorAll('.static-val');
  const inputs = row.querySelectorAll('.edit-input');
  const editBtn = row.querySelector('.btn-edit-sp');
  const saveBtn = row.querySelector('.btn-save-sp');

  staticVals.forEach(v => v.style.display = 'none');
  inputs.forEach(i => i.style.display = 'inline-block');
  editBtn.style.display = 'none';
  saveBtn.style.display = 'inline-block';
}

async function saveSP(invId, suppId) {
  const row = document.querySelector(`#cost-cell-${invId}-${suppId}`).parentElement;
  const costInput = row.querySelector(`#cost-cell-${invId}-${suppId} .edit-input`);
  const stockInput = row.querySelector(`#stock-cell-${invId}-${suppId} .edit-input`);
  
  try {
    await API.put(`/api/inventory/${invId}/suppliers/${suppId}`, {
      unit_cost: costInput.value,
      stock: stockInput.value
    });
    
    showToast('Supplier stock updated!', 'success');
    
    // Refresh modal to show updated values
    const productName = document.querySelector('#suppliersModalContent h3').textContent;
    await viewAlternativeSuppliers(invId, productName);
    
    // Also refresh inventory table in background
    if (typeof loadInventory === 'function') loadInventory();
    if (typeof loadOrderInventoryOptions === 'function') loadOrderInventoryOptions();
    
  } catch (err) {
    showToast(err.message || 'Update failed', 'error');
  }
}

async function openAddSupplierForm(inventoryId, productName) {
  try {
    const suppliers = await API.get("/api/suppliers");
    const [currentData] = await Promise.all([API.get(`/api/inventory/${inventoryId}/alternative-suppliers`)]);
    const linkedSupplierIds = currentData.alternatives.map(s => s.id);

    // Filter out already linked suppliers
    const available = suppliers.filter(s => !linkedSupplierIds.includes(s.id) && s.status !== 'inactive');

    if (available.length === 0) {
      showToast("All suppliers are already linked to this product.", "info");
      return;
    }

    const content = document.getElementById("suppliersModalContent");
    content.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <div>
          <h3 style="margin:0; font-size:18px;">Add Alternative Supplier</h3>
          <p style="margin:4px 0 0 0; color:var(--text-muted); font-size:13px;">Link ${escapeHtml(productName)} to another supplier</p>
        </div>
        <button onclick="document.getElementById('suppliersModal').style.display='none'" style="background:none; border:none; font-size:24px; cursor:pointer; color:var(--text-muted);">×</button>
      </div>

      <form onsubmit="handleAddSupplier(event, ${inventoryId})" style="display:flex; flex-direction:column; gap:16px;">
        <div>
          <label style="display:block; margin-bottom:8px; font-size:13px; color:var(--text-muted); font-weight:600;">Select Supplier</label>
          <select id="addSupplierSelect" required style="width:100%; padding:10px 12px; background:var(--primary-light); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:14px;">
            <option value="">Choose a supplier...</option>
            ${available.map(s => `<option value="${s.id}">${escapeHtml(s.company_name)}</option>`).join('')}
          </select>
        </div>

        <div>
          <label style="display:block; margin-bottom:8px; font-size:13px; color:var(--text-muted); font-weight:600;">Unit Cost (₹)</label>
          <input type="number" id="addSupplierCost" step="0.01" min="0" required placeholder="0.00" style="width:100%; padding:10px 12px; background:var(--primary-light); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:14px;">
        </div>

        <div style="display:flex; gap:10px; margin-top:10px;">
          <button type="submit" style="flex:1; padding:10px 16px; background:linear-gradient(135deg, var(--accent) 0%, var(--accent-dark) 100%); color:var(--primary); border:none; border-radius:8px; cursor:pointer; font-weight:600;">Add Supplier</button>
          <button type="button" onclick="document.getElementById('suppliersModal').style.display='none'" style="flex:1; padding:10px 16px; background:var(--primary-light); color:var(--text); border:1px solid var(--border); border-radius:8px; cursor:pointer; font-weight:600;">Cancel</button>
        </div>
      </form>
    `;

    document.getElementById("suppliersModal").style.display = 'flex';
  } catch (err) {
    showToast(err.message || 'Failed to load suppliers', 'error');
  }
}

async function handleAddSupplier(event, inventoryId) {
  event.preventDefault();
  try {
    const supplierId = Number(document.getElementById("addSupplierSelect").value);
    const unitCost = Number(document.getElementById("addSupplierCost").value);

    if (!supplierId || unitCost < 0) {
      showToast("Please fill all fields correctly.", "error");
      return;
    }

    await API.post(`/api/inventory/${inventoryId}/suppliers`, {
      supplier_id: supplierId,
      unit_cost: unitCost,
    });

    showToast("Supplier added successfully!", "success");
    document.getElementById("suppliersModal").style.display = 'none';
    await loadInventory();
  } catch (err) {
    showToast(err.message || 'Failed to add supplier', 'error');
  }
}

async function removeSupplier(inventoryId, supplierId) {
  if (!confirm("Remove this supplier option? The product will still exist.")) {
    return;
  }

  try {
    await API.delete(`/api/inventory/${inventoryId}/suppliers/${supplierId}`);
    showToast("Supplier removed successfully!", "success");
    await viewAlternativeSuppliers(inventoryId, '');
  } catch (err) {
    showToast(err.message || 'Failed to remove supplier', 'error');
  }
}

window.loadInventory = loadInventory;
window.getFilteredInventoryItems = getFilteredInventoryItems;
window.renderInventoryTable = renderInventoryTable;
window.loadItemFormSuppliers = loadItemFormSuppliers;
window.openInventoryItemForEdit = openInventoryItemForEdit;
window.resetInventoryFormMode = resetInventoryFormMode;
window.setInventoryFormMode = setInventoryFormMode;
window.viewAlternativeSuppliers = viewAlternativeSuppliers;
window.openAddSupplierForm = openAddSupplierForm;
window.handleAddSupplier = handleAddSupplier;
window.removeSupplier = removeSupplier;

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("inventorySearchInput")?.addEventListener("input", () => {
    if (inventoryDirectory.length > 0) {
      renderInventoryTable(getFilteredInventoryItems(), "No items match your search.");
    }
  });
});
