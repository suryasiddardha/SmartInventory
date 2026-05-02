const nodemailer = require("nodemailer");
const { env } = require("../src/config/env");

// Create a test account if no real SMTP credentials are provided in .env
let transporter;
let isInitializing = false;
let initPromise = null;

async function initMailer() {
  if (initPromise) return initPromise;
  
  initPromise = (async () => {
    if (env.smtpHost && env.smtpUser && env.smtpPass) {
      // ... real SMTP logic ...
      transporter = nodemailer.createTransport({
        host: env.smtpHost,
        port: env.smtpPort || 587,
        secure: env.smtpPort === 465,
        auth: {
          user: env.smtpUser,
          pass: env.smtpPass,
        },
      });
      console.log("Mailer initialized with production SMTP.");
    } else {
      try {
        const testAccount = await nodemailer.createTestAccount();
        transporter = nodemailer.createTransport({
          host: "smtp.ethereal.email",
          port: 587,
          secure: false,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass,
          },
        });
        console.log("Mailer initialized with Ethereal Email for testing.");
        console.log(`Test Email User: ${testAccount.user}`);
      } catch (err) {
        console.error("Failed to initialize test mailer:", err);
      }
    }
  })();
  
  return initPromise;
}

// Initialize on startup
initMailer();

/**
 * Send an email
 * @param {Object} options - { to, subject, text, html }
 */
async function sendMail(options) {
  if (!transporter) {
    console.log("Waiting for mailer initialization...");
    await initMailer();
  }
  
  if (!transporter) {
    console.warn("Mailer could not be initialized. Skipping email.");
    return null;
  }

  try {
    const info = await transporter.sendMail({
      from: '"Smart Inventory System" <noreply@smartinventory.local>',
      ...options,
    });

    console.log("Message sent: %s", info.messageId);
    
    // If using Ethereal, log the preview URL
    if (info.messageId && nodemailer.getTestMessageUrl(info)) {
      console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
    }
    
    return info;
  } catch (err) {
    console.error("Error sending email:", err);
    throw err;
  }
}

module.exports = {
  sendMail,
};
