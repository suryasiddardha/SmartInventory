const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db/connection");
const { authenticate, authorize } = require("../middleware/auth");
const { logActivity } = require("../lib/activity-log");
const { asyncHandler } = require("../src/shared/http/async-handler");
const { validateBody } = require("../src/shared/http/validate");

const router = express.Router();

let usersColumnsPromise = null;

async function getUsersColumns() {
  if (!usersColumnsPromise) {
    usersColumnsPromise = db.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'users'
      `,
    );
  }

  const [rows] = await usersColumnsPromise;
  return new Set(rows.map((row) => row.column_name));
}

function hasColumn(columns, name) {
  return columns.has(name);
}

function mapEmployeeRow(row, columns) {
  return {
    id: row.id,
    username: row.username,
    full_name: hasColumn(columns, "full_name") ? row.full_name : row.username,
    phone: hasColumn(columns, "phone") ? row.phone : null,
    email: hasColumn(columns, "email") ? row.email : null,
    address: hasColumn(columns, "address") ? row.address : null,
    role: row.role,
    status: row.status,
    created_at: row.created_at,
  };
}

function buildEmployeeSelect(columns) {
  const selectFields = [
    "u.id",
    "u.username",
    "u.role",
    "u.status",
    "u.created_at",
  ];

  if (hasColumn(columns, "full_name")) selectFields.push("u.full_name");
  if (hasColumn(columns, "phone")) selectFields.push("u.phone");
  if (hasColumn(columns, "email")) selectFields.push("u.email");
  if (hasColumn(columns, "address")) selectFields.push("u.address");

  return `
    SELECT ${selectFields.join(", ")}
    FROM users u
    ORDER BY u.created_at DESC
  `;
}

router.use(authenticate, authorize("admin"));

router.get("/", asyncHandler(async (req, res) => {
    const columns = await getUsersColumns();
    const [rows] = await db.query(buildEmployeeSelect(columns));
    res.json(rows.map((row) => mapEmployeeRow(row, columns)));
}));

router.post("/", validateBody({
  username: { required: true, minLength: 3 },
  full_name: { required: true, minLength: 3 },
  role: { required: true, enum: ["manager", "staff"] },
  password: { required: true, minLength: 4 },
}), asyncHandler(async (req, res) => {
    const { username, full_name, role, password, phone, email, address } = req.body;
    const columns = await getUsersColumns();

    const [existing] = await db.query("SELECT id FROM users WHERE username = ?", [username]);
    if (existing.length > 0) {
      return res.status(409).json({ error: "Username already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const insertColumns = ["username", "password", "role"];
    const insertValues = [username, hashedPassword, role];

    if (hasColumn(columns, "full_name")) {
      insertColumns.push("full_name");
      insertValues.push(full_name);
    }
    if (hasColumn(columns, "phone")) {
      insertColumns.push("phone");
      insertValues.push(phone || null);
    }
    if (hasColumn(columns, "email")) {
      insertColumns.push("email");
      insertValues.push(email || null);
    }
    if (hasColumn(columns, "address")) {
      insertColumns.push("address");
      insertValues.push(address || null);
    }

    const placeholders = insertColumns.map(() => "?").join(", ");
    const [result] = await db.query(
      `INSERT INTO users (${insertColumns.join(", ")}) VALUES (${placeholders})`,
      insertValues,
    );

    await logActivity(db, {
      userId: req.user.id,
      actionType: "create",
      entityType: "user",
      entityId: result.insertId,
      details: `Created employee ${username} (${role})`,
    });

    res.status(201).json({ message: "Employee added.", id: result.insertId });
}));

router.put("/:id", async (req, res) => {
  try {
    const { username, role, status } = req.body;
    const columns = await getUsersColumns();

    const [target] = await db.query("SELECT username, role FROM users WHERE id = ?", [req.params.id]);
    if (target.length === 0) return res.status(404).json({ error: "Employee not found." });

    if (username && username !== target[0].username) {
      if (username.length < 3) return res.status(400).json({ error: "Username must be at least 3 characters." });
      const [existing] = await db.query("SELECT id FROM users WHERE username = ? AND id != ?", [username, req.params.id]);
      if (existing.length > 0) return res.status(409).json({ error: "Username already exists." });
    }

    const updateParts = ["username = COALESCE(?, username)", "role = COALESCE(?, role)", "status = COALESCE(?, status)"];
    const updateValues = [username || null, role || null, status || null];

    if (hasColumn(columns, "full_name")) {
      updateParts.splice(1, 0, "full_name = COALESCE(?, full_name)");
      updateValues.splice(1, 0, req.body.full_name || null);
    }
    if (hasColumn(columns, "phone")) {
      updateParts.push("phone = COALESCE(?, phone)");
      updateValues.push(req.body.phone || null);
    }
    if (hasColumn(columns, "email")) {
      updateParts.push("email = COALESCE(?, email)");
      updateValues.push(req.body.email || null);
    }
    if (hasColumn(columns, "address")) {
      updateParts.push("address = COALESCE(?, address)");
      updateValues.push(req.body.address || null);
    }
    updateValues.push(req.params.id);

    const [result] = await db.query(
      `UPDATE users SET ${updateParts.join(", ")} WHERE id = ?`,
      updateValues,
    );

    if (result.affectedRows === 0) return res.status(404).json({ error: "Employee not found." });

    await logActivity(db, {
      userId: req.user.id,
      actionType: "update",
      entityType: "user",
      entityId: req.params.id,
      details: `Updated employee ${username || target[0].username}`,
    });

    res.json({ message: "Employee updated successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update employee." });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const [target] = await db.query("SELECT role, username FROM users WHERE id = ?", [req.params.id]);
    if (target.length === 0) return res.status(404).json({ error: "Employee not found." });
    if (target[0].role === "admin") return res.status(403).json({ error: "Cannot delete admin user." });
    if (parseInt(req.params.id, 10) === req.user.id) {
      return res.status(403).json({ error: "Cannot delete your own account." });
    }

    const [result] = await db.query("DELETE FROM users WHERE id = ?", [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Employee not found." });

    await logActivity(db, {
      userId: req.user.id,
      actionType: "delete",
      entityType: "user",
      entityId: req.params.id,
      details: `Deleted employee ${target[0].username}`,
    });

    res.json({ message: "Employee deleted." });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete employee." });
  }
});

module.exports = router;
