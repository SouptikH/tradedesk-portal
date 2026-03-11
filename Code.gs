// ═══════════════════════════════════════════════════════════════════
//  TRADEDESK PORTAL — GOOGLE APPS SCRIPT BACKEND
//  File: Code.gs
//
//  SETUP:
//  1. Open Google Apps Script (script.google.com) → New Project
//  2. Paste this entire file into Code.gs
//  3. Set your MASTER credentials and Sheet IDs in the CONFIG section
//  4. Deploy → New Deployment → Web App
//     - Execute as: Me
//     - Who has access: Anyone
//  5. Copy the Web App URL into config.js in your GitHub repo
// ═══════════════════════════════════════════════════════════════════

// ─── CONFIG ───────────────────────────────────────────────────────
// ⚠ IMPORTANT: Fill these in before deploying!

const CONFIG = {
  // Google Sheets IDs (from the URL: .../d/SPREADSHEET_ID/edit)
  TRADING_SHEET_ID: "1DKls0aRsN2nWcxa3FwgpGXaHoNi4k46ZVwlDiuSzABg",
  CUSTOMER_SHEET_ID: "18O3Ok0CPiHkOfhJvhSH3fHRshIwc-CnDssJ-xLDyDQw",

  // Master credentials — stored only in Apps Script, never in your repo
  MASTER_USER_ID: "Souptikh",
  MASTER_PASSWORD: "Souptik@1960",

  // Sheet tab names
  FO_SHEET_NAME: "FO_Stocks",
  FOC_SHEET_NAME: "FO_Commodities",
  AUDIT_SHEET_NAME: "Audit_Log",
  ADMIN_SHEET_NAME: "Admins",
  CUSTOMER_ACTIVE_SHEET_NAME: "Customers_Active",
  CUSTOMER_DISBURSED_SHEET_NAME: "Customers_Disbursed",
};

// ─── HTTP HANDLER ─────────────────────────────────────────────────
// Google Apps Script CORS workaround: send data as a JSON string
// in a GET parameter called "data". The browser uses no-cors mode.

function doGet(e) {
  try {
    const raw = e.parameter && e.parameter.data;
    if (!raw) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: true, message: "TradeDesk API running" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const payload = JSON.parse(raw);
    const result = router(payload);
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    // Support both POST body and GET-style ?data= param
    let payload;
    if (e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (e.parameter && e.parameter.data) {
      payload = JSON.parse(e.parameter.data);
    } else {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, message: "No data received" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const result = router(payload);
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ─── ROUTER ───────────────────────────────────────────────────────
function router(payload) {
  const { action, userId } = payload;

  // Login doesn't require auth
  if (action === "login") return handleLogin(payload);

  // All other actions require a valid session (we verify each call)
  const authResult = verifyUser(userId, payload.password, payload);
  if (!authResult.valid) return { success: false, message: "Unauthorized" };

  switch (action) {
    case "getEntries":        return getEntries();
    case "addEntry":          return addEntry(payload, userId);
    case "editEntry":         return editEntry(payload, userId);
    case "getCustomers":      return getCustomers();
    case "addCustomer":       return addCustomer(payload, userId);
    case "editCustomer":      return editCustomer(payload, userId);
    case "disburseCustomer":  return disburseCustomer(payload, userId);
    case "getAuditLog":       return getAuditLog();
    case "getAdmins":         return requireMaster(authResult, getAdmins);
    case "addAdmin":          return requireMaster(authResult, () => addAdmin(payload, userId));
    case "removeAdmin":       return requireMaster(authResult, () => removeAdmin(payload, userId));
    default:                  return { success: false, message: "Unknown action" };
  }
}

function requireMaster(authResult, fn) {
  if (!authResult.isMaster) return { success: false, message: "Master access required" };
  return fn();
}

// ─── AUTH ─────────────────────────────────────────────────────────
function handleLogin(payload) {
  const { userId, password } = payload;
  if (!userId || !password) return { success: false, message: "Missing credentials" };

  // Check master
  if (userId === CONFIG.MASTER_USER_ID && password === CONFIG.MASTER_PASSWORD) {
    appendAuditLog(userId, `Master login`);
    return { success: true, isMaster: true };
  }

  // Check admins sheet
  const sheet = getOrCreateSheet(CONFIG.TRADING_SHEET_ID, CONFIG.ADMIN_SHEET_NAME, ["UserID", "PasswordHash", "AddedOn", "AddedBy"]);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === userId) {
      const hash = data[i][1];
      if (hash === hashPassword(password)) {
        appendAuditLog(userId, `Admin login`);
        return { success: true, isMaster: false };
      } else {
        return { success: false, message: "Invalid password" };
      }
    }
  }
  return { success: false, message: "User not found" };
}

function verifyUser(userId, password, payload) {
  // For stateless verification, we re-verify on each call using a session token approach.
  // Since this is a simple portal, we trust the userId passed and validate against sheet.
  // In production you could add a signed session token.
  if (!userId) return { valid: false };

  if (userId === CONFIG.MASTER_USER_ID) return { valid: true, isMaster: true };

  const sheet = getOrCreateSheet(CONFIG.TRADING_SHEET_ID, CONFIG.ADMIN_SHEET_NAME, ["UserID", "PasswordHash", "AddedOn", "AddedBy"]);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === userId) return { valid: true, isMaster: false };
  }
  return { valid: false };
}

