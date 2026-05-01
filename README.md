# Smart Inventory Management System

A premium, full-stack Node.js and MySQL application designed for high-efficiency inventory tracking, sales automation, and real-time business intelligence.

## 🚀 Key Features

- **Advanced FIFO Inventory Logic**: 
  - **Batch Tracking**: Manage stock using First-In, First-Out logic for precise profit calculations.
  - **Auto-Restoration**: Cancelled orders automatically restore stock to their original batches.
- **Automated CRM Integration**:
  - Seamlessly capture customer contact details (Phone/Email) directly during the sales process.
  - Integrated customer history tracking with 📜 one-click order history.
- **Premium Visual Analytics Dashboard**:
  - **Daily Performance Snapshot**: Real-time "Today vs Yesterday" comparison for Revenue, Profit, and Orders.
  - **Interactive Charts**: Sales Performance Trends and Category Distribution using Chart.js.
  - **Inventory Mix**: Visual breakdown of total stock holdings across all departments.
- **Strict Role-Based Access Control (RBAC)**:
  - 🛡️ **Admin**: Full system control, user management, and audit log exports.
  - 📋 **Manager**: Inventory oversight, price adjustments, and approval workflows.
  - 👷 **Staff**: Task execution and real-time stock updates.
- **Professional Invoicing**:
  - High-contrast, print-ready invoices with Quick Print functionality.
  - Status-restricted document generation (Completed orders only).
- **Security & Self-Service**:
  - **Public Password Reset**: Secure credential updates directly from the login screen.
  - **JWT Authentication**: Secure, token-based session management.

## 🛠️ Technology Stack

- **Backend**: Node.js, Express.js
- **Database**: MySQL 8+ (with auto-bootstrapping logic)
- **Analytics**: Chart.js
- **Security**: JWT (JSON Web Tokens), Bcrypt.js password hashing
- **Frontend**: Vanilla JavaScript / HTML5 / CSS3 (Modern Dark-Mode UI)

## 📋 Prerequisites

- Node.js (v16.x or higher)
- MySQL (v8.x or higher)
- XAMPP (Optional, for local MySQL management)

## ⚙️ Local Setup

1. **Clone & Install**:
   ```bash
   npm install
   ```

2. **Database Configuration**:
   - Create a database named `smart_inventory` in your MySQL server.
   - The application features **Auto-Bootstrapping**; simply run the server and it will build the necessary tables.

3. **Environment Variables**:
   Create a `.env` file in the root directory:
   ```env
   PORT=3000
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=your_password
   DB_NAME=smart_inventory
   JWT_SECRET=your_secure_secret_key
   JWT_EXPIRES_IN=8h
   ```

4. **Run the Application**:
   ```bash
   npm run dev
   ```

## 📝 Recent Major Updates

- ✅ **FIFO Batching Engine**: Integrated complex batch-level stock deduction and restoration.
- ✅ **CRM Automation**: Unified order taking and customer contact management.
- ✅ **Visual Dashboard**: Added real-time charting for sales trends and inventory distribution.
- ✅ **Daily Snapshot**: Implemented "At-a-Glance" performance metrics for managers.
- ✅ **Secure Public Reset**: Migrated password management to a public-facing secure workflow.

---
*Built for excellence in modern retail and inventory management.*
