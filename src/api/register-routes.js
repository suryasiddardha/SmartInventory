function registerRoutes(app) {
  app.use("/api/auth", require("../../routes/auth"));
  app.use("/api/inventory", require("../../routes/inventory"));
  app.use("/api/suppliers", require("../../routes/suppliers"));
  app.use("/api/orders", require("../../routes/orders"));
  app.use("/api/employees", require("../../routes/employees"));
  app.use("/api/exports", require("../../routes/exports"));
  app.use("/api/monitoring", require("../../routes/monitoring"));
}

module.exports = { registerRoutes };
