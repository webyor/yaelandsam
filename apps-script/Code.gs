/**
 * Google Apps Script behind the website's forms. It is attached to a Google
 * Sheet, which holds the guest list and collects every reply.
 *
 * Tabs in the Sheet:
 *  - "Guests"  (you fill it in): Party | First Name | Last Name | Other Spellings
 *      One row per person. Everyone with the same Party value is one party.
 *      Other Spellings is optional: extra full names to accept, separated by ";"
 *      (for example a Hebrew or Russian spelling).
 *  - "RSVP"    (created automatically): one row per person, keyed by their English
 *      full name. "yes"/"no" are final: that person can't be answered again on the
 *      site. "maybe" can later be changed to another answer (the same row is
 *      updated). A party may answer for some people and leave the rest blank. To
 *      change a final answer, edit or delete that person's row here.
 *  - "Dietary" (created automatically): food allergies and restrictions.
 *
 * Requests the website sends (formType):
 *  - lookup:  name   -> { ok, party: { name, members: [English full names], display: [names in the
 *               alphabet the guest searched with], answered: { name: "yes"|"no"|"maybe" } } }
 *  - rsvp:    party, "att:<English full name>" = "yes" | "no" | "maybe" for each person answered
 *  - dietary: name, dietary -> one Dietary row
 *  - version             -> { ok, version } (lets the site owner check which script is deployed)
 * If everyone in the party has a final answer (lookup), the reply is
 * { ok: false, error: "already_replied" }. If an rsvp includes people with a final
 * answer, they are skipped and everyone else is saved: { ok: true, skipped: [names] }
 * (or "already_replied" if all were skipped). Either way the script owner gets an
 * email, at most once an hour per party.
 *
 * Setup is in README.md ("RSVP setup").
 */

/** Bump when this file changes, so a "version" request shows whether Google runs the latest copy. */
var SCRIPT_VERSION = "2026-11-18-partial-save";

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

/**
 * Reads the Guests tab into:
 *  - parties:   { partyName: [English full names] }  (what the RSVP tab records)
 *  - spellings: { partyName: [[other spellings of member 0], [... member 1], ...] }
 *  - index:     normalized name (any spelling) -> list of party names
 */
function readGuests() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(GUESTS_SHEET);
  if (!sheet) throw new Error('Missing "' + GUESTS_SHEET + '" tab');
  var rows = sheet.getDataRange().getValues().slice(1); // skip header row
  var parties = {};
  var spellings = {};
  var index = {}; // normalized name -> list of party names
  rows.forEach(function (r) {
    var party = String(r[0]).trim();
    var full = (String(r[1]).trim() + " " + String(r[2]).trim()).trim();
    if (!party || !full) return; // blank or half-filled row
    var others = String(r[3] || "").split(";").map(function (n) { return n.trim(); }).filter(String);
    (parties[party] = parties[party] || []).push(full);
    (spellings[party] = spellings[party] || []).push(others);
    [full].concat(others).forEach(function (n) {
      var key = normalize(n);
      if (!key) return;
      index[key] = index[key] || [];
      if (index[key].indexOf(party) === -1) index[key].push(party);
    });
  });
  return { parties: parties, spellings: spellings, index: index };
}

/** Which alphabet a typed name uses: "hebrew", "cyrillic" or "latin". */
function alphabetOf(text) {
  if (/\p{Script=Hebrew}/u.test(text)) return "hebrew";
  if (/\p{Script=Cyrillic}/u.test(text)) return "cyrillic";
  return "latin";
}

/**
 * Names to show the guest, in the alphabet they searched with: each member's first
 * Other Spelling in that alphabet, or their English name if there isn't one.
 */
function displayNames(members, others, alphabet) {
  if (alphabet === "latin") return members.slice();
  return members.map(function (m, i) {
    var match = (others[i] || []).filter(function (n) { return alphabetOf(n) === alphabet; })[0];
    return match || m;
  });
}

/**
 * Finds the one party a typed full name belongs to, with each member's answer so
 * far. If everyone has a final answer (yes/no), the guest is turned away and the
 * owner is emailed (at most once an hour per party).
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
  var answered = answersFor(members);
  if (members.every(function (m) { return isFinal(answered[m]); })) {
    notifyRepeat(party, "Name typed: " + clean(name), lang, answered);
    return { ok: false, error: "already_replied" };
  }
  var shown = {};
  members.forEach(function (m) { if (answered[m]) shown[m] = answered[m].attending; });
  var display = displayNames(members, guests.spellings[party], alphabetOf(String(name)));
  return { ok: true, party: { name: party, members: members, display: display, answered: shown } };
}

// ---------- Saving replies ----------

/** "yes" and "no" are final; "maybe" can still be changed on the site. */
function isFinal(answer) {
  return !!answer && answer.attending !== "maybe";
}

