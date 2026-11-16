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
| `images/` | Photos |

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
- Guests type their first and last name. Capital letters, extra spaces and
  accents don't matter.
- **Other Spellings** is optional: other full names to accept, separated by
  `;`. Use it for Hebrew or Russian spellings and nicknames.
- If two parties have someone with the same name, that guest is asked to
  contact you.

RSVPs land in an **RSVP** tab with one row per person, marked `yes` or `no`.
Each party can RSVP only once. If someone from a party that already replied
tries again, the site asks them to contact you, and the Google account that
owns the script gets an email with their answers on file. To change a party's
answer, edit its rows in the RSVP tab. To let them reply again on the site,
delete their rows.

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
