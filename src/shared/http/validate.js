const { AppError } = require("./app-error");

function normalizeValue(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  return value;
}

function validateField(key, value, rule) {
  const normalizedValue = normalizeValue(value);

  if (rule.required && (normalizedValue === undefined || normalizedValue === null || normalizedValue === "")) {
    return `${key} is required.`;
  }

  if (normalizedValue === undefined || normalizedValue === null || normalizedValue === "") {
    return null;
  }

  if (rule.type === "number" && Number.isNaN(Number(normalizedValue))) {
    return `${key} must be a valid number.`;
  }

  if (rule.type === "integer" && !Number.isInteger(Number(normalizedValue))) {
    return `${key} must be an integer.`;
  }

  if (rule.minLength && String(normalizedValue).length < rule.minLength) {
    return `${key} must be at least ${rule.minLength} characters.`;
  }

  if (rule.enum && !rule.enum.includes(String(normalizedValue))) {
    return `${key} must be one of: ${rule.enum.join(", ")}.`;
  }

  if (typeof rule.custom === "function") {
    const customMessage = rule.custom(normalizedValue);
    if (customMessage) {
      return customMessage;
    }
  }

  return null;
}

function validateBody(schema) {
  return (req, res, next) => {
    const errors = Object.entries(schema)
      .map(([key, rule]) => validateField(key, req.body[key], rule))
      .filter(Boolean);

    if (errors.length > 0) {
      return next(new AppError(400, "Validation failed.", errors));
    }

    next();
  };
}

module.exports = { validateBody };
