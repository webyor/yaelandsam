/**
 * RSVP flow.
 *  1. Guest types their name (#find-form): a full name, or just a first name if no
 *     other guest shares it. The Apps Script looks it up in the Google Sheet's
 *     "Guests" tab and returns their party: { name, members: [...] }.
 *  2. #rsvp-form shows the party name, how many people are in it, and for each
 *     person: Joyfully accepts / Regretfully declines, nothing preselected. Guests
 *     answer for whoever they want; anyone left blank isn't sent and can be answered
 *     on a later visit. Someone who already replied shows "Already RSVPed" with no
 *     choices, and their answer is never shown. Answers go as
 *     "att:<English full name>" = "yes" | "no", so they match by name, not position.
 *     At least one is needed.
 *  3. The server saves everyone picked except people who already have a final yes/no,
 *     and returns those as `skipped`. The message then thanks them for whoever was
 *     saved and names who already RSVPed, e.g. "Thank you! We received the response for
 *     Hillel. Noa already RSVPed. If you need to make a change, please reach out to
 *     Yael or Sam."
 *  4. After a reply is handled, the forms close and clear, the page goes back to the
 *     top of the home tab, and the message shows in #rsvp-result. Answering again
 *     means searching again. If sending fails (e.g. no connection), the form stays
 *     open with the guest's choices so they can retry.
 */
