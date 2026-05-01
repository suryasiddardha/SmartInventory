const { env } = require("./config/env");
const { createApp } = require("./app");
const { bootstrapDatabase } = require("../db/bootstrap");

async function start() {
  await bootstrapDatabase();

  const app = createApp();
  app.listen(env.port, () => {
    console.log(`Smart Inventory running at http://localhost:${env.port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start Smart Inventory:", error.message);
  process.exit(1);
});