/**
 * Current answers for these people, keyed by English full name:
 * { "Yael Weber": { attending: "yes", when: Date, row: 5 } } (row = sheet row number).
 * Matched by person, not by party name, so renaming a party in the Guests tab keeps
 * its answers. If a person somehow has several rows, the last one counts.
 */
function answersFor(members) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RSVP_SHEET.sheet);
  var found = {};
  if (!sheet || sheet.getLastRow() < 2) return found;
  sheet.getDataRange().getValues().forEach(function (r, i) {
    var guest = String(r[2]).trim();
    if (i > 0 && members.indexOf(guest) !== -1) {
      found[guest] = { attending: String(r[3]), when: r[0], row: i + 1 };
    }
  });
  return found;
}

/**
 * Emails the script owner (the Google account that deployed it) about a repeat RSVP
 * attempt, at most once per party per ALERT_EVERY_SECONDS; repeats inside that
 * window are still blocked, just not emailed again. A failed email is logged,
 * never shown to the guest.
 */
var ALERT_EVERY_SECONDS = 3600; // once an hour per party (chosen by the couple)

function notifyRepeat(party, detail, lang, answered) {
  try {
    var cache = CacheService.getScriptCache();
    var key = "alert:" + party;
    if (cache.get(key)) return;
    cache.put(key, "1", ALERT_EVERY_SECONDS);
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
        "their row in the RSVP tab; once deleted, they can RSVP again on the site.\n" +
        "(More tries for this party within the next hour are blocked without another email.)",
    });
  } catch (err) {
    console.error("Repeat-RSVP email failed for " + party + ": " + err);
  }
}

/**
 * Saves the answers sent as "att:<English full name>" = "yes" | "no" | "maybe".
 * Answers are matched by name, so a Guests tab edited between lookup and submit
 * can't put an answer on the wrong person. People left out are skipped. A person
 * whose answer is "maybe" can change it: their row is updated in place, so each
 * person keeps one row. Anyone who already has a final yes/no is skipped (their
 * earlier answer stays) while everyone else in the reply is saved; the reply lists
 * the skipped people as { ok: true, skipped: [names] } and the owner is emailed.
 * If everyone picked was skipped, nothing is saved: { ok: false, error: "already_replied" }.
 */
function saveRsvp(p) {
  var party = String(p.party || "").trim();
  var members = readGuests().parties[party];
  if (!members) return { ok: false, error: "unknown_party" };
  var picked = {};
  for (var k in p) {
    if (k.indexOf("att:") !== 0) continue;
    var guest = k.slice(4);
    if (members.indexOf(guest) === -1) return { ok: false, error: "unknown_guest" };
    if (["yes", "no", "maybe"].indexOf(p[k]) === -1) return { ok: false, error: "bad_answer" };
    picked[guest] = p[k];
  }
  var names = Object.keys(picked);
  if (names.length === 0) return { ok: false, error: "missing_answer" };
  var now = new Date();
  var rowFor = function (g) {
    return [now, clean(party), clean(g), picked[g], clean(p.email), clean(p.message), clean(p.lang)];
  };

  // Check and write under one lock, so two replies for the same person at once can't both get in.
  var result = withLock(function () {
    var answered = answersFor(members);
    var skipped = names.filter(function (g) { return isFinal(answered[g]); });
    var sheet = getSheet(RSVP_SHEET);
    var fresh = [];
    names.forEach(function (g) {
      if (skipped.indexOf(g) !== -1) return; // final answer on file: keep it
      if (answered[g]) {
        sheet.getRange(answered[g].row, 1, 1, RSVP_SHEET.header.length).setValues([rowFor(g)]); // was "maybe"
      } else {
        fresh.push(rowFor(g));
      }
    });
    if (fresh.length) sheet.getRange(sheet.getLastRow() + 1, 1, fresh.length, fresh[0].length).setValues(fresh);
    return { answered: answered, skipped: skipped };
  });
  if (result.skipped.length) {
    notifyRepeat(party, "The RSVP form tried to answer again for: " + result.skipped.join(", ") +
      ". Their earlier answer was kept" +
      (result.skipped.length < names.length ? "; the others in the reply were saved." : "."),
      p.lang, result.answered);
  }
  if (result.skipped.length === names.length) return { ok: false, error: "already_replied" };
  return { ok: true, skipped: result.skipped };
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
