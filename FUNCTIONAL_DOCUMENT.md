# Smart Inventory Management System - Functional Document

## 1. Project Purpose

The Smart Inventory Management System is designed to help a retail or warehouse business manage inventory, suppliers, customers, employees, sales orders, invoices, stock alerts, and business reports from a single web application.

The system reduces manual stock tracking by providing automated FIFO stock deduction, batch-level inventory control, role-based access, customer history, supplier intelligence, and real-time dashboard monitoring.

## 2. Scope of the System

The system covers the following functional areas:

- User login, logout, password reset, and password change
- Role-based access for admin, manager, and staff
- Product inventory creation, update, delete, approval, and search
- FIFO batch tracking and restocking
- Supplier management and supplier-product mapping
- Order creation, update, cancellation, deletion, and invoice generation
- Customer contact management and order history
- Employee/user management
- Dashboard analytics and stock alerts
- Export reports, audit logs, and database backup
- Email delivery for customer invoices and stock alerts

## 3. User Roles

| Role | Main Responsibilities |
| --- | --- |
| Admin | Full system control, user management, product approvals, delete permissions, audit exports, and backup generation |
| Manager | Inventory oversight, supplier management, restocking, order updates, monitoring, and approvals workflow support |
| Staff | Daily operational work such as viewing stock, creating orders, and updating assigned records |

## 4. Functional Requirements

### 4.1 Authentication and Account Access

The system shall allow users to log in using valid credentials. Passwords are stored securely using hashing. After successful login, the backend returns a JWT token used for protected API access.

Functional behavior:

- User can log in with username and password.
- User can log out from the application.
- Logged-in user details can be fetched from the current session.
- User can change password after authentication.
- Password reset is available from the login screen.
- Invalid or expired tokens are rejected.

### 4.2 Dashboard and Analytics

The dashboard provides operational visibility for inventory, orders, stock health, sales reports, alerts, and approvals.

Functional behavior:

- Display revenue, profit, order, and inventory snapshots.
- Show stock alerts for low-stock and expiring items.
- Show pending product approvals for admin users.
- Display sales trends and category distribution using charts.
- Provide date-based sales report filtering.
- Allow report export for business use.

### 4.3 Inventory Management

The inventory module manages product details and current stock.

Functional behavior:

- View all approved inventory items.
- Search and filter products.
- Add new product with name, SKU, category, price, stock, supplier, expiry date, description, and low-stock point.
- Update product details.
- Delete product records with admin access.
- Calculate stock status as in-stock, low-stock, critical, or out-of-stock.
- Track inventory movements for restock, adjustment, sale, and return events.
- Show alternative suppliers for a product.

### 4.4 Product Approval Workflow

The system supports controlled product creation through an approval workflow.

Functional behavior:

- Products created by admin can be approved immediately.
- Products created by non-admin users can be marked as pending.
- Admin can view pending products.
- Admin can approve pending products.
- Admin can reject pending products.

### 4.5 FIFO Batch Management

The system supports batch-level inventory using First-In, First-Out logic.

Functional behavior:

- Each restock creates or updates inventory batch records.
- Batches store supplier, purchase cost, selling price, initial stock, current stock, received date, and expiry date.
- Admin and manager can view product batches.
- Admin and manager can update batch details.
- Orders consume stock from the oldest available batch first.
- Batch usage is stored for every order.
- Cancelled or deleted orders restore stock back to the original consumed batches.

### 4.6 Supplier Management

The supplier module stores supplier data and supplier performance information.

Functional behavior:

- View supplier list.
- Add supplier with company name, contact person, phone, email, status, lead time, delivery rate, quality rating, and payment terms.
- Update supplier details.
- Delete supplier with admin access.
- View products supplied by a supplier.
- View supplier intelligence, including product coverage and performance indicators.
- Link suppliers to inventory items with unit cost, contract price, lead time, quality rating, minimum order quantity, and preferred supplier status.

### 4.7 Order Management

The order module handles sales order processing.

Functional behavior:

- View all orders.
- View a single order by ID.
- Create an order for a customer and inventory item.
- Capture customer phone and email during order creation.
- Automatically create or update customer records when an order is placed.
- Deduct inventory using FIFO batch logic.
- Calculate order amount, cost, and profit based on consumed batches.
- Update order status and order details.
- Cancel orders and restore stock when needed.
- Delete orders with admin access.
- View order batch breakdown for admin users.

### 4.8 Customer Management

The customer module stores customer contact details and supports customer history.

Functional behavior:

- View customer list.
- Add customer details.
- Update customer details.
- Delete customer with admin access.
- View all orders placed by a selected customer.
- Auto-fill customer name suggestions during order creation.

### 4.9 Employee Management

The employee module manages application users and staff information.

Functional behavior:

- Admin can view employee/user records.
- Admin can add new employees.
- Admin can update employee details, role, status, department, and manager assignment.
- Admin can delete employee records.
- Role controls decide which screens and actions are visible to each user.

### 4.10 Invoice Management

The system supports professional invoice generation and email delivery.

