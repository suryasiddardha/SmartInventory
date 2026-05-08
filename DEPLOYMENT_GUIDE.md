# 🚀 Deployment Guide: Smart Inventory System

Follow these steps to move your application from your local computer (XAMPP) to the real internet.

## Phase 1: The Cloud Database (Aiven.io)
Since XAMPP only works on your PC, you need a database that is always online.

1.  **Sign up:** Go to [Aiven.io](https://aiven.io/) and create a free account.
2.  **Create Service:** Click "Create Service" and select **MySQL**.
3.  **Choose Plan:** Select the **Free Tier** (available in some regions like AWS Virginia or Google Cloud).
4.  **Get Credentials:** Once the status is "Running," copy your **Host**, **Port**, **User**, and **Password**.
5.  **Enable SSL:** Note that Aiven requires SSL (which I have already added support for in your code).

## Phase 2: Migrate Your Data
1.  **Export from XAMPP:** Go to `phpMyAdmin` on your local PC, select `smart_inventory`, and click **Export** to get a `.sql` file.
2.  **Import to Aiven:** Use a tool like [DBeaver](https://dbeaver.io/) or [MySQL Workbench] to connect to your Aiven database and run the `.sql` file you exported.

## Phase 3: The Web Host (Render.com)
This is where your Node.js code will live.

1.  **Push to GitHub:** Ensure your latest code is on GitHub.
2.  **Sign up:** Go to [Render.com](https://render.com/) and connect your GitHub account.
3.  **New Web Service:** Click "New" -> "Web Service" and select your `Smart Inventory` repository.
4.  **Configure Environment Variables:** In the Render dashboard, go to the **Environment** tab and add:
    - `DB_HOST`: (Your Aiven Host)
    - `DB_PORT`: (Your Aiven Port)
    - `DB_USER`: (Your Aiven User)
    - `DB_PASSWORD`: (Your Aiven Password)
    - `DB_NAME`: `defaultdb` (or whatever Aiven named your DB)
    - `DB_SSL`: `true`
    - `JWT_SECRET`: (A long random string)
    - `NODE_ENV`: `production`

## Phase 4: Real Email (Brevo)
Ethereal is for testing only. To send real emails:
1.  Sign up for a free account at [Brevo.com](https://www.brevo.com/).
2.  Go to **SMTP & API** settings to get your SMTP credentials.
3.  Add these to your Render Environment Variables:
    - `SMTP_HOST`: `smtp-relay.brevo.com`
    - `SMTP_PORT`: `587`
    - `SMTP_USER`: (Your Brevo login email)
    - `SMTP_PASS`: (Your Brevo master password)

---

### ✅ Success!
Once Render finishes "Building," it will give you a public URL (e.g., `https://smart-inventory.onrender.com`). You can now access your inventory system from any phone or computer in the world!
