/**
 * Page behaviour for the wedding site:
 *  - tabs driven by the URL hash (#home, #travel, ...)
 *  - language switch (en / he / ru) filled from window.LANG
 *  - countdown to the wedding
 *  - photo placeholders when an image file is not uploaded yet
 *  - RSVP and food-allergy forms posted to the Google Apps Script endpoint
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

  function setLang(code) {
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
    try { localStorage.setItem(LANG_KEY, code); } catch (e) { /* storage blocked: language just won't be remembered */ }
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
    status.textContent = t(key);
    status.className = "form-status " + kind;
  }

  async function submitForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!config.FORM_ENDPOINT) {
      setStatus(form, "forms.notReady", "err");
      return;
    }
    const button = form.querySelector("button[type=submit]");
    const data = new URLSearchParams(new FormData(form));
    data.append("lang", document.documentElement.lang);
    button.disabled = true;
    setStatus(form, "forms.sending", "");
    try {
      // form-urlencoded body keeps this a "simple" request, so Apps Script needs no CORS preflight.
      const res = await fetch(config.FORM_ENDPOINT, { method: "POST", body: data });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || "Server rejected the reply");
      form.reset();
      setStatus(form, "forms.thanks", "ok");
    } catch (err) {
      console.error("Form submit failed:", err);
      setStatus(form, "forms.error", "err");
    } finally {
      button.disabled = false;
    }
  }

  // ---------- Start ----------

  document.querySelectorAll("img[data-fallback]").forEach((img) => {
    const markMissing = () => img.closest(".photo").classList.add("missing");
    img.addEventListener("error", markMissing);
    if (img.complete && img.naturalWidth === 0) markMissing();
  });

  document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));

  document.querySelector(".menu-toggle").addEventListener("click", (e) => {
    const nav = document.getElementById("site-nav");
    const open = nav.classList.toggle("open");
    e.currentTarget.setAttribute("aria-expanded", String(open));
  });

  document.getElementById("open-rsvp").addEventListener("click", () => {
    const form = document.getElementById("rsvp-form");
    form.hidden = false;
    form.scrollIntoView({ behavior: "smooth" });
  });

  document.querySelectorAll("form").forEach((f) => f.addEventListener("submit", submitForm));
  window.addEventListener("hashchange", showTab);

  setLang(savedLang() || config.DEFAULT_LANG);
  showTab();
  tickCountdown();
  setInterval(tickCountdown, 1000);
})();
