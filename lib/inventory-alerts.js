const db = require("../db/connection");
const { sendMail } = require("./mailer");

async function checkStockAndNotify(inventoryId) {
  try {
    const [rows] = await db.query(
      "SELECT id, product_name, stock, low_stock_point FROM inventory WHERE id = ?",
      [inventoryId]
    );

    if (rows.length === 0) return;

    const item = rows[0];
    const stock = Number(item.stock || 0);
    const threshold = Number(item.low_stock_point || 0);

    // Only notify if stock is at or below threshold
    if (stock <= threshold) {
      const status = stock <= 0 ? "OUT OF STOCK" : "LOW STOCK";
      const severity = stock <= 0 ? "Critical" : "Warning";

      // Get admin and manager emails
      const [users] = await db.query(
        "SELECT email FROM users WHERE role IN ('admin', 'manager') AND email IS NOT NULL AND email != ''"
      );

      if (users.length === 0) {
        console.log(`No managers/admins with emails found to notify for ${item.product_name}`);
        return;
      }

      const emails = users.map(u => u.email).join(", ");
      
      const subject = `[${severity}] ${status} Alert: ${item.product_name}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; border: 1px solid #e0e0e0; padding: 20px; border-radius: 10px;">
          <h2 style="color: ${stock <= 0 ? '#ef4444' : '#f59e0b'}; text-transform: uppercase;">${status} Alert</h2>
          <p>This is an automated notification from your Smart Inventory System.</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <table style="width: 100%;">
            <tr>
              <td style="color: #666; width: 150px;">Product:</td>
              <td style="font-weight: bold;">${item.product_name}</td>
            </tr>
            <tr>
              <td style="color: #666;">Current Stock:</td>
              <td style="font-weight: bold; color: ${stock <= 0 ? '#ef4444' : '#f59e0b'};">${stock} Units</td>
            </tr>
            <tr>
              <td style="color: #666;">Low Stock Point:</td>
              <td>${threshold} Units</td>
            </tr>
          </table>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="font-size: 14px; color: #666;">Please restock this item soon to avoid supply chain disruptions.</p>
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #aaa; font-size: 12px;">
            Smart Inventory Management System &copy; 2026
          </div>
        </div>
      `;

      await sendMail({
        to: emails,
        subject: subject,
        html: html
      });

      console.log(`Inventory alert sent for ${item.product_name} to ${emails}`);
    }
  } catch (err) {
    console.error("Failed to process inventory alert:", err);
  }
}

module.exports = {
  checkStockAndNotify
};
