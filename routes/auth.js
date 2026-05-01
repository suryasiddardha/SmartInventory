const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db/connection");
const { authenticate } = require("../middleware/auth");
const { env } = require("../src/config/env");
const { asyncHandler } = require("../src/shared/http/async-handler");
const { validateBody } = require("../src/shared/http/validate");

const router = express.Router();

// POST /api/auth/login
router.post(
  "/login",
  validateBody({
    username: { required: true, minLength: 3 },
    password: { required: true, minLength: 4 },
    role: { required: true, enum: ["admin", "manager", "staff"] },
  }),
  asyncHandler(async (req, res) => {
    const { username, password, role } = req.body;

    const [rows] = await db.query(
      "SELECT * FROM users WHERE username = ? AND status = 'active'",
      [username.trim()],
    );

    if (rows.length === 0) {
      return res
        .status(401)
        .json({ error: "User not found or account inactive." });
    }

    const user = rows[0];

    if (user.role !== role.toLowerCase()) {
      return res
        .status(401)
        .json({ error: "Role mismatch. Please select the correct role." });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Incorrect password." });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      env.jwtSecret,
      { expiresIn: env.jwtExpiresIn },
    );

    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role },
    });
  }),
);

// GET /api/auth/me
router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const [rows] = await db.query(
      "SELECT id, username, role, status FROM users WHERE id = ?",
      [req.user.id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    res.json({ user: rows[0] });
  }),
);

// POST /api/auth/logout
// JWT is stateless, so the client deletes the token.
router.post("/logout", (req, res) => {
  res.json({ message: "Logged out successfully." });
});

// POST /api/auth/change-password
router.post(
  "/change-password",
  authenticate,
  validateBody({
    current_password: { required: true },
    new_password: { required: true, minLength: 4 },
  }),
  asyncHandler(async (req, res) => {
    const { current_password, new_password } = req.body;

    const [rows] = await db.query("SELECT password FROM users WHERE id = ?", [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: "User not found." });

    const user = rows[0];
    const passwordMatch = await bcrypt.compare(current_password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Incorrect current password." });
    }

    const hashedNewPassword = await bcrypt.hash(new_password, 10);
    await db.query("UPDATE users SET password = ? WHERE id = ?", [hashedNewPassword, req.user.id]);

    res.json({ message: "Password updated successfully." });
  })
);

// POST /api/auth/change-password (Public Version for Login Page)
router.post(
  "/change-password-public",
  validateBody({
    username: { required: true },
    role: { required: true },
    current_password: { required: true },
    new_password: { required: true, minLength: 4 },
  }),
  asyncHandler(async (req, res) => {
    const { username, role, current_password, new_password } = req.body;

    const [rows] = await db.query(
      "SELECT id, password FROM users WHERE username = ? AND role = ? AND status = 'active'",
      [username.trim(), role.toLowerCase()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: "User not found or role mismatch." });
    }

    const user = rows[0];
    const passwordMatch = await bcrypt.compare(current_password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Incorrect current password." });
    }

    const hashedNewPassword = await bcrypt.hash(new_password, 10);
    await db.query("UPDATE users SET password = ? WHERE id = ?", [hashedNewPassword, user.id]);

    res.json({ message: "Password updated successfully. Please login with your new password." });
  })
);

module.exports = router;
