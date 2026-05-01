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
            const canDelete = isAdmin();
            
            const deleteAction = canDelete
              ? `<button class="btn-icon btn-delete" type="button" onclick="deleteInventoryItem(${i.id}, '${escapeHtml(i.product_name).replace(/'/g, "\\'")}')" title="Delete Item" style="background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3); padding:4px 8px; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600; margin-left:4px;">Delete</button>`
              : "";

            const editAction = canEdit
              ? `
                <button class="btn-icon btn-restock" type="button" onclick="openRestockModal(${i.id}, '${escapeHtml(i.product_name).replace(/'/g, "\\'")}')"
                  title="Restock Item"
                  style="background:rgba(16,185,129,0.15); color:#34d399; border:1px solid rgba(16,185,129,0.3); padding:4px 8px; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600; margin-right:4px;">Restock</button>
                <button type="button" onclick="openBatchManager(${i.id}, '${escapeHtml(i.product_name).replace(/'/g, "\\'")}')"
                  title="View stock batches — see which stock sells next and fix any mistakes"
                  style="background:rgba(139,92,246,0.15); color:#a78bfa; border:1px solid rgba(139,92,246,0.3); padding:4px 8px; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600; margin-right:4px;">📦 Batches</button>
                ${deleteAction}
              `
              : `<span style="color:var(--text-muted);font-size:12px;">View only</span>`;

            return `<tr>
                  <td>#INV-${String(i.id).padStart(3, "0")}</td>
                  <td>${escapeHtml(i.product_name)}</td>
                  <td>${escapeHtml(i.category || "Other")}</td>
                  <td>
                    <div style="display:flex; flex-direction:column; gap:4px;">
                      <div style="display:flex; align-items:center; gap:8px;">
                        <span onclick="viewAlternativeSuppliers(${i.id}, '${escapeHtml(i.product_name).replace(/'/g, "\\'")}')" style="cursor:pointer; color:var(--accent); text-decoration:underline; font-weight:600;" title="View purchase costs and stock details">${escapeHtml(i.supplier?.company_name || "Unassigned")}</span>
                        ${supplierBadge}
                      </div>
                      ${i.supplier?.status ? `<span class="badge ${badgeClassForStatus(i.supplier.status)}" style="width:fit-content; font-size:10px; padding:2px 8px;">${i.supplier.status.charAt(0).toUpperCase() + i.supplier.status.slice(1)}</span>` : ""}
                    </div>
                  </td>
                  <td>${i.stock}</td>
                  <td>${i.low_stock_point ?? "Auto"}</td>
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
    unitCost: document.getElementById("itemUnitCost"),
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
  
  if (window.isReviewingPendingItem) {
    window.editingInventoryCurrentStock = 0; // Prevent doubling stock when approving
  }

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
  
  if (window.isReviewingPendingItem) {
    elements.stock.value = item.stock || "0";
  } else {
    elements.stock.value = "0";
  }
  
  elements.price.value = item.price ?? "";
  elements.unitCost.value = item.all_suppliers?.[0]?.unit_cost || item.unit_cost || "";
  elements.expiryDate.value = item.expiry_date
    ? String(item.expiry_date).slice(0, 10)
    : "";
  elements.reorderLevel.value = item.low_stock_point ?? "";
  elements.description.value = item.description || "";
  clearInventoryFormFeedback();
  setInventoryFormMode(item);
  
  // If reviewing pending item, disable all fields except selling price
  if (window.isReviewingPendingItem) {
    elements.productName.disabled = true;
    elements.category.disabled = true;
    elements.supplier.disabled = true;
    elements.stock.disabled = true;
    elements.unitCost.disabled = true;
    elements.expiryDate.disabled = true;
    elements.reorderLevel.disabled = true;
    elements.description.disabled = true;
    elements.price.disabled = false; // Only price is editable
    
    // Update labels to reflect review mode
    const stockLabel = document.getElementById("itemStockLabel");
    if (stockLabel) stockLabel.textContent = "Requested Stock Quantity";
    
    const submitBtn = document.getElementById("itemFormSubmitBtn");
    if (submitBtn) submitBtn.textContent = "Update & Approve Item";
  }
  
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
  window.isReviewingPendingItem = false;
  
  // Re-enable all fields just in case they were disabled
  const elements = getInventoryFormElements();
  if (elements.form) {
    elements.productName.disabled = false;
    elements.category.disabled = false;
    elements.supplier.disabled = false;
    elements.stock.disabled = false;
    elements.unitCost.disabled = false;
    elements.expiryDate.disabled = false;
    elements.reorderLevel.disabled = false;
    elements.description.disabled = false;
    elements.price.disabled = false;
  }
  
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
              <th style="padding:12px; text-align:right; font-weight:600;">Purchase Cost</th>
              <th style="padding:12px; text-align:right; font-weight:600;">Selling Price</th>
              <th style="padding:12px; text-align:right; font-weight:600;">Stock</th>
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
                  <span class="static-val"><strong>${formatCurrency(s.purchase_cost || s.unit_cost, 'INR')}</strong></span>
                  <input type="number" class="edit-input edit-cost" value="${s.purchase_cost || s.unit_cost}" style="display:none; width:80px; padding:4px; text-align:right;">
                </td>
                <td style="padding:12px; text-align:right;" id="sp-cell-${inventoryId}-${s.id}">
                  <span class="static-val"><strong>${formatCurrency(s.selling_price, 'INR')}</strong></span>
                  <input type="number" class="edit-input edit-sp" value="${s.selling_price}" style="display:none; width:80px; padding:4px; text-align:right;">
                </td>
                <td style="padding:12px; text-align:right;" id="stock-cell-${inventoryId}-${s.id}">
                  <span class="static-val">${s.stock !== undefined ? s.stock : '-'}</span>
                  <input type="number" class="edit-input" value="${s.stock}" style="display:none; width:60px; padding:4px; text-align:right;">
                </td>
                <td style="padding:12px; text-align:center;">
                  <span class="badge ${badgeClassForStatus(s.status || 'active')}" style="font-size:12px; padding:4px 10px;">
                    ${(s.status || 'active').charAt(0).toUpperCase() + (s.status || 'active').slice(1)}
                  </span>
                </td>
                ${canEdit ? `
                <td style="padding:12px; text-align:center;">
                  <div style="display:flex; gap:6px; justify-content:center;">
                    <button class="btn-edit-sp" onclick="toggleEditSP(${inventoryId}, ${s.id})" title="Adjust stock or correct prices" style="background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.3); padding:4px 8px; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600;">Adjust</button>
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
  const costInput = row.querySelector(`#cost-cell-${invId}-${suppId} .edit-cost`);
  const spInput = row.querySelector(`#sp-cell-${invId}-${suppId} .edit-sp`);
  const stockInput = row.querySelector(`#stock-cell-${invId}-${suppId} .edit-input`);
  
  try {
    await API.put(`/api/inventory/${invId}/suppliers/${suppId}`, {
      unit_cost: costInput.value,
      selling_price: spInput.value,
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

async function openRestockModal(inventoryId, productName) {
  try {
    const item = await API.get(`/api/inventory/${inventoryId}`);
    const modal = document.getElementById("suppliersModal"); // Reuse the modal container
    const content = document.getElementById("suppliersModalContent");
    
    if (!modal || !content) return;

    // Get all suppliers for this product to choose from
    const suppliers = item.all_suppliers || [];

    if (suppliers.length === 0) {
      content.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
          <h3 style="margin:0; font-size:18px;">Restock Item</h3>
          <button onclick="document.getElementById('suppliersModal').style.display='none'" style="background:none; border:none; font-size:24px; cursor:pointer; color:var(--text-muted);">×</button>
        </div>
        <div style="padding:40px 20px; text-align:center;">
          <div style="font-size:40px; margin-bottom:15px;">⚠️</div>
          <p style="margin:0; color:var(--text); font-weight:600;">No Suppliers Linked</p>
          <p style="margin:8px 0 20px 0; color:var(--text-muted); font-size:13px;">You must link at least one supplier to <strong>${escapeHtml(productName)}</strong> before you can restock it.</p>
          <button onclick="viewAlternativeSuppliers(${inventoryId}, '${escapeHtml(productName).replace(/'/g, "\\'")}')" style="background:#3b82f6; color:#fff; border:none; padding:10px 20px; border-radius:8px; cursor:pointer; font-weight:600;">Link a Supplier Now</button>
        </div>
      `;
      modal.style.display = 'flex';
      return;
    }
    
    content.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <div>
          <h3 style="margin:0; font-size:18px;">Restock Item</h3>
          <p style="margin:4px 0 0 0; color:var(--text-muted); font-size:13px;">Calculate Weighted Average Cost for <strong>${escapeHtml(productName)}</strong></p>
        </div>
        <button onclick="document.getElementById('suppliersModal').style.display='none'" style="background:none; border:none; font-size:24px; cursor:pointer; color:var(--text-muted);">×</button>
      </div>

      <form onsubmit="handleRestock(event, ${inventoryId})" style="display:flex; flex-direction:column; gap:16px;">
        <div>
          <label style="display:block; margin-bottom:8px; font-size:13px; color:var(--text-muted); font-weight:600;">Supplier</label>
          <select id="restockSupplier" required style="width:100%; padding:10px 12px; background:var(--primary-light); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:14px;">
            ${suppliers.map(s => `<option value="${s.id}">${escapeHtml(s.company_name)} (Current Cost: ₹${s.unit_cost})</option>`).join('')}
          </select>
        </div>

        <div>
          <label style="display:block; margin-bottom:8px; font-size:13px; color:var(--text-muted); font-weight:600;">Quantity Received</label>
          <input type="number" id="restockQty" min="1" required placeholder="0" style="width:100%; padding:10px 12px; background:var(--primary-light); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:14px;">
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
          <div>
            <label style="display:block; margin-bottom:8px; font-size:13px; color:var(--text-muted); font-weight:600;">Purchase Cost (P.C)</label>
            <input type="number" id="restockCost" step="0.01" min="0" required placeholder="0.00" style="width:100%; padding:10px 12px; background:var(--primary-light); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:14px;">
          </div>
          <div>
            <label style="display:block; margin-bottom:8px; font-size:13px; color:var(--text-muted); font-weight:600;">Selling Price (S.P)</label>
            <input type="number" id="restockSellingPrice" step="0.01" min="0" required placeholder="0.00" style="width:100%; padding:10px 12px; background:var(--primary-light); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:14px;">
          </div>
        </div>

        <div>
          <label style="display:block; margin-bottom:8px; font-size:13px; color:var(--text-muted); font-weight:600;">Batch Expiry Date</label>
          <input type="date" id="restockExpiry" style="width:100%; padding:10px 12px; background:var(--primary-light); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:14px;">
        </div>

        <div style="display:flex; gap:10px; margin-top:10px;">
          <button type="submit" style="flex:1; padding:10px 16px; background:linear-gradient(135deg, var(--accent) 0%, var(--accent-dark) 100%); color:var(--primary); border:none; border-radius:8px; cursor:pointer; font-weight:600;">Add Batch</button>
          <button type="button" onclick="document.getElementById('suppliersModal').style.display='none'" style="flex:1; padding:10px 16px; background:var(--primary-light); color:var(--text); border:1px solid var(--border); border-radius:8px; cursor:pointer; font-weight:600;">Cancel</button>
        </div>
      </form>
    `;

    modal.style.display = 'flex';
  } catch (err) {
    showToast(err.message || 'Failed to load restock data', 'error');
  }
}

function updateWACPreview() {
  // Deprecated: Kept for compatibility if called, but not used since we switched to Batches
}

async function handleRestock(event, inventoryId) {
  event.preventDefault();
  const supplierId = document.getElementById("restockSupplier").value;
  const quantity = document.getElementById("restockQty").value;
  const unit_cost = document.getElementById("restockCost").value;
  const selling_price = document.getElementById("restockSellingPrice").value;

  try {
    await API.post(`/api/inventory/${inventoryId}/restock`, {
      supplier_id: supplierId,
      quantity,
      unit_cost,
      selling_price,
      expiry_date: document.getElementById("restockExpiry").value || null
    });

    showToast("New batch added successfully!", "success");
    document.getElementById("suppliersModal").style.display = 'none';
    loadInventory();
  } catch (err) {
    showToast(err.message || "Restock failed", "error");
  }
}

async function deleteInventoryItem(inventoryId, productName) {
  if (!confirm(`Are you sure you want to completely delete "${productName}" (ID: #INV-${String(inventoryId).padStart(3, "0")})?\n\nWARNING: This cannot be undone.`)) {
    return;
  }

  try {
    const res = await API.delete(`/api/inventory/${inventoryId}`);
    showToast(res.message || "Item deleted successfully.", "success");
    loadInventory();
  } catch (err) {
    // Show the specific backend error, such as the ER_ROW_IS_REFERENCED_2 warning
    showToast(err.message || "Failed to delete item.", "error");
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
window.openRestockModal = openRestockModal;
window.handleRestock = handleRestock;
window.updateWACPreview = updateWACPreview;
window.deleteInventoryItem = deleteInventoryItem;

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("inventorySearchInput")?.addEventListener("input", () => {
    if (inventoryDirectory.length > 0) {
      renderInventoryTable(getFilteredInventoryItems(), "No items match your search.");
    }
  });
});

// ============================================================
// BATCH MANAGER
// ============================================================

let batchManagerInventoryId = null;

async function openBatchManager(inventoryId, productName) {
  batchManagerInventoryId = inventoryId;
  const modal = document.getElementById("batchManagerModal");
  const content = document.getElementById("batchManagerContent");
  if (!modal || !content) return;

  content.innerHTML = `<div style="padding:32px; text-align:center; color:var(--text-muted);">Loading batches…</div>`;
  modal.style.display = "flex";

  try {
    const data = await API.get(`/api/inventory/${inventoryId}/batches`);
    renderBatchManager(data, inventoryId, productName);
  } catch (err) {
    content.innerHTML = `<div style="padding:32px; text-align:center; color:var(--danger);">Failed to load batches: ${escapeHtml(err.message)}</div>`;
  }
}

function renderBatchManager(data, inventoryId, productName) {
  const content = document.getElementById("batchManagerContent");
  const batches = data.batches || [];

  // Group batches by supplier
  const bySupplier = {};
  for (const b of batches) {
    if (!bySupplier[b.supplier_name]) bySupplier[b.supplier_name] = [];
    bySupplier[b.supplier_name].push(b);
  }

  const supplierSections = Object.entries(bySupplier).map(([supplierName, supBatches]) => {
    const rows = supBatches.map((b, idx) => {
      const consumed = b.current_stock === 0;
      const isNext = b.is_next_fifo;
      const rowBg = consumed
        ? "background:#0d1a26;"
        : isNext
          ? "background:#16203a;"
          : "background:#0f1c2e;";

      const consumed_qty = b.initial_stock - b.current_stock;
      const pct = b.initial_stock > 0 ? Math.round((b.current_stock / b.initial_stock) * 100) : 0;

      return `
        <tr id="batch-row-${b.id}" style="${rowBg} border-bottom:1px solid var(--border);">
          <td style="padding:12px 16px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <strong style="color:var(--text-muted); font-size:12px;">#B-${String(b.id).padStart(4,"0")}</strong>
              ${isNext ? `<span style="background:rgba(139,92,246,0.2); color:#a78bfa; border:1px solid rgba(139,92,246,0.4); font-size:10px; padding:2px 7px; border-radius:20px; font-weight:700;" title="This stock will be sold first when an order is placed">⬅ Sells next</span>` : ""}
              ${consumed ? `<span style="background:rgba(107,114,128,0.15); color:#9ca3af; font-size:10px; padding:2px 7px; border-radius:20px;" title="All units from this batch have been sold">✓ All sold</span>` : ""}
            </div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">
              Received: ${new Date(b.received_at).toLocaleDateString("en-IN", {day:"2-digit", month:"short", year:"numeric"})}
            </div>
            ${b.expiry_date ? `
            <div style="font-size:11px; color:${new Date(b.expiry_date) < new Date() ? '#f87171' : 'var(--text-muted)'}; margin-top:2px;">
              Expiry: <span class="batch-static-${b.id}-ex">${new Date(b.expiry_date).toLocaleDateString("en-IN", {day:"2-digit", month:"short", year:"numeric"})}</span>
              <input type="date" class="batch-input-${b.id}-ex" value="${b.expiry_date.split('T')[0]}" style="display:none; padding:2px 4px; background:#1e2d3d; border:1px solid #374151; border-radius:4px; color:#e2e8f0; font-size:10px;">
            </div>
            ` : `
            <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
              No Expiry
              <input type="date" class="batch-input-${b.id}-ex" value="" style="display:none; padding:2px 4px; background:#1e2d3d; border:1px solid #374151; border-radius:4px; color:#e2e8f0; font-size:10px;">
            </div>
            `}
          </td>
          <td style="padding:12px 16px; text-align:right; background:inherit;">
            <span class="batch-static-${b.id}-pc">${formatCurrency(b.purchase_cost, "INR")}</span>
            <input type="number" class="batch-input-${b.id}-pc" value="${b.purchase_cost}" style="display:none; width:90px; padding:4px 6px; background:#1e2d3d; border:1px solid #374151; border-radius:6px; color:#e2e8f0; text-align:right;" step="0.01" min="0">
          </td>
          <td style="padding:12px 16px; text-align:right; background:inherit;">
            <span class="batch-static-${b.id}-sp">${formatCurrency(b.selling_price, "INR")}</span>
            <input type="number" class="batch-input-${b.id}-sp" value="${b.selling_price}" style="display:none; width:90px; padding:4px 6px; background:#1e2d3d; border:1px solid #374151; border-radius:6px; color:#e2e8f0; text-align:right;" step="0.01" min="0">
          </td>
          <td style="padding:12px 16px; text-align:center; background:inherit;">
            <div>
              <span class="batch-static-${b.id}-st" style="font-weight:600; font-size:16px;">${b.current_stock}</span>
              <input type="number" class="batch-input-${b.id}-st" value="${b.current_stock}" style="display:none; width:70px; padding:4px 6px; background:#1e2d3d; border:1px solid #374151; border-radius:6px; color:#e2e8f0; text-align:center;" min="0" max="${b.initial_stock}">
              <div style="font-size:10px; color:#64748b; margin-top:2px;">of ${b.initial_stock} &nbsp;·&nbsp; ${consumed_qty} used</div>
              <div style="height:5px; border-radius:4px; background:#1e2d3d; margin-top:5px; overflow:hidden; width:80px; margin-left:auto; margin-right:auto;">
                <div style="height:100%; width:${pct}%; background:${pct > 50 ? "#34d399" : pct > 20 ? "#fbbf24" : "#f87171"}; border-radius:4px;"></div>
              </div>
            </div>
          </td>
          <td style="padding:12px 16px; text-align:center;">
            <div style="display:flex; gap:6px; justify-content:center; flex-wrap:wrap;">
              <button onclick="toggleBatchEdit(${b.id})"
                id="batch-edit-btn-${b.id}"
                style="background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.3); padding:4px 10px; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600;">
                Adjust
              </button>
              <button onclick="saveBatch(${inventoryId}, ${b.id})"
                id="batch-save-btn-${b.id}"
                style="display:none; background:rgba(16,185,129,0.15); color:#34d399; border:1px solid rgba(16,185,129,0.3); padding:4px 10px; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600;">
                Save
              </button>
              <button onclick="cancelBatchEdit(${b.id})"
                id="batch-cancel-btn-${b.id}"
                style="display:none; background:rgba(239,68,68,0.1); color:#f87171; border:1px solid rgba(239,68,68,0.3); padding:4px 10px; border-radius:6px; cursor:pointer; font-size:11px; font-weight:600;">
                Cancel
              </button>
            </div>
          </td>
        </tr>`;
    }).join("");

    return `
      <div style="margin-bottom:8px;">
        <div style="padding:12px 20px; background:var(--bg-secondary); border-bottom:1px solid var(--border); font-weight:700; color:var(--text); font-size:14px; display:flex; align-items:center; gap:8px;">
          <span style="width:8px; height:8px; border-radius:50%; background:#a78bfa; display:inline-block;"></span>
          ${escapeHtml(supplierName)}
          <span style="font-size:12px; color:var(--text-muted); font-weight:400;">(${supBatches.length} batch${supBatches.length > 1 ? "es" : ""})</span>
        </div>
        <table style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="background:var(--bg-secondary); border-bottom:1px solid var(--border);">
              <th style="padding:10px 16px; text-align:left; font-size:12px; color:var(--text-muted); font-weight:600;">Batch / Received</th>
              <th style="padding:10px 16px; text-align:right; font-size:12px; color:var(--text-muted); font-weight:600;">Purchase Cost<br><span style="font-weight:400; font-size:10px; color:#64748b;">What you paid supplier</span></th>
              <th style="padding:10px 16px; text-align:right; font-size:12px; color:var(--text-muted); font-weight:600;">Selling Price<br><span style="font-weight:400; font-size:10px; color:#64748b;">What customer pays</span></th>
              <th style="padding:10px 16px; text-align:center; font-size:12px; color:var(--text-muted); font-weight:600;">Stock Remaining<br><span style="font-weight:400; font-size:10px; color:#64748b;">Units still available</span></th>
              <th style="padding:10px 16px; text-align:center; font-size:12px; color:var(--text-muted); font-weight:600;">Action</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join("");

  content.innerHTML = `
    <div style="padding:20px 24px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between;">
      <div>
        <h2 style="margin:0; font-size:20px; font-weight:700;">${escapeHtml(productName)}</h2>
        <p style="margin:4px 0 0; font-size:13px; color:var(--text-muted);">
          Each row is a delivery of stock. The oldest delivery with remaining units sells first.
        </p>
      </div>
      <button onclick="closeBatchManager()" style="background:none; border:none; font-size:24px; cursor:pointer; color:var(--text-muted); line-height:1;">×</button>
    </div>

    <div style="padding:12px 20px; background:rgba(139,92,246,0.08); border-bottom:1px solid rgba(139,92,246,0.2); display:flex; align-items:center; gap:10px; font-size:13px;">
      <span style="background:#a78bfa; color:#fff; padding:2px 8px; border-radius:20px; font-size:11px; font-weight:700;">⬅ Sells next</span>
      <span style="color:var(--text-muted);">Stock is sold oldest-first. The tagged batch sells before newer ones. Use <strong>Adjust</strong> to fix any wrong numbers.</span>
    </div>

    ${batches.length === 0
      ? `<div style="padding:48px; text-align:center; color:var(--text-muted);">No batches found. Use <strong>Restock</strong> to add your first batch.</div>`
      : supplierSections
    }

    <div style="padding:16px 24px; border-top:1px solid var(--border); text-align:right;">
      <button onclick="closeBatchManager()" style="padding:10px 24px; background:var(--bg-secondary); color:var(--text); border:1px solid var(--border); border-radius:8px; cursor:pointer; font-weight:600; font-size:13px;">Close</button>
    </div>
  `;
}

function toggleBatchEdit(batchId) {
  ["pc", "sp", "st", "ex"].forEach(field => {
    const el = document.querySelector(`.batch-static-${batchId}-${field}`);
    if (el) el.style.display = "none";
    const input = document.querySelector(`.batch-input-${batchId}-${field}`);
    if (input) input.style.display = "inline-block";
  });
  document.getElementById(`batch-edit-btn-${batchId}`).style.display = "none";
  document.getElementById(`batch-save-btn-${batchId}`).style.display = "inline-block";
  document.getElementById(`batch-cancel-btn-${batchId}`).style.display = "inline-block";
}

function cancelBatchEdit(batchId) {
  ["pc", "sp", "st", "ex"].forEach(field => {
    const el = document.querySelector(`.batch-static-${batchId}-${field}`);
    if (el) el.style.display = "inline";
    const input = document.querySelector(`.batch-input-${batchId}-${field}`);
    if (input) input.style.display = "none";
  });
  document.getElementById(`batch-edit-btn-${batchId}`).style.display = "inline-block";
  document.getElementById(`batch-save-btn-${batchId}`).style.display = "none";
  document.getElementById(`batch-cancel-btn-${batchId}`).style.display = "none";
}

async function saveBatch(inventoryId, batchId) {
  const purchase_cost = document.querySelector(`.batch-input-${batchId}-pc`)?.value;
  const selling_price = document.querySelector(`.batch-input-${batchId}-sp`)?.value;
  const current_stock = document.querySelector(`.batch-input-${batchId}-st`)?.value;

  if (purchase_cost === "" || selling_price === "" || current_stock === "") {
    showToast("Please fill in all fields before saving.", "error");
    return;
  }

  try {
    await API.put(`/api/inventory/${inventoryId}/batches/${batchId}`, {
      purchase_cost, selling_price, current_stock,
      expiry_date: document.querySelector(`.batch-input-${batchId}-ex`)?.value || null
    });
    showToast("Batch updated successfully.", "success");

    // Reload batch manager view
    const titleEl = document.querySelector("#batchManagerContent h2");
    const productName = titleEl ? titleEl.textContent : "";
    const data = await API.get(`/api/inventory/${inventoryId}/batches`);
    renderBatchManager(data, inventoryId, productName);

    // Refresh inventory table in background
    if (typeof loadInventory === "function") loadInventory();
  } catch (err) {
    showToast(err.message || "Failed to update batch.", "error");
  }
}

function closeBatchManager() {
  const modal = document.getElementById("batchManagerModal");
  if (modal) modal.style.display = "none";
  batchManagerInventoryId = null;
}

// Close on backdrop click
document.getElementById("batchManagerModal")?.addEventListener("click", function (e) {
  if (e.target === this) closeBatchManager();
});

window.openBatchManager = openBatchManager;
window.closeBatchManager = closeBatchManager;
window.toggleBatchEdit = toggleBatchEdit;
window.cancelBatchEdit = cancelBatchEdit;
window.saveBatch = saveBatch;
