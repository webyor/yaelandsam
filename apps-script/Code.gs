/**
 * Google Apps Script that receives the website's RSVP and food-allergy forms
 * and saves each reply as a row in the Google Sheet this script is attached to.
 *
 * Setup (also in README.md):
 *  1. Create a Google Sheet. Extensions > Apps Script. Paste this file.
 *  2. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 *  3. Copy the Web app URL into js/config.js (FORM_ENDPOINT).
 *
 * Sheets "RSVP" and "Dietary" are created automatically on the first reply.
 */

/** Columns saved for each form type. Order = column order in the sheet. */
var FORMS = {
  rsvp: { sheet: "RSVP", fields: ["name", "email", "attending", "guests", "guestNames", "message", "lang"] },
  dietary: { sheet: "Dietary", fields: ["name", "dietary", "lang"] },
};

/** Longest text kept per field; matches the maxlength limits in index.html. */
var MAX_LEN = 1000;

/** Handles a form POST from the website and returns { ok: true } or { ok: false, error }. */
function doPost(e) {
  try {
    var p = (e && e.parameter) || {};
    var form = FORMS[p.formType];
    if (!form) return reply({ ok: false, error: "Unknown form" });
    // Honeypot field is invisible to people; if it's filled, a bot sent this. Pretend success, save nothing.
    if (p.website) return reply({ ok: true });
    if (!clean(p.name)) return reply({ ok: false, error: "Name is required" });

    var lock = LockService.getScriptLock();
    lock.waitLock(10000); // avoid two replies writing the same row at once
    try {
      var sheet = getSheet(form);
      var row = [new Date()].concat(form.fields.map(function (f) { return clean(p[f]); }));
      sheet.appendRow(row);
    } finally {
      lock.releaseLock();
    }
    return reply({ ok: true });
  } catch (err) {
    console.error("doPost failed: " + err);
    return reply({ ok: false, error: "Server error" });
  }
}

/** Returns the form's sheet, creating it with a header row if missing. */
function getSheet(form) {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.getSheetByName(form.sheet);
  if (!sheet) {
    sheet = book.insertSheet(form.sheet);
    sheet.appendRow(["timestamp"].concat(form.fields));
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Trims and shortens a value. A leading = + - @ is prefixed with ' so a
 * guest's text can never run as a spreadsheet formula.
 */
function clean(value) {
  var text = String(value == null ? "" : value).trim().slice(0, MAX_LEN);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
