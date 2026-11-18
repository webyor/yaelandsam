/**
 * Page behaviour for the wedding site:
 *  - tabs driven by the URL hash (#home, #travel, ...)
 *  - language switch (en / he / ru) filled from window.LANG
 *  - countdown to the wedding
 *  - photo placeholders when an image file is not uploaded yet
 *  - the food-allergy form posted to the Google Apps Script endpoint
 * Shares t(), setStatus() and post() as window.SITE for js/gate.js and
 * js/rsvp.js, and fires a "langchange" event on document when the language changes.
 */
(function () {
  "use strict";

  const config = window.SITE_CONFIG;
  const LANGS = window.LANG; // { en: {...}, he: {...}, ru: {...} }
  const TABS = ["home", "travel", "schedule", "food", "registry", "faq", "todo"];
  const LANG_KEY = "ys-lang";
  let current = LANGS[config.DEFAULT_LANG];

  /** Look up a dotted key such as "nav.home" in the active language. */
  function t(key) {
    const value = key.split(".").reduce((obj, part) => (obj ? obj[part] : undefined), current);
    if (value === undefined) console.warn("Missing translation:", key);
    return value === undefined ? "" : value;
  }

  // ---------- Language ----------

  /** Read the saved language; storage can be blocked (private mode), so fall back quietly. */
  function savedLang() {
    try { return localStorage.getItem(LANG_KEY); } catch (e) { return null; }
  }

  /**
   * Shows the site in `code` ("en" | "he" | "ru"). `remember` saves it as the guest's
   * choice; the first-load default is not saved, so the language screen still appears
   * until the guest actually picks a language.
   */
  function setLang(code, remember) {
    if (!LANGS[code]) code = config.DEFAULT_LANG;
    current = LANGS[code];
    document.documentElement.lang = code;
    document.documentElement.dir = code === "he" ? "rtl" : "ltr";
    document.title = t("pageTitle");
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-alt]").forEach((el) => { el.alt = t(el.dataset.i18nAlt); });
    document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === code)));
    renderFaq();
    renderTodo();
    document.dispatchEvent(new Event("langchange"));
    if (!remember) return;
    try { localStorage.setItem(LANG_KEY, code); } catch (e) { /* storage blocked: language just won't be remembered */ }
  }

  /** Language screen: picking a language applies and remembers it, then reveals the passcode screen (or the site). */
  function pickLang(code) {
    setLang(code, true);
    document.body.classList.remove("choose-lang");
    window.scrollTo(0, 0);
  }

  /** Q&A list: each item is { q, a } in the language file. */
  function renderFaq() {
    const list = document.getElementById("faq-list");
    list.replaceChildren(...t("faq.items").map((item) => {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      const answer = document.createElement("p");
      summary.textContent = item.q;
      answer.textContent = item.a;
      details.append(summary, answer);
      return details;
    }));
  }

  /** Things to do: five cards, each { title, places: [] }. Empty list shows "coming soon". */
  function renderTodo() {
    const grid = document.getElementById("todo-list");
    grid.replaceChildren(...t("todo.items").map((spot) => {
      const card = document.createElement("div");
      const title = document.createElement("h3");
      card.className = "card";
      title.textContent = spot.title;
      card.append(title);
      if (spot.places.length === 0) {
        const soon = document.createElement("p");
        soon.className = "muted";
        soon.textContent = t("todo.soon");
        card.append(soon);
      } else {
        const ul = document.createElement("ul");
        spot.places.forEach((place) => {
          const li = document.createElement("li");
          li.textContent = place;
          ul.append(li);
        });
        card.append(ul);
      }
      return card;
    }));
  }

  // ---------- Tabs ----------

  function showTab() {
    const id = location.hash.slice(1);
    const active = TABS.includes(id) ? id : "home";
    TABS.forEach((tab) => { document.getElementById(tab).hidden = tab !== active; });
    document.querySelectorAll(".site-nav a").forEach((a) => {
      if (a.getAttribute("href") === "#" + active) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    document.getElementById("site-nav").classList.remove("open");
    document.querySelector(".menu-toggle").setAttribute("aria-expanded", "false");
    window.scrollTo(0, 0);
  }

  // ---------- Countdown ----------

  function tickCountdown() {
    const ms = Math.max(0, new Date(config.WEDDING_START) - Date.now());
    const s = Math.floor(ms / 1000);
    document.getElementById("cd-days").textContent = Math.floor(s / 86400);
    document.getElementById("cd-hours").textContent = Math.floor((s % 86400) / 3600);
    document.getElementById("cd-mins").textContent = Math.floor((s % 3600) / 60);
    document.getElementById("cd-secs").textContent = s % 60;
  }

  // ---------- Forms ----------

  function setStatus(form, key, kind) {
    const status = form.querySelector(".form-status");
    status.textContent = key ? t(key) : ""; // empty key clears the message
    status.className = "form-status " + kind;
  }

  /**
   * Sends a form's fields to the Apps Script endpoint and returns its JSON reply.
   * form-urlencoded keeps this a "simple" request, so Apps Script needs no CORS preflight.
   * Throws if the endpoint is not configured (err.notReady) or the request fails.
   */
  async function post(form) {
    if (!config.FORM_ENDPOINT) {
      const err = new Error("FORM_ENDPOINT is not set in js/config.js");
      err.notReady = true;
      throw err;
    }
    const data = new URLSearchParams(new FormData(form));
    data.append("lang", document.documentElement.lang);
    const res = await fetch(config.FORM_ENDPOINT, { method: "POST", body: data });
    return res.json();
  }

  /** Food-allergy form: send, then thank the guest or show an error. */
  async function submitDiet(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    setStatus(form, "forms.sending", "");
    try {
      const body = await post(form);
      if (!body.ok) throw new Error(body.error || "Server rejected the reply");
      form.reset();
      setStatus(form, "forms.thanks", "ok");
    } catch (err) {
      console.error("Form submit failed:", err);
      setStatus(form, err.notReady ? "forms.notReady" : "forms.error", "err");
    } finally {
      button.disabled = false;
    }
  }

  window.SITE = Object.freeze({ t, setStatus, post });

  // ---------- Start ----------

  document.querySelectorAll("img[data-fallback]").forEach((img) => {
    const markMissing = () => img.closest(".photo").classList.add("missing");
    img.addEventListener("error", markMissing);
    if (img.complete && img.naturalWidth === 0) markMissing();
  });

  document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang, true)));
  document.querySelectorAll("[data-pick-lang]").forEach((b) => b.addEventListener("click", () => pickLang(b.dataset.pickLang)));

  document.querySelector(".menu-toggle").addEventListener("click", (e) => {
    const nav = document.getElementById("site-nav");
    const open = nav.classList.toggle("open");
    e.currentTarget.setAttribute("aria-expanded", String(open));
  });

  document.getElementById("diet-form").addEventListener("submit", submitDiet);
  window.addEventListener("hashchange", showTab);

  // A language chosen on an earlier visit skips the language screen.
  const chosen = savedLang();
  setLang(chosen || config.DEFAULT_LANG, false);
  if (chosen) document.body.classList.remove("choose-lang");
  showTab();
  tickCountdown();
  setInterval(tickCountdown, 1000);
})();
