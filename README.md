# Yael & Sam — Wedding Website

Wedding website for Yael Weber and Sam Matatov, June 20, 2027, at
The Stone House at Clove Lakes, Staten Island, NY. It's a static site, with
no build step, available in English, Hebrew and Russian.

## Files

| Path | What it is |
|------|------------|
| `index.html` | Page structure: all tabs and forms |
| `css/style.css` | Look and feel (greenery, wood, white) |
| `js/lang/en.js`, `he.js`, `ru.js` | **All the text on the site**, one file per language |
| `js/config.js` | RSVP endpoint URL and the countdown time |
| `js/app.js` | Tabs, language switch, countdown, form sending |
| `apps-script/Code.gs` | Google Apps Script that saves form replies into a Google Sheet |
| `js/gate.js`, `js/rsvp.js` | Passcode screen; RSVP lookup and form |
| `images/` | Photos |
| `tools/stamp_assets.py` | Adds `?v=` fingerprints to CSS/JS links so browsers load new files |
| `.htaccess` | GoDaddy only: makes browsers re-check `index.html` on every visit |

### After changing any CSS or JS file

Run this from the repo root before committing:

```bash
python tools/stamp_assets.py
```

It gives every stylesheet and script link in `index.html` a fingerprint of
the file's contents, for example `js/rsvp.js?v=5ba74585`. A changed file gets a
new link, so guests' browsers download it instead of reusing an old saved copy.

## Editing content

All text lives in `js/lang/*.js`. Change it in **all three** files so the
languages stay in sync.

- **Q&A**: add `{ q: "...", a: "..." }` to `faq.items`.
- **Things to Do**: put place names in a spot's `places` list, e.g.
  `{ title: "Where to Eat", places: ["Place A", "Place B"] }`.
  An empty list shows "coming soon".
- **Registry, travel, schedule**: edit the matching section.

## Photos

Save the photos with these exact names, and they replace the placeholders:

- `images/couple.jpg`: the photo of Yael and Sam on the Home tab
- `images/party.jpg`: the photo on the Entertainment & Food tab

The venue picture on the Travel tab uses `images/save-the-date.jpg`.

## Passcode

Guests must type the passcode (`Y&S2027`, not case-sensitive) before the
site shows. The browser remembers it after the first time. To change it, see
the comment at the top of `js/gate.js`.

This keeps casual visitors and search engines out. It isn't real security,
because the repo is public and its files can be read on GitHub.

## RSVP setup (Google Sheet)

The guest list, RSVPs and food-allergy notes all live in a Google Sheet that
you own. The guest list is **not** stored in this repo, so it stays private.
When a guest types their name, the Sheet sends back only that guest's party.

### Guest list format

Make a tab named exactly **Guests**, with these four columns in row 1:

| Party | First Name | Last Name | Other Spellings |
|-------|------------|-----------|-----------------|
| The Weber Family | Yael | Weber | יעל ובר |
| The Weber Family | Dana | Weber | |
| Avi & Rina Cohen | Avi | Cohen | Avraham Cohen; Ави Коэн |
| Avi & Rina Cohen | Rina | Cohen | |

- One row per person. Everyone with the same **Party** text is one party.
  The guest sees that text as the title of their RSVP, and the number of
  rows is how many people are in the party.
- Guests type their first and last name, or just their first name if no other
  guest has the same first name. If two or more guests share a first name, the
  site asks for the full name. This is checked against the English First Name
  column too, so a Hebrew or Russian first name only works when the English
  first name is unique. Capital letters, extra spaces and accents don't matter.
- **Other Spellings** is optional: other full names to accept, separated by
  `;`. Use it for Hebrew or Russian spellings and nicknames.
- Names on the RSVP form follow the alphabet the guest searched with. Search
  in Hebrew, and each person shows their Hebrew spelling from this column. Same
  for Russian. Anyone without a spelling in that alphabet shows their English
  name. The RSVP tab always records the English name (First Name + Last Name).
- If two parties have someone with the same name, that guest is asked to
  contact you.

RSVPs land in an **RSVP** tab with one row per person, marked `yes` or `no`.
A party doesn't have to answer for everyone at the same time. Each person can
be marked Joyfully accepts or Regretfully declines, with nothing preselected.
Anyone left blank isn't saved and can be answered on another visit.

- **Someone who already replied** shows "Already RSVPed" on the form, with no
  choices. Their answer is never shown on the site.
- **If a reply still includes someone who already RSVPed** (for example, the
  form was open on two phones), that person keeps their earlier answer, and
  everyone else in the reply is saved. The site says, for example, "Thank
  you! We received the response for Hillel Weber. Noa Weber already RSVPed.
  If you need to make a change, please reach out to Yael or Sam."
- **After sending, the page goes back to the top of the home tab** and shows
  the result in a box there. If sending fails (for example, no connection),
  the form stays open with the choices so the guest can retry.
- **Answers follow the person, not the party name.** Renaming a party, or
  reordering the Guests tab, doesn't lose or mix up anyone's answer. Renaming a
  *person* (First/Last Name) does disconnect them from their earlier row.
- Older `maybe` rows (from before Maybe was removed) aren't final, so those
  people can still answer on the site.

When a party where everyone has a final answer searches again, the site asks
them to contact you. Repeat attempts email the Google account that owns the
script, with the answers on file, at most once an hour per party. To change a
final answer, edit that person's row in the RSVP tab. To let them reply again
on the site, delete their row.

To check which script version Google is running, send it a `version` request:

```bash
curl -sL --data-urlencode "formType=version" "<your Web app URL>"
```

It should answer with the `SCRIPT_VERSION` at the top of `apps-script/Code.gs`.
An `unknown_form` answer means Google is still running an older copy.

### Connecting the Sheet

1. Create a new Google Sheet, for example "Yael & Sam RSVPs", and add the
   **Guests** tab described above.
2. In the sheet, open **Extensions → Apps Script**. Delete what's there, then
   paste in the contents of `apps-script/Code.gs`. Save.
3. Click **Deploy → New deployment**. Pick type **Web app**. Set
   *Execute as*: **Me**, *Who has access*: **Anyone**. Click **Deploy**, then
   approve the permissions Google asks for.
4. Copy the **Web app URL** (it ends in `/exec`). Paste it into
   `js/config.js` as `FORM_ENDPOINT: "https://script.google.com/macros/s/.../exec"`.
5. On the site, click RSVP and type a name from your Guests tab. The party
   should appear. Send it, and an **RSVP** tab appears in the sheet with
   one row per person. Sending the food-allergy form creates a **Dietary** tab.

Until step 4 is done, the forms tell guests that online replies aren't open yet.
If you edit `Code.gs` later, use **Deploy → Manage deployments → Edit →
New version**, which keeps the same URL.

## Publishing on GitHub Pages

1. Merge this branch into `main` and push.
2. On GitHub, go to the repo's **Settings → Pages**. Under *Source* pick
   **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. The site goes live at `https://webyor.github.io/yaelandsam/`.

## Previewing locally

```bash
python -m http.server 8000
```

Then open http://localhost:8000.
