/**
 * Google Apps Script behind the website's forms. It is attached to a Google
 * Sheet, which holds the guest list and collects every reply.
 *
 * Tabs in the Sheet:
 *  - "Guests"  (you fill it in): Party | First Name | Last Name | Other Spellings
 *      One row per person. Everyone with the same Party value is one party.
 *      Other Spellings is optional: extra full names to accept, separated by ";"
 *      (for example a Hebrew or Russian spelling).
 *  - "RSVP"    (created automatically): one row per person. Each party can
 *      reply only once; to change an answer, edit or delete its rows here.
 *  - "Dietary" (created automatically): food allergies and restrictions.
 *
 * Requests the website sends (formType):
 *  - lookup:  name            -> { ok, party: { name, members: [full names] } }
 *  - rsvp:    party, att_0..  -> saves one RSVP row per party member
 *  - dietary: name, dietary   -> saves one Dietary row
 * If the party already replied, lookup and rsvp answer { ok: false, error: "already_replied" }
 * and the script owner gets an email about the repeat attempt.
 *
 * Setup is in README.md ("RSVP setup").
 */

var GUESTS_SHEET = "Guests";
var RSVP_SHEET = { sheet: "RSVP", header: ["timestamp", "party", "guest", "attending", "email", "message", "lang"] };
var DIET_SHEET = { sheet: "Dietary", header: ["timestamp", "name", "dietary", "lang"] };

/** Longest text kept per field; matches the maxlength limits in index.html. */
var MAX_LEN = 1000;

/** Entry point for every form POST from the website. Always answers JSON. */
function doPost(e) {
  try {
    var p = (e && e.parameter) || {};
    // Honeypot field is invisible to people; if it's filled, a bot sent this. Pretend success, save nothing.
    if (p.website) return reply({ ok: true });
    if (p.formType === "lookup") return reply(lookup(p.name, p.lang));
    if (p.formType === "rsvp") return reply(saveRsvp(p));
    if (p.formType === "dietary") return reply(saveDietary(p));
    return reply({ ok: false, error: "unknown_form" });
  } catch (err) {
    console.error("doPost failed: " + err);
    return reply({ ok: false, error: "server_error" });
  }
}

// ---------- Guest list ----------

/** Lower-cases, strips accents and punctuation, and collapses spaces so "  Yael  WEBER." matches "Yael Weber". */
function normalize(name) {
  return String(name || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Reads the Guests tab into { partyName: [full names] } plus a name -> party index. */
function readGuests() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(GUESTS_SHEET);
  if (!sheet) throw new Error('Missing "' + GUESTS_SHEET + '" tab');
  var rows = sheet.getDataRange().getValues().slice(1); // skip header row
  var parties = {};
  var index = {}; // normalized name -> list of party names
  rows.forEach(function (r) {
    var party = String(r[0]).trim();
    var full = (String(r[1]).trim() + " " + String(r[2]).trim()).trim();
    if (!party || !full) return; // blank or half-filled row
    (parties[party] = parties[party] || []).push(full);
    [full].concat(String(r[3] || "").split(";")).forEach(function (n) {
      var key = normalize(n);
      if (!key) return;
      index[key] = index[key] || [];
      if (index[key].indexOf(party) === -1) index[key].push(party);
    });
  });
  return { parties: parties, index: index };
}

/** Finds the one party a typed full name belongs to; refuses parties that already replied. */
function lookup(name, lang) {
  var key = normalize(name);
  if (!key) return { ok: false, error: "not_found" };
  var guests = readGuests();
  var matches = guests.index[key] || [];
  if (matches.length === 0) return { ok: false, error: "not_found" };
  if (matches.length > 1) return { ok: false, error: "multiple" }; // same name in two parties
  var party = matches[0];
  var earlier = earlierReply(party);
  if (earlier.length) {
    notifyRepeat(party, "Name typed: " + clean(name), lang, earlier);
    return { ok: false, error: "already_replied" };
  }
  return { ok: true, party: { name: party, members: guests.parties[party] } };
}

// ---------- Saving replies ----------

/** Rows already in the RSVP tab for this party, as [{ guest, attending, when }]. Empty if none. */
function earlierReply(party) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RSVP_SHEET.sheet);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getDataRange().getValues().slice(1)
    .filter(function (r) { return String(r[1]).trim() === party; })
    .map(function (r) { return { when: r[0], guest: r[2], attending: r[3] }; });
}

/**
 * Emails the script owner (the Google account that deployed it) that a party
 * tried to RSVP again. A failed email is logged, never shown to the guest.
 */
function notifyRepeat(party, detail, lang, earlier) {
  try {
    var lines = earlier.map(function (e) { return "  - " + e.guest + ": " + e.attending + "  (" + e.when + ")"; });
    MailApp.sendEmail({
      to: Session.getEffectiveUser().getEmail(),
      subject: "Repeat RSVP attempt: " + party,
      body: "Someone tried to RSVP again for \"" + party + "\".\n\n" +
        detail + "\n" +
        "Site language: " + clean(lang) + "\n" +
        "Time: " + new Date() + "\n\n" +
        "Their RSVP on file:\n" + lines.join("\n") + "\n\n" +
        "They were asked to contact you. To change their answer, edit or delete " +
        "their rows in the RSVP tab; once deleted, they can RSVP again on the site.",
    });
  } catch (err) {
    console.error("Repeat-RSVP email failed for " + party + ": " + err);
  }
}

/** Saves one RSVP row per party member. Member names come from the sheet, not the browser. */
function saveRsvp(p) {
  var party = String(p.party || "").trim();
  var members = readGuests().parties[party];
  if (!members) return { ok: false, error: "unknown_party" };
  var answers = members.map(function (_, i) { return p["att_" + i]; });
  if (answers.some(function (a) { return a !== "yes" && a !== "no"; })) return { ok: false, error: "missing_answer" };
  var now = new Date();
  var rows = members.map(function (m, i) {
    return [now, clean(party), clean(m), answers[i], clean(p.email), clean(p.message), clean(p.lang)];
  });
  // Check and write under one lock, so two replies for the same party at once can't both get in.
  var earlier = withLock(function () {
    var found = earlierReply(party);
    if (found.length) return found;
    var sheet = getSheet(RSVP_SHEET);
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    return [];
  });
  if (earlier.length) {
    notifyRepeat(party, "The RSVP form was sent a second time (for example from another phone).", p.lang, earlier);
    return { ok: false, error: "already_replied" };
  }
  return { ok: true };
}

function saveDietary(p) {
  if (!clean(p.name) || !clean(p.dietary)) return { ok: false, error: "missing_field" };
  withLock(function () {
    getSheet(DIET_SHEET).appendRow([new Date(), clean(p.name), clean(p.dietary), clean(p.lang)]);
  });
  return { ok: true };
}

// ---------- Helpers ----------

/** Runs fn while holding the script lock, so two replies never write the same rows. Returns fn's result. */
function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/** Returns the tab, creating it with a header row if missing. */
function getSheet(def) {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.getSheetByName(def.sheet);
  if (!sheet) {
    sheet = book.insertSheet(def.sheet);
    sheet.appendRow(def.header);
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