Functional behavior:

- Generate invoice for completed orders.
- Display invoice with product, customer, order, price, tax/total, and status details.
- Print invoice from the browser.
- Send invoice to customer email.
- Send admin copy/BCC when configured.
- Prevent invoice generation for invalid or unsupported order states.

### 4.11 Reporting and Exports

The export module supports business reporting.

Functional behavior:

- Export daily order reports.
- Export sales reports by date range.
- Export product reports.
- Export staff reports.
- Export audit logs for admin users.
- Generate database backup for admin users.

### 4.12 Monitoring and Audit

The monitoring module gives admin and manager users visibility into system health.

Functional behavior:

- Show monitoring overview.
- Show recent audit logs.
- Show team health information.
- Show critical operational alerts.
- Show inventory health.
- Show performance by category.
- Allow admin users to export audit logs.
- Allow admin users to download database backup.

## 5. Major User Workflows

### 5.1 Login Workflow

1. User opens the application.
2. User enters username and password.
3. Backend validates credentials.
4. JWT token is returned.
5. Frontend loads the dashboard according to user role.

### 5.2 Product Restock Workflow

1. Admin or manager opens inventory.
2. User selects a product and clicks restock.
3. User enters supplier, quantity, purchase cost, selling price, and expiry date.
4. Backend creates a new inventory batch.
5. Current stock and product status are updated.
6. Movement and activity logs are saved.

### 5.3 Sales Order Workflow

1. User opens order form.
2. User selects customer and product.
3. System checks available stock.
4. Backend deducts stock from FIFO batches.
5. Order is saved with amount, cost, profit, and status.
6. Customer history is updated.
7. Stock alerts are checked.

### 5.4 Order Cancellation Workflow

1. Admin or manager updates order status to cancelled, or admin deletes an order.
2. System reads original batch usage.
3. Stock is restored to the consumed batches.
4. Product stock and status are recalculated.
5. Activity and movement records are saved.

### 5.5 Invoice Workflow

1. User opens a completed order.
2. User generates invoice.
3. System displays printable invoice.
4. User prints invoice or sends it by email.
5. Email service sends invoice to customer.

## 6. Input and Output Summary

| Module | Main Inputs | Main Outputs |
| --- | --- | --- |
| Authentication | Username, password, reset/change password details | JWT token, user profile, success/error messages |
| Inventory | Product data, stock, price, supplier, expiry, low-stock point | Product list, stock status, alerts, movement logs |
| Batches | Quantity, supplier, purchase cost, selling price, expiry | FIFO batches, updated stock, batch usage |
| Suppliers | Company and performance details | Supplier list, intelligence, product mappings |
| Orders | Customer, product, quantity, status | Order records, invoice, stock deduction, profit calculation |
| Customers | Name, phone, email, address | Customer list and order history |
| Employees | User details, role, status, department | Employee records and access control |
| Reports | Date range, report type, export format | CSV/PDF reports, audit exports, backup files |

## 7. Business Rules

- Only authenticated users can access protected application features.
- Admin users have the highest permission level.
- Product deletion is restricted to admin users.
- Supplier deletion is restricted to admin users.
- Customer deletion is restricted to admin users.
- Employee management is restricted to admin users.
- Restocking is available to admin and manager users.
- FIFO inventory deduction must use oldest available batches first.
- Cancelled orders must restore stock to the same batches that were used.
- Product status must reflect current stock and low-stock rules.
- Completed order invoices can be generated and emailed.
- Audit and backup exports are restricted to admin users.

## 8. Non-Functional Requirements

| Requirement | Description |
| --- | --- |
| Security | JWT authentication, bcrypt password hashing, and role-based authorization |
| Usability | Single-page interface with dashboard, tables, forms, modals, alerts, and charts |
| Reliability | Stock synchronization, FIFO restoration, and auto-bootstrapping database logic |
| Maintainability | Separate route modules, frontend modules, and shared helper libraries |
| Performance | MySQL connection pooling and focused API endpoints |
| Auditability | Activity logs, inventory movements, and audit export support |
| Availability | Local deployment through Node.js and MySQL with backup support |

## 9. Assumptions and Constraints

- The application is intended for a local or small business deployment.
- MySQL must be running before the application starts.
- Valid environment variables must be configured in `.env`.
- Email invoice delivery requires SMTP configuration.
- The application currently handles sales orders around a selected inventory item.
- Admin users are responsible for backup, audit, and destructive operations.

## 10. Acceptance Criteria

- Users can log in and see role-appropriate screens.
- Admin can manage employees, products, suppliers, customers, reports, audits, and backups.
- Manager can manage inventory, suppliers, orders, and monitoring workflows.
- Staff can perform daily operational tasks allowed by role permissions.
- Product restocking creates batch records and updates stock.
- Orders deduct stock using FIFO logic.
- Cancelling an order restores stock correctly.
- Dashboard displays current analytics and alerts.
- Invoice can be generated and sent for valid completed orders.
- Reports and backups can be exported successfully by authorized users.

