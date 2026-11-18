/**
 * RSVP flow.
 *  1. Guest types their name (#find-form). The Apps Script looks it up in the
 *     Google Sheet's "Guests" tab and returns their party: { name, members: [...] }.
 *  2. #rsvp-form shows the party name, how many people are in it, and for each
 *     person: Joyfully accepts / Regretfully declines / Maybe, nothing preselected.
 *     Guests answer for whoever they want; anyone left blank isn't sent and can be
 *     answered on a later visit. Everyone gets the choices, whether or not they
 *     already replied; the form doesn't reveal earlier answers. Answers go as
 *     "att:<English full name>" = "yes" | "no" | "maybe", so they match by name, not
 *     position. At least one is needed.
 *  3. The server saves everyone picked except people who already have a final yes/no,
 *     and returns those as `skipped`. The message then says who already RSVPed and
 *     whose response was submitted, e.g. "Noa already RSVPed, but the response for
 *     Hillel was submitted."
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
  // guest searched with] }. (The server also sends `answered`; the form doesn't show it.)
  let party = null;

  /** Error codes the server can return for a lookup, mapped to message keys. */
  const LOOKUP_ERRORS = { not_found: "rsvp.notFound", multiple: "rsvp.multiple", already_replied: "rsvp.alreadyReplied" };

  /** The answers a guest can give, in display order, with their label keys. */
  const ANSWER_KEYS = { yes: "rsvp.yes", no: "rsvp.no", maybe: "rsvp.maybe" };

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

  /**
   * One fieldset per person: Joyfully accepts / Regretfully declines / Maybe, nothing
   * preselected, so guests can answer for just the people they want. `name` is the
   * English name (sent with the answer); the legend shows the name in the guest's alphabet.
   */
  function memberFieldset(name, i) {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = (party.display || [])[i] || name;
    fieldset.append(legend);
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

  /** English names, shown the way the form shows them (guest's alphabet), joined with commas. */
  function shownNames(englishNames) {
    return englishNames
      .map((n) => {
        const i = party.members.indexOf(n);
        return (i !== -1 && party.display && party.display[i]) || n;
      })
      .join(", ");
  }

  /**
   * Result message after sending. `picked` = people answered in this reply, `skipped` =
   * those the server didn't save because they already had a final answer. One skipped
   * person uses the "...One" wording (singular verb in Hebrew and Russian).
   *  - none skipped: "Thank you! We received your reply."
   *  - some skipped: "<skipped> already RSVPed, but the response for <saved> was submitted."
   *  - all skipped:  "<skipped> already RSVPed, so nothing was changed. ..."
   * Returns { text, kind } with kind "ok" or "err" (nothing was saved).
   */
  function resultMessage(picked, skipped) {
    const saved = picked.filter((n) => !skipped.includes(n));
    if (skipped.length === 0) return { text: t("forms.thanks"), kind: "ok" };
    const one = skipped.length === 1;
    if (saved.length === 0) {
      return { text: t(one ? "rsvp.allSkippedOne" : "rsvp.allSkipped").replace("{skipped}", shownNames(skipped)), kind: "err" };
    }
    return {
      text: t(one ? "rsvp.someSkippedOne" : "rsvp.someSkipped")
        .replace("{skipped}", shownNames(skipped))
        .replace("{saved}", shownNames(saved)),
      kind: "ok",
    };
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
