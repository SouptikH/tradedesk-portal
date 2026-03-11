# TradeDesk Portal — Setup Guide

A secure trading operations portal hosted on GitHub Pages, backed by Google Sheets via Google Apps Script.

---

## Architecture Overview

```
GitHub Pages (index.html + config.js)
        │  HTTPS POST
        ▼
Google Apps Script Web App  ←→  Google Sheets
  - Authentication                - Trading Sheet (FO + FOC tabs + Audit + Admins)
  - CRUD operations               - Customer Sheet (Active + Disbursed tabs)
  - Audit logging
```

**Passwords are never stored in your GitHub repo.** They live only inside Google Apps Script.

---

## Step 1 — Create Your Google Sheets

### Sheet 1: Trading Sheet
1. Go to [sheets.google.com](https://sheets.google.com) → create a new spreadsheet
2. Name it **TradeDesk - Trading**
3. Copy the Spreadsheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/**COPY_THIS_PART**/edit`

The Apps Script will automatically create these tabs:
- `FO_Stocks` — F&O Stocks trading log
- `FO_Commodities` — F&O Commodities trading log
- `Audit_Log` — Immutable audit trail
- `Admins` — Admin credentials (hashed)

### Sheet 2: Customer Sheet
1. Create another new spreadsheet
2. Name it **TradeDesk - Customers**
3. Copy its Spreadsheet ID

The Apps Script will auto-create:
- `Customers_Active` — Active customer records
- `Customers_Disbursed` — Completed disbursements

---

## Step 2 — Deploy the Google Apps Script

1. Go to [script.google.com](https://script.google.com) → **New Project**
2. Name the project **TradeDesk Backend**
3. Delete any existing code in `Code.gs`
4. Paste the entire contents of `Code.gs` from this repo
5. Fill in your details in the `CONFIG` section at the top:

```javascript
const CONFIG = {
  TRADING_SHEET_ID:  "paste_your_trading_sheet_id_here",
  CUSTOMER_SHEET_ID: "paste_your_customer_sheet_id_here",

  MASTER_USER_ID:  "Souptikh",        // Your master username
  MASTER_PASSWORD: "Souptik@1960",    // Your master password
  // ... rest stays the same
};
```

6. Click **Deploy → New Deployment**
7. Settings:
   - Type: **Web App**
   - Execute as: **Me**
   - Who has access: **Anyone**
8. Click **Deploy** → authorize permissions
9. **Copy the Web App URL** (looks like `https://script.google.com/macros/s/AKfycb.../exec`)

> ⚠ Every time you change Code.gs, you must create a **new deployment** (not update existing) for changes to take effect.

---

## Step 3 — Configure Your GitHub Repo

1. Fork or clone this repository
2. Open `config.js`
3. Paste your Web App URL:

```javascript
window.APP_CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec"
};
```

4. Commit and push to GitHub

---

## Step 4 — Enable GitHub Pages

1. Go to your repo → **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` / `master`, folder: `/ (root)`
4. Save — your portal will be live at `https://yourusername.github.io/your-repo-name`

---

## Logging In

| Role | User ID | Password |
|------|---------|----------|
| Master | `Souptikh` | `Souptik@1960` |
| Admin | (set by master) | (set by master) |

**As Master you can:**
- Do everything admins can
- Add/remove admin accounts from the Admin Management tab
- View the full audit log (admins cannot delete audit entries)

---

## Features

### F&O Trading Log
- Log entries with auto-filled date/time
- Entry Capital with ± adjustment buttons (increments of ₹1,000)
- Exit Capital, auto-calculated P/L
- Separate tabs for F&O Stocks and F&O Commodities
- Edit any record — edits are logged in the Audit Log
- Daily P/L stats dashboard

### Customer Details
- Add customers with: Name, Payment Date, Principal, Return %, Due Date, Remarks
- Return amount auto-calculated from principal × percentage
- Status indicators: Active / Due Soon / Overdue
- Mark as disbursed → row moves to Disbursed sheet with timing (Early/On Time/Late)
- View all historical disbursed records

### Audit Log
- Every action (login, add, edit, disburse) is logged with timestamp + user
- Cannot be deleted without master access
- Newest entries shown first

### Admin Management (Master only)
- Add new admins with username + password
- Remove admins
- All admin additions/removals are audit-logged

---

## Security Notes

- Passwords are **hashed** before storing in Google Sheets
- Master credentials live only in Apps Script (server-side), never in your repo
- `config.js` contains only the public Apps Script URL — safe to commit
- Each API call verifies the user ID against the Admins sheet
- Audit log entries cannot be deleted via the portal (master would need direct Sheets access)

---

## File Structure

```
├── index.html      — The full portal UI (GitHub Pages)
├── config.js       — Your Apps Script URL (edit this)
├── Code.gs         — Google Apps Script backend (deploy this)
└── README.md       — This file
```
