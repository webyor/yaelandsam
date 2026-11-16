/**
 * Passcode screen.
 *
 * The page loads with <body class="locked">, which hides the site. Guests type
 * the passcode; its SHA-256 hash is compared with PASS_HASH below, so the
 * passcode itself isn't written in the code. Once it's right, the browser
 * remembers it and doesn't ask again.
 *
 * This only keeps casual visitors and search engines out. The repo is public,
 * so the site's files can still be read on GitHub without the passcode.
 *
 * To change the passcode, put the new one in this command and paste the output into PASS_HASH:
 *   python -c "import hashlib;print(hashlib.sha256('NEWCODE'.upper().encode()).hexdigest())"
 * The passcode is not case-sensitive (it's upper-cased before hashing).
 */
(function () {
  "use strict";

  const PASS_HASH = "2c547b8c830e05d445dc8ce57ecff58bcf4908b9fb95e7937002aed10c5564c2"; // Y&S2027
  const KEY = "ys-unlocked";
  const { setStatus } = window.SITE;

  function unlock() {
    document.body.classList.remove("locked");
  }

  /** Returns true if the browser saved an earlier correct entry; storage may be blocked. */
  function remembered() {
    try { return localStorage.getItem(KEY) === PASS_HASH; } catch (e) { return false; }
  }

  async function sha256(text) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  if (remembered()) {
    unlock();
    return;
  }

  document.getElementById("gate-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const hash = await sha256(form.code.value.trim().toUpperCase());
    if (hash !== PASS_HASH) {
      setStatus(form, "gate.wrong", "err");
      form.code.select();
      return;
    }
    try { localStorage.setItem(KEY, PASS_HASH); } catch (e) { /* storage blocked: guest will be asked again next visit */ }
    unlock();
  });
})();
