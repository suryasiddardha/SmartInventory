function getDefaultReorderLevel(category = null) {
  return 20;
}

function resolveReorderLevel(reorderPoint = null, category = null) {
  if (reorderPoint !== null && reorderPoint !== undefined && reorderPoint !== "") {
    return Number(reorderPoint);
  }
  return getDefaultReorderLevel(category);
}

function calculateStatus(stock, reorderPoint = null, category = null) {
  const normalizedStock = Number(stock) || 0;
  const threshold = resolveReorderLevel(reorderPoint, category);

  if (normalizedStock <= 0) return "out-of-stock";
  if (normalizedStock <= Math.max(5, Math.round(threshold * 0.35))) return "critical";
  if (normalizedStock <= threshold) return "low-stock";
  return "in-stock";
}

function calculateDynamicReorderMetrics({
  stock,
  velocity,
  leadTimeDays,
  unitCost = 0,
}) {
  const normalizedVelocity = Math.max(Number(velocity) || 0, 0.1);
  const normalizedLeadTime = Math.max(Number(leadTimeDays) || 0, 1);
  const normalizedStock = Math.max(Number(stock) || 0, 0);
  const normalizedUnitCost = Math.max(Number(unitCost) || 0, 0);

  const adjustedVelocity = normalizedVelocity;
  const safetyStock = Math.ceil(adjustedVelocity * 2);
  const reorderPoint = Math.ceil((adjustedVelocity * normalizedLeadTime) + safetyStock);

  const annualDemand = adjustedVelocity * 365;
  const orderCost = Math.max(normalizedUnitCost * 0.15, 10);
  const annualHolding = Math.max(normalizedUnitCost * 0.08, 1);
  const reorderQuantity = Math.max(
    Math.ceil(Math.sqrt((2 * annualDemand * orderCost) / annualHolding)),
    Math.ceil(adjustedVelocity * normalizedLeadTime)
  );

  return {
    adjustedVelocity: Number(adjustedVelocity.toFixed(2)),
    safetyStock,
    reorderPoint,
    reorderQuantity,
    daysUntilStockout: adjustedVelocity > 0 ? Number((normalizedStock / adjustedVelocity).toFixed(1)) : null,
  };
}

module.exports = {
  calculateStatus,
  calculateDynamicReorderMetrics,
  resolveReorderLevel,
  getDefaultReorderLevel,
};
