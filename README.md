# Smart Inventory Management System

Smart Inventory is a Node.js and MySQL application for tracking inventory, suppliers, orders, employees, staff tasks, exports, and monitoring data.

## What You Get

- Electronics inventory CRUD with low-stock and warranty/expiry alerts
- Supplier management and supplier-product mapping
- Order tracking with inventory updates
- Employee management with role-based access
- Staff task workflows and monitoring
- Daily exports in JSON, CSV, Excel, and PDF
- Analytics endpoints for reporting and oversight

## Project Structure

```text
smart-inventory/
  server.js             Root entry point
  src/
    app.js              Express app setup
    server.js           HTTP server bootstrap
    config/
    api/
    shared/
  routes/               Feature routes
  lib/                  Shared business helpers
  middleware/           Auth and authorization
  db/                   Schema, migrations, and connection
  public/index.html     Frontend shell
```

## Requirements

- Node.js 16+
- MySQL 8+

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file with your database and JWT settings:

```env
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=smart_inventory
JWT_SECRET=change-this-secret
JWT_EXPIRES_IN=8h
```

3. Create the database schema:

```bash
mysql -u root -p < db/schema.sql
```

4. Start the app:

```bash
npm start
```

5. Open:

```text
http://localhost:3000
```

## Scripts

- `npm start` starts the server
- `npm run dev` starts the server with nodemon
- `npm run check` performs a syntax check on the main server files

## API Overview

- `/api/auth`
- `/api/inventory`
- `/api/suppliers`
- `/api/orders`
- `/api/employees`
- `/api/exports`
- `/api/monitoring`

## Roles

- `admin`
- `manager`
- `staff`

## Notes

- The frontend is served from `public/index.html`.
- The root `server.js` file simply boots the app in `src/server.js`.
- If you are using Windows PowerShell, `npm` may be blocked by execution policy. In that case, run commands through `cmd /c` or use `npm.cmd`.