// Simple hash — not cryptographically strong but keeps passwords off the sheet in plaintext
function hashPassword(password) {
  let hash = 0;
  const salt = "TradeDeskSalt2024";
  const str = salt + password + salt;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36) + str.length.toString(36);
}

// ─── TRADING ENTRIES ──────────────────────────────────────────────
function getEntries() {
  const foSheet  = getOrCreateSheet(CONFIG.TRADING_SHEET_ID, CONFIG.FO_SHEET_NAME,  entryHeaders());
  const focSheet = getOrCreateSheet(CONFIG.TRADING_SHEET_ID, CONFIG.FOC_SHEET_NAME, entryHeaders());
  return {
    success: true,
    fo:  sheetToObjects(foSheet,  entryHeaders()),
    foc: sheetToObjects(focSheet, entryHeaders())
  };
}

function entryHeaders() {
  return ["ID", "Datetime", "EntryCapital", "ExitCapital", "PL", "Type", "LoggedBy", "LastEditedBy", "LastEditedAt"];
}

function addEntry(payload, userId) {
  const { entryCapital, exitCapital, type, datetime } = payload;
  const sheet = getOrCreateSheet(
    CONFIG.TRADING_SHEET_ID,
    type === "FO" ? CONFIG.FO_SHEET_NAME : CONFIG.FOC_SHEET_NAME,
    entryHeaders()
  );
  const id = Utilities.getUuid();
  const pl = (parseFloat(exitCapital) || 0) - (parseFloat(entryCapital) || 0);
  const now = datetime || new Date().toISOString().slice(0,16).replace("T", " ");
  sheet.appendRow([id, now, entryCapital, exitCapital || 0, pl, type, userId, "", ""]);

  appendAuditLog(userId, `Added ${type} entry: Entry=₹${entryCapital}, Exit=₹${exitCapital||0}, P/L=₹${pl.toFixed(2)}`);
  return { success: true };
}

function editEntry(payload, userId) {
  const { id, entryCapital, exitCapital, type, datetime } = payload;
  const sheet = getOrCreateSheet(
    CONFIG.TRADING_SHEET_ID,
    type === "FO" ? CONFIG.FO_SHEET_NAME : CONFIG.FOC_SHEET_NAME,
    entryHeaders()
  );

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      const pl = (parseFloat(exitCapital) || 0) - (parseFloat(entryCapital) || 0);
      const oldEntry = data[i][2];
      const oldExit = data[i][3];
      const editTime = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

      sheet.getRange(i + 1, 1, 1, 9).setValues([[
        id, datetime, entryCapital, exitCapital || 0, pl, type, data[i][6], userId, editTime
      ]]);

      appendAuditLog(userId, `EDITED ${type} entry ID=${id.slice(0,8)}: Entry changed ₹${oldEntry}→₹${entryCapital}, Exit changed ₹${oldExit}→₹${exitCapital||0}, P/L=₹${pl.toFixed(2)}`);
      return { success: true };
    }
  }
  return { success: false, message: "Entry not found" };
}

