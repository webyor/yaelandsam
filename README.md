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

## RSVP setup (Google Sheet)

RSVPs and food-allergy notes are saved as rows in a Google Sheet that you own.

1. Create a new Google Sheet, for example "Yael & Sam RSVPs".
2. In the sheet, open **Extensions → Apps Script**. Delete what's there, then
   paste in the contents of `apps-script/Code.gs`. Save.
3. Click **Deploy → New deployment**. Pick type **Web app**. Set
   *Execute as*: **Me**, *Who has access*: **Anyone**. Click **Deploy**, then
   approve the permissions Google asks for.
4. Copy the **Web app URL** (it ends in `/exec`). Paste it into
   `js/config.js` as `FORM_ENDPOINT: "https://script.google.com/macros/s/.../exec"`.
5. Send a test RSVP from the site. The **RSVP** and **Dietary** tabs appear
   in the sheet with the reply as a row.

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
