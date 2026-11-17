/**
 * Google Apps Script behind the website's forms. It is attached to a Google
 * Sheet, which holds the guest list and collects every reply.
 *
 * Tabs in the Sheet:
 *  - "Guests"  (you fill it in): Party | First Name | Last Name | Other Spellings
 *      One row per person. Everyone with the same Party value is one party.
 *      Other Spellings is optional: extra full names to accept, separated by ";"
 *      (for example a Hebrew or Russian spelling).
 *  - "RSVP"    (created automatically): one row per person. Each PERSON can
 *      reply only once; a party may answer for some people now (yes, no or maybe)
 *      and leave the rest blank to answer later. To change an answer, edit or delete that person's row here.
 *  - "Dietary" (created automatically): food allergies and restrictions.
 *
 * Requests the website sends (formType):
 *  - lookup:  name   -> { ok, party: { name, members: [full names], answered: { name: "yes"|"no"|"maybe" } } }
 *  - rsvp:    party, att_0.. ("yes" | "no" | "maybe", or blank) -> one RSVP row per answered person
 *  - dietary: name, dietary -> one Dietary row
 *  - version             -> { ok, version } (lets the site owner check which script is deployed)
 * If everyone in the party already replied (lookup), or the form tries to answer for
 * someone who already replied (rsvp), the reply is { ok: false, error: "already_replied" }
 * and the script owner gets an email.
 *
 * Setup is in README.md ("RSVP setup").
 */

/** Bump when this file changes, so a "version" request shows whether Google runs the latest copy. */
var SCRIPT_VERSION = "2026-11-17-yes-no-maybe";

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
    if (p.formType === "version") return reply({ ok: true, version: SCRIPT_VERSION });
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
    .normalize("NFD").replace(/\p{M}/gu, "") // strip accent marks
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

/**
 * Finds the one party a typed full name belongs to, with who in it has already
 * replied. If everyone has, the guest is turned away and the owner is emailed.
 */
function lookup(name, lang) {
  var key = normalize(name);
  if (!key) return { ok: false, error: "not_found" };
  var guests = readGuests();
  var matches = guests.index[key] || [];
  if (matches.length === 0) return { ok: false, error: "not_found" };
  if (matches.length > 1) return { ok: false, error: "multiple" }; // same name in two parties
  var party = matches[0];
  var members = guests.parties[party];
  var answered = answersFor(party);
  var open = members.filter(function (m) { return !answered[m]; });
  if (open.length === 0) {
    notifyRepeat(party, "Name typed: " + clean(name), lang, answered);
    return { ok: false, error: "already_replied" };
  }
  var shown = {};
  members.forEach(function (m) { if (answered[m]) shown[m] = answered[m].attending; });
  return { ok: true, party: { name: party, members: members, answered: shown } };
}

// ---------- Saving replies ----------

/**
 * Answers already in the RSVP tab for this party, keyed by guest name:
 * { "Yael Weber": { attending: "yes", when: Date } }. The first answer per person counts.
 */
function answersFor(party) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RSVP_SHEET.sheet);
  var found = {};
  if (!sheet || sheet.getLastRow() < 2) return found;
  sheet.getDataRange().getValues().slice(1).forEach(function (r) {
    var guest = String(r[2]).trim();
    if (String(r[1]).trim() === party && guest && !found[guest]) {
      found[guest] = { attending: String(r[3]), when: r[0] };
    }
  });
  return found;
}

/**
 * Emails the script owner (the Google account that deployed it) about a repeat
 * RSVP attempt. A failed email is logged, never shown to the guest.
 */
function notifyRepeat(party, detail, lang, answered) {
  try {
    var lines = Object.keys(answered).map(function (g) {
      return "  - " + g + ": " + answered[g].attending + "  (" + answered[g].when + ")";
    });
    MailApp.sendEmail({
      to: Session.getEffectiveUser().getEmail(),
      subject: "Repeat RSVP attempt: " + party,
      body: "Someone tried to RSVP again for \"" + party + "\".\n\n" +
        detail + "\n" +
        "Site language: " + clean(lang) + "\n" +
        "Time: " + new Date() + "\n\n" +
        "Answers on file:\n" + lines.join("\n") + "\n\n" +
        "They were asked to contact you. To change someone's answer, edit or delete " +
        "their row in the RSVP tab; once deleted, they can RSVP again on the site.",
    });
  } catch (err) {
    console.error("Repeat-RSVP email failed for " + party + ": " + err);
  }
}

/**
 * Saves one RSVP row per person answered "yes", "no" or "maybe"; anyone left blank is
 * skipped, so they can be answered another time. Member names come from the sheet, not the
 * browser. Refuses the whole reply if it answers for someone who already replied.
 */
function saveRsvp(p) {
  var party = String(p.party || "").trim();
  var members = readGuests().parties[party];
  if (!members) return { ok: false, error: "unknown_party" };
  var answers = members.map(function (_, i) { return String(p["att_" + i] || ""); });
  if (answers.some(function (a) { return ["yes", "no", "maybe", ""].indexOf(a) === -1; })) {
    return { ok: false, error: "bad_answer" };
  }
  var picked = members.filter(function (_, i) { return answers[i] !== ""; });
  if (picked.length === 0) return { ok: false, error: "missing_answer" };
  var now = new Date();
  var rows = members
    .map(function (m, i) { return [now, clean(party), clean(m), answers[i], clean(p.email), clean(p.message), clean(p.lang)]; })
    .filter(function (_, i) { return answers[i] !== ""; });

  // Check and write under one lock, so two replies for the same person at once can't both get in.
  var clash = withLock(function () {
    var answered = answersFor(party);
    if (picked.some(function (m) { return answered[m]; })) return answered;
    var sheet = getSheet(RSVP_SHEET);
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    return null;
  });
  if (clash) {
    notifyRepeat(party, "The RSVP form tried to answer again for someone who already replied " +
      "(for example from a second phone).", p.lang, clash);
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

/**
 * Run this once from the Apps Script editor (pick it in the function menu, click Run).
 * Google then asks for permission to send email, and a test email arrives in your
 * inbox. Redeploying a web app doesn't always ask for new permissions; running a
 * function from the editor does.
 */
function authorizeEmail() {
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), "Wedding RSVP: email alerts are on",
    "This test confirms the RSVP script can email you when a party tries to RSVP twice.");
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