// ─── CUSTOMERS ────────────────────────────────────────────────────
function customerHeaders() {
  return ["ID", "Name", "PaymentDate", "Principal", "ReturnPct", "ReturnAmt", "DueDate", "Remarks", "AddedBy", "AddedAt", "LastEditedBy", "LastEditedAt"];
}

function disbursedHeaders() {
  return ["ID", "Name", "PaymentDate", "Principal", "ReturnPct", "ReturnAmt", "DueDate", "Remarks", "DisbursedOn", "DisbursedRemarks", "DisbursedBy"];
}

function getCustomers() {
  const activeSheet    = getOrCreateSheet(CONFIG.CUSTOMER_SHEET_ID, CONFIG.CUSTOMER_ACTIVE_SHEET_NAME,    customerHeaders());
  const disbursedSheet = getOrCreateSheet(CONFIG.CUSTOMER_SHEET_ID, CONFIG.CUSTOMER_DISBURSED_SHEET_NAME, disbursedHeaders());
  return {
    success:   true,
    active:    sheetToObjects(activeSheet,    customerHeaders()),
    disbursed: sheetToObjects(disbursedSheet, disbursedHeaders())
  };
}

function addCustomer(payload, userId) {
  const { name, paymentDate, principal, returnPct, returnAmt, dueDate, remarks } = payload;
  const sheet = getOrCreateSheet(CONFIG.CUSTOMER_SHEET_ID, CONFIG.CUSTOMER_ACTIVE_SHEET_NAME, customerHeaders());
  const id = Utilities.getUuid();
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  sheet.appendRow([id, name, paymentDate, principal, returnPct, returnAmt, dueDate, remarks || "", userId, now, "", ""]);
  appendAuditLog(userId, `Added customer: ${name}, Principal=₹${principal}, Return=${returnPct}%, Due=${dueDate}`);
  return { success: true };
}

function editCustomer(payload, userId) {
  const { id, name, paymentDate, principal, returnPct, returnAmt, dueDate, remarks } = payload;
  const sheet = getOrCreateSheet(CONFIG.CUSTOMER_SHEET_ID, CONFIG.CUSTOMER_ACTIVE_SHEET_NAME, customerHeaders());
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      const editTime = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
      sheet.getRange(i + 1, 1, 1, 12).setValues([[
        id, name, paymentDate, principal, returnPct, returnAmt, dueDate, remarks || "",
        data[i][8], data[i][9], userId, editTime
      ]]);
      appendAuditLog(userId, `EDITED customer ID=${id.slice(0,8)}: Name=${name}, Principal=₹${principal}, Due=${dueDate}`);
      return { success: true };
    }
  }
  return { success: false, message: "Customer not found" };
}

function disburseCustomer(payload, userId) {
  const { id, disbursedOn, remarks } = payload;
  const activeSheet    = getOrCreateSheet(CONFIG.CUSTOMER_SHEET_ID, CONFIG.CUSTOMER_ACTIVE_SHEET_NAME,    customerHeaders());
  const disbursedSheet = getOrCreateSheet(CONFIG.CUSTOMER_SHEET_ID, CONFIG.CUSTOMER_DISBURSED_SHEET_NAME, disbursedHeaders());

  const data = activeSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      const row = data[i];
      // Move to disbursed sheet
      disbursedSheet.appendRow([
        row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7],
        disbursedOn, remarks || "", userId
      ]);
      activeSheet.deleteRow(i + 1);

      appendAuditLog(userId, `DISBURSED customer: ${row[1]}, Principal=₹${row[3]}, DisbursedOn=${disbursedOn}`);
      return { success: true };
    }
  }
  return { success: false, message: "Customer not found" };
}