(function () {
  "use strict";

  const { t, setStatus, post } = window.SITE;
  const findForm = document.getElementById("find-form");
  const rsvpForm = document.getElementById("rsvp-form");
  const resultBox = document.getElementById("rsvp-result");
  // After a lookup: { name, members: [English names], display: [names in the alphabet the
  // guest searched with], answered: { English name: "yes"|"no"|"maybe" } }. Only whether
  // someone answered is used; the answer itself is never shown.
  // ("maybe" can only come from older replies; it isn't final, so they get choices again.)
  let party = null;

  /** Error codes the server can return for a lookup, mapped to message keys. */
  const LOOKUP_ERRORS = {
    not_found: "rsvp.notFound",
    multiple: "rsvp.multiple",
    need_full_name: "rsvp.needFullName", // first name shared by more than one guest
    already_replied: "rsvp.alreadyReplied",
  };

  /** The answers a guest can give, in display order, with their label keys. */
  const ANSWER_KEYS = { yes: "rsvp.yes", no: "rsvp.no" };

  function show(form) {
    findForm.hidden = form !== findForm;
    rsvpForm.hidden = form !== rsvpForm;
    form.scrollIntoView({ behavior: "smooth" });
  }

  /** Makes a span whose text follows the active language. */
  function label(key) {
    const span = document.createElement("span");
    span.dataset.i18n = key;
    span.textContent = t(key);
    return span;
  }

  /** True if this person already has a final answer (yes/no) on file. */
  function alreadyAnswered(name) {
    const a = (party.answered || {})[name];
    return a === "yes" || a === "no";
  }

  /**
   * One fieldset per person: Joyfully accepts / Regretfully declines, nothing preselected,
   * so guests can answer for just the people they want. Someone who already replied
   * shows only "Already RSVPed" (no choices, no hint of their answer). `name` is the
   * English name (sent with the answer); the legend shows the name in the guest's alphabet.
   */
  function memberFieldset(name, i) {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = (party.display || [])[i] || name;
    fieldset.append(legend);
    if (alreadyAnswered(name)) {
      const note = document.createElement("p");
      note.className = "muted";
      note.append(label("rsvp.alreadyRsvped"));
      fieldset.append(note);
      return fieldset;
    }
    Object.entries(ANSWER_KEYS).forEach(([value, key]) => {
      const wrap = document.createElement("label");
      const radio = document.createElement("input");
      wrap.className = "inline";
      radio.type = "radio";
      radio.name = "att:" + name;
      radio.value = value;
      wrap.append(radio, " ", label(key));
      fieldset.append(wrap);
    });
    return fieldset;
  }

  /** English names of the people who have an answer picked. */
  function pickedNames() {
    return [...rsvpForm.querySelectorAll("input[type=radio]:checked")].map((r) => r.name.slice("att:".length));
  }

  function renderPartySize() {
    if (party) document.getElementById("party-size").textContent = t("rsvp.partyOf").replace("{n}", party.members.length);
  }

  function renderParty() {
    document.getElementById("party-name").textContent = party.name;
    rsvpForm.party.value = party.name;
    document.getElementById("party-members").replaceChildren(...party.members.map(memberFieldset));
    renderPartySize();
    setStatus(rsvpForm, "", "");
  }

  async function findParty(event) {
    event.preventDefault();
    const button = findForm.querySelector("button[type=submit]");
    button.disabled = true;
    setStatus(findForm, "rsvp.searching", "");
    try {
      const body = await post(findForm);
      if (!body.ok) {
        setStatus(findForm, LOOKUP_ERRORS[body.error] || "forms.error", "err");
        return;
      }
      party = body.party;
      setStatus(findForm, "", "");
      renderParty();
      show(rsvpForm);
    } catch (err) {
      console.error("Guest lookup failed:", err);
      setStatus(findForm, err.notReady ? "forms.notReady" : "forms.error", "err");
    } finally {
      button.disabled = false;
    }
  }

  /** English names, shown the way the form shows them (in the guest's alphabet). */
  function shownNames(englishNames) {
    return englishNames.map((n) => {
      const i = party.members.indexOf(n);
      return (i !== -1 && party.display && party.display[i]) || n;
    });
  }

  /**
   * Joins names for a sentence: "A", "A and B", "A, B and C" (and the Hebrew/Russian
   * equivalents). In Hebrew "ו" attaches to a Hebrew name ("ואיילת") but takes a hyphen
   * before a name in another alphabet ("ו-Ayelet").
   */
  function joinNames(names) {
    if (names.length < 2) return names.join("");
    const last = names[names.length - 1];
    let and = t("rsvp.and");
    if (document.documentElement.lang === "he" && !/\p{Script=Hebrew}/u.test(last)) and = " ו-";
    return names.slice(0, -1).join(", ") + and + last;
  }

  /**
   * Result message after sending. `picked` = people answered in this reply, `skipped` =
   * those the server didn't save because they already had a final answer.
   *  - none skipped: "Thank you! We received your reply."
   *  - some skipped: "Thank you! We received the response for <saved>. <skipped> already
   *                  RSVPed. If you need to make a change, please reach out to Yael or Sam."
   *  - all skipped:  "<skipped> already RSVPed. If you need to make a change, ..."
   * One skipped person uses "alreadyOne" (singular verb in Hebrew and Russian).
   * Returns { text, kind } with kind "ok", or "err" when nothing was saved.
   */
  function resultMessage(picked, skipped) {
    if (skipped.length === 0) return { text: t("forms.thanks"), kind: "ok" };
    const saved = picked.filter((n) => !skipped.includes(n));
    const already = t(skipped.length === 1 ? "rsvp.alreadyOne" : "rsvp.alreadyMany")
      .replace("{skipped}", joinNames(shownNames(skipped)));
    if (saved.length === 0) return { text: already, kind: "err" };
    const thanks = t("rsvp.savedFor").replace("{saved}", joinNames(shownNames(saved)));
    return { text: thanks + " " + already, kind: "ok" };
  }

  /** Closes and clears both RSVP forms. */
  function closeForms() {
    party = null;
    rsvpForm.reset();
    findForm.reset();
    setStatus(rsvpForm, "", "");
    setStatus(findForm, "", "");
    findForm.hidden = true;
    rsvpForm.hidden = true;
  }

  /** After a reply: close the forms, go back to the top of the home tab and show the message there. */
  function backHome(message) {
    closeForms();
    resultBox.textContent = message.text;
    resultBox.className = "rsvp-result " + message.kind;
    resultBox.hidden = false;
    if (location.hash !== "#home") location.hash = "#home"; // also scrolls to the top (app.js)
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function sendRsvp(event) {
    event.preventDefault();
    const picked = pickedNames();
    if (picked.length === 0) {
      setStatus(rsvpForm, "rsvp.pickOne", "err");
      return;
    }
    const button = rsvpForm.querySelector("button[type=submit]");
    button.disabled = true;
    setStatus(rsvpForm, "forms.sending", "");
    try {
      const body = await post(rsvpForm);
      let message;
      if (body.error === "already_replied") {
        message = resultMessage(picked, picked); // everyone picked already had a final answer
      } else if (body.ok) {
        message = resultMessage(picked, body.skipped || []);
      } else {
        throw new Error(body.error || "Server rejected the reply");
      }
      backHome(message);
    } catch (err) {
      console.error("RSVP failed:", err);
      setStatus(rsvpForm, err.notReady ? "forms.notReady" : "forms.error", "err");
    } finally {
      button.disabled = false;
    }
  }

  function startOver() {
    party = null;
    rsvpForm.reset();
    findForm.reset();
    show(findForm);
  }

  document.getElementById("open-rsvp").addEventListener("click", () => {
    resultBox.hidden = true; // starting a new RSVP: clear the last result
    show(party ? rsvpForm : findForm);
  });
  document.getElementById("not-me").addEventListener("click", startOver);
  findForm.addEventListener("submit", findParty);
  rsvpForm.addEventListener("submit", sendRsvp);
  document.addEventListener("langchange", renderPartySize);
})();
