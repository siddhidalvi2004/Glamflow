# GlamFlow + Razorpay (Test Mode)

This is your existing GlamFlow HTML CRM with the simulated gateway replaced by Razorpay Checkout in **test mode**, plus a small Node.js/Express backend.

## Requirements
- Node.js 18 or newer
- A Razorpay account (test mode is sufficient)
- Internet access for Razorpay Checkout and the Razorpay API

## 1. Get test API keys
1. Sign in to the Razorpay Dashboard.
2. Switch to **Test Mode**.
3. Open **Account & Settings → API Keys** (the exact menu label can vary by dashboard version).
4. Generate a test key pair and copy the **Key ID** and **Key Secret**.
5. Do not use live keys for this project and do not share the secret or commit it to source control.

Official references:
- Test and live modes: https://razorpay.com/docs/payments/dashboard/test-live-modes/
- API keys: https://razorpay.com/docs/payments/dashboard/account-settings/api-keys/
- Node.js integration: https://razorpay.com/docs/payments/server-integration/nodejs/payment-gateway/build-integration/

## 2. Configure the project
1. Extract this ZIP to a folder, for example `glamflow-razorpay`.
2. Open that folder in VS Code or a terminal.
3. Copy `.env.example` to a new file named `.env`.
   - Windows Command Prompt: `copy .env.example .env`
   - PowerShell: `Copy-Item .env.example .env`
4. Edit `.env` and replace the placeholders:

```env
RAZORPAY_KEY_ID=rzp_test_your_actual_test_key_id
RAZORPAY_KEY_SECRET=your_actual_test_key_secret
PORT=3000
```

Keep `.env` private. The Key Secret is read only by Node.js and is never sent to the browser.

## 3. Install and run
From the project folder:

```bash
npm install
npm start
```

Open **http://localhost:3000** in your browser. Do not double-click `public/index.html`; use the local server so the `/api` routes work. Demo login: `admin` / `Glam123`.

## 4. Try a test payment
1. Sign in to GlamFlow.
2. Open **Payment Gateway**.
3. Select an existing booking. The amount is filled from its package price in the browser data.
4. Click **Pay securely with Razorpay**.
5. Complete checkout using Razorpay's current test-mode instructions/test instruments. No real money is moved in test mode.
6. The server verifies Razorpay's payment signature. Only after verification does GlamFlow add a `Paid` record to its browser-based Payment & Billing module.
7. Server-side verification records are also stored in `data/verified-payments.json`; created order metadata is stored in `data/orders.json`.

## Important limits before production
- This is a learning/demo integration, not a production-ready payment system.
- GlamFlow's clients, packages, and bookings still live in browser `localStorage`. Therefore the server cannot independently prove the selected booking's actual package price. A user who deliberately edits browser requests could request a different amount. Before accepting real payments, move booking/package data to a trusted server database and calculate the amount on the server from the booking ID; never trust a browser-supplied amount.
- Signature verification proves the checkout response corresponds to an order and payment ID, but production systems should also fetch/check the payment status and amount via Razorpay's API and configure verified webhooks for reliable asynchronous updates.
- Do not add real card details to the app itself. Razorpay Checkout handles payment information.
- Keep the existing demo login in mind: it is client-side only and is not secure authentication.
- Use HTTPS, real server-side authentication/authorization, persistent database storage, idempotency, webhook signature verification, and appropriate operational/security controls before going live.
- Test mode does not move real money. Live mode requires separate live keys and account activation.


## Backend authentication

- Sign-in is checked by the Express backend using `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `.env`; the browser no longer contains a hardcoded admin username/password.
- Successful login creates an HTTP-only session cookie. The app checks `/api/auth/me` on load, and the **Sign out** button destroys the session.
- Payment order creation and payment verification endpoints require an authenticated session.
- Configure a unique `SESSION_SECRET` in `.env`. The fallback secret is generated randomly on each server start if it is missing, which logs a warning and invalidates sessions after restart; do not rely on that fallback.
- The default Express session store is in-memory and intended for local development only. For production, use a persistent session store, HTTPS, secure cookies, stronger account management, and a database.
- GlamFlow business records are still stored in browser `localStorage`; backend authentication does not yet move CRM data into a server database.
