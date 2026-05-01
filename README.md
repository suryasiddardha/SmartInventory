# Smart Inventory Management System

A professional, full-stack Node.js and MySQL application designed for high-efficiency inventory tracking, supplier management, and real-time monitoring.

## 🚀 Key Features

- **Smart Inventory Management**: Full CRUD for electronics with dynamic low-stock alerts and warranty tracking.
- **Strict Role-Based Access Control (RBAC)**:
  - 🛡️ **Admin**: Full system control, user management, and audit log access.
  - 📋 **Manager**: Inventory management and supplier oversight (restricted deletion).
  - 👷 **Staff**: Task execution and stock updates.
- **Intelligent Supplier Mapping**: Prevents product duplication and automates stock synchronization across multiple suppliers.
- **Advanced Reporting & Exports**: Generate detailed reports in **JSON, CSV, Excel, and PDF** with local IST timestamping.
- **Real-time Monitoring**: Detailed audit logs for tracking every action within the system.
- **Responsive Dashboard**: A modern, premium UI built for efficiency and visual excellence.

## 🛠️ Technology Stack

- **Backend**: Node.js, Express.js
- **Database**: MySQL 8+
- **Security**: JWT (JSON Web Tokens), Bcrypt.js password hashing
- **Frontend**: Vanilla JavaScript / HTML5 / CSS3 (Modern UI)

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
   - Create a database named `smart_inventory` in your MySQL/XAMPP server.
   - Import the schema:
     ```bash
     mysql -u root -p smart_inventory < db/schema.sql
     ```

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
   # Development mode (with nodemon)
   npm run dev

   # Production mode
   npm start
   ```

## 🌐 API Architecture

- `POST /api/auth/login` - Authenticate users and return JWT.
- `GET /api/inventory` - Fetch inventory with low-stock filtering.
- `GET /api/monitoring/audit-logs` - (Admin only) View system-wide activity.
- `GET /api/exports/download` - Generate and download reports.

## 📂 Project Structure

```text
smart-inventory/
├── db/             # Schema, connection pool, and migrations
├── lib/            # Business logic and shared helpers
├── middleware/     # Auth & Role-based middleware
├── public/         # Static frontend assets (Modern UI)
├── routes/         # Feature-specific API endpoints
├── src/            # Core application bootstrap
└── server.js       # Main entry point
```

## 📝 Recent Updates

- ✅ **Hardened RBAC**: Restricted destructive actions to Admin roles only.
- ✅ **IST Timestamps**: All reports and logs now use local Indian Standard Time.
- ✅ **Audit Log Export**: Admins can now export activity logs for compliance.
- ✅ **Smart Duplication Check**: Prevented duplicate items during supplier product mapping.

---
*Built with ❤️ for efficient inventory management.*
