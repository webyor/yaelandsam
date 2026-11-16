/**
 * Site settings you may need to change.
 *
 * FORM_ENDPOINT: the "Web app URL" you get after deploying
 * apps-script/Code.gs in Google Apps Script (see README.md, "RSVP setup").
 * While it is empty, the RSVP and food-allergy forms show a message
 * saying replies are not open yet instead of pretending to send.
 *
 * WEDDING_START: the countdown target. 6:00 PM New York time (EDT, UTC-4)
 * on June 20, 2027, when the cocktail hour starts.
 */
window.SITE_CONFIG = Object.freeze({
  FORM_ENDPOINT: "",
  WEDDING_START: "2027-06-20T18:00:00-04:00",
  DEFAULT_LANG: "en",
});
