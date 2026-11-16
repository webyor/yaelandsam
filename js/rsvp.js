/**
 * RSVP flow.
 *  1. Guest types their name (#find-form). The Apps Script looks it up in the
 *     Google Sheet's "Guests" tab and returns their party: { name, members: [...] }.
 *  2. #rsvp-form shows the party name, how many people are in it, and a
 *     yes/no choice for each person. Answers are sent as att_0, att_1, ...
 *     The server re-checks the party, so guests can't add names.
 */
(function () {
  "use strict";

  const { t, setStatus, post } = window.SITE;
  const findForm = document.getElementById("find-form");
  const rsvpForm = document.getElementById("rsvp-form");
  let party = null; // { name, members: [string] } after a successful lookup

  /** Error codes the server can return for a lookup, mapped to message keys. */
  const LOOKUP_ERRORS = { not_found: "rsvp.notFound", multiple: "rsvp.multiple", already_replied: "rsvp.alreadyReplied" };

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

  /** One fieldset per person: their name and Attending / Not attending. */
  function memberFieldset(name, i) {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = name;
    fieldset.append(legend);
    [["yes", "rsvp.yes"], ["no", "rsvp.no"]].forEach(([value, key], j) => {
      const wrap = document.createElement("label");
      const radio = document.createElement("input");
      wrap.className = "inline";
      radio.type = "radio";
      radio.name = "att_" + i;
      radio.value = value;
      radio.required = j === 0; // one required radio makes the whole group required
      wrap.append(radio, " ", label(key));
      fieldset.append(wrap);
    });
    return fieldset;
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

  async function sendRsvp(event) {
    event.preventDefault();
    const button = rsvpForm.querySelector("button[type=submit]");
    button.disabled = true;
    setStatus(rsvpForm, "forms.sending", "");
    try {
      const body = await post(rsvpForm);
      if (body.error === "already_replied") {
        // Another reply for this party got in first (e.g. a second device).
        setStatus(rsvpForm, "rsvp.alreadyReplied", "err");
        button.hidden = true;
        return;
      }
      if (!body.ok) throw new Error(body.error || "Server rejected the reply");
      setStatus(rsvpForm, "forms.thanks", "ok");
      button.hidden = true; // done; guests can still use "Not you?" to start over
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
    rsvpForm.querySelector("button[type=submit]").hidden = false;
    findForm.reset();
    show(findForm);
  }

  document.getElementById("open-rsvp").addEventListener("click", () => show(party ? rsvpForm : findForm));
  document.getElementById("not-me").addEventListener("click", startOver);
  findForm.addEventListener("submit", findParty);
  rsvpForm.addEventListener("submit", sendRsvp);
  document.addEventListener("langchange", renderPartySize);
})();