// ─── AUDIT LOG ────────────────────────────────────────────────────
function appendAuditLog(user, message) {
  const sheet = getOrCreateSheet(CONFIG.TRADING_SHEET_ID, CONFIG.AUDIT_SHEET_NAME, ["ID", "Timestamp", "User", "Message"]);
  const id = Utilities.getUuid();
  const ts = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  sheet.appendRow([id, ts, user, message]);
}

function getAuditLog() {
  const sheet = getOrCreateSheet(CONFIG.TRADING_SHEET_ID, CONFIG.AUDIT_SHEET_NAME, ["ID", "Timestamp", "User", "Message"]);
  const data = sheet.getDataRange().getValues();
  const entries = [];
  for (let i = data.length - 1; i >= 1; i--) {  // Reverse order (newest first)
    entries.push({
      id:        data[i][0],
      timestamp: data[i][1],
      user:      data[i][2],
      message:   data[i][3]
    });
  }
  return { success: true, entries };
}

// ─── ADMIN MANAGEMENT ─────────────────────────────────────────────
function getAdmins() {
  const sheet = getOrCreateSheet(CONFIG.TRADING_SHEET_ID, CONFIG.ADMIN_SHEET_NAME, ["UserID", "PasswordHash", "AddedOn", "AddedBy"]);
  const data = sheet.getDataRange().getValues();
  const admins = [];
  for (let i = 1; i < data.length; i++) {
    admins.push({ userId: data[i][0], addedOn: data[i][2], addedBy: data[i][3] });
  }
  return { success: true, admins };
}

function addAdmin(payload, masterUserId) {
  const { newUserId, newPassword } = payload;
  if (!newUserId || !newPassword) return { success: false, message: "User ID and password required" };
  if (newUserId === CONFIG.MASTER_USER_ID) return { success: false, message: "Cannot overwrite master" };

  const sheet = getOrCreateSheet(CONFIG.TRADING_SHEET_ID, CONFIG.ADMIN_SHEET_NAME, ["UserID", "PasswordHash", "AddedOn", "AddedBy"]);
  const data = sheet.getDataRange().getValues();

  // Check duplicate
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === newUserId) return { success: false, message: "User ID already exists" };
  }

  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  sheet.appendRow([newUserId, hashPassword(newPassword), now, masterUserId]);
  appendAuditLog(masterUserId, `Added admin: ${newUserId}`);
  return { success: true };
}

function removeAdmin(payload, masterUserId) {
  const { targetUserId } = payload;
  if (targetUserId === CONFIG.MASTER_USER_ID) return { success: false, message: "Cannot remove master" };

  const sheet = getOrCreateSheet(CONFIG.TRADING_SHEET_ID, CONFIG.ADMIN_SHEET_NAME, ["UserID", "PasswordHash", "AddedOn", "AddedBy"]);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === targetUserId) {
      sheet.deleteRow(i + 1);
      appendAuditLog(masterUserId, `Removed admin: ${targetUserId}`);
      return { success: true };
    }
  }
  return { success: false, message: "Admin not found" };
}

// ─── SHEET HELPERS ────────────────────────────────────────────────
function getOrCreateSheet(spreadsheetId, sheetName, headers) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  }
  return sheet;
}

function sheetToObjects(sheet, headers) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const result = [];
  for (let i = 1; i < data.length; i++) {
    const obj = {};
    headers.forEach((h, j) => {
      // Convert header to camelCase key
      const key = h.replace(/_([a-z])/g, g => g[1].toUpperCase()).charAt(0).toLowerCase() + h.replace(/_([a-z])/g, g => g[1].toUpperCase()).slice(1);
      obj[key] = data[i][j];
    });
    result.push(obj);
  }
  return result;
}
