<img src="icons/logo.svg" width="72" alt="Plinth logo">

# Plinth — setup guide

**Author:** Md. Farhad Momin

**Plinth** is a phone app for students to record Hassan Index field data. It works with or without
signal and uploads to the supervisor's Google Drive, one folder per project.

```
Phone (offline storage) ──upload──▶ Google Apps Script ──▶ Google Drive
                                                         Hassan Index Field Data/
                                                           Location Key (private)
                                                           Jolshiri/
                                                             Jolshiri - Hassan data   (Buildings, Columns, Walls)
                                                             B001/  photos + B001_data.json
```

The one-time setup takes about 15 minutes on a laptop. After that, students only use their phones.

---

## Part 1 — Put the app online with GitHub Pages

1. Sign in at **github.com** and click **New repository**.
   - Name: `plinth`
   - Visibility: **Public**. GitHub Pages is free only for public repositories. No survey
     data is ever stored here, only the app's code.
   - Click **Create repository**.
2. On the empty repository page, click **uploading an existing file**.
3. Drag in these files and the `icons` folder from this package:
   `index.html`, `app.js`, `calc.js`, `styles.css`, `sw.js`, `manifest.webmanifest` and the `icons/` folder.
   You can also upload `apps-script/` and this `README.md` to keep everything together.
   Click **Commit changes**.
4. Open **Settings → Pages**. Under *Build and deployment*, choose
   **Source: Deploy from a branch**, **Branch: main**, folder **/ (root)**, then **Save**.
5. After 1–2 minutes the page shows your app address, for example:
   `https://farhadmomin.github.io/plinth/`
   Open it once to check that it loads.

## Part 2 — Create the Google Drive upload script

Use the Google account whose Drive should receive the data.

1. Go to **script.google.com** and click **New project**. Rename it `Plinth Upload`.
2. Delete the sample code, then paste the whole of `apps-script/Code.gs`.
3. On the line `var APP_URL = '...'`, replace the address with your app address from Part 1.
   Keep the final `/`. Press **Ctrl+S**.
4. In the toolbar, choose the function **setup** and click **Run**.
   - Google asks for permission. Click **Review permissions**, choose your account, then
     **Advanced → Go to Plinth Upload (unsafe) → Allow**. This warning is normal for
     scripts you write yourself.
   - The log shows *Drive folder ready* and an upload key.
5. Click **Deploy → New deployment**. Click the gear icon, choose **Web app**, and set:
   - **Execute as: Me**
   - **Who has access: Anyone** (required: students upload without signing in; the key protects it)
   - Click **Deploy** and allow access if asked.
6. Choose the function **showSetupLink** and click **Run**. The log shows a **setup link**:
   `https://farhadmomin.github.io/plinth/?url=...&key=...&project=Jolshiri`
   Copy it. That link is everything a student needs.

To make a link for another project, change `['Jolshiri']` in `showSetupLink` to, for example,
`['Jolshiri', 'Mirpur']`, then run it again.

## Part 3 — Students install the app

1. Send the setup link (WhatsApp, Messenger or email).
2. Students open it **in Chrome**. In WhatsApp, tap ⋮ → *Open in Chrome*.
3. Chrome shows **Install app**. If it doesn't, tap ⋮ → **Add to home screen → Install**.
4. Open the app once from the home-screen icon **while online**. After that it works without signal.
5. Tap ⚙︎ → enter **Your name**. Tap **Test connection**; it should say *Connected*.

## Using Plinth (for students)

- **+ New building** creates the next code (B001, B002, …). Agree code ranges within the
  group, for example Rafi B001–B030 and Nila B031–B060, so two phones never use the same code.
  If they do, the upload renames the second one and shows a note.
- Five steps: **Details → Columns → Walls → Photos → Results**. Everything saves as you type.
- Enter sizes the way you measure them (inches, feet, mm, cm or m). The app converts to metres.
- **Results** shows CI, WI_X, WI_Y, WI_min and PI, plus a list of checks to fix,
  such as *"15 columns stated, but 12 entered"*.
- With no signal, keep working; the data stays on the phone. When online, tap
  **Upload to Google Drive**, or let the app upload automatically.
- Do not clear Chrome's data for this site before uploading. Use **Settings → Save backup**
  if a phone has problems.

## What arrives in Drive

| Item | Contents |
|---|---|
| `<Project> - Hassan data` → **Buildings** | One row per building: inputs, A_ft, A_col, wall areas, CI, WI_X, WI_Y, WI_min, PI, CD, WD, Case B, open checks, folder link |
| → **Columns**, **Walls** | Every row as entered, with sizes converted to metres |
| `<Project>/<Code>/` | Photos and the full record (`<Code>_data.json`) |
| `Location Key (private)` | Address and GPS for each building. Keep this out of the thesis. |

Uploading the same building again updates its rows; it never duplicates them.

## Updating later

- **App changes:** upload the changed files to the GitHub repository. Raise the number in the
  first line of `sw.js` (for example `plinth-v1.0.1`) so phones pick up the update. Students get it the
  next time they open the app online.
- **Script changes:** edit the code, then **Deploy → Manage deployments → ✎ → Version: New
  version → Deploy**. The upload link stays the same.
- **Leaked link:** run `resetKey`, then `showSetupLink`, and send the new link.

## Troubleshooting

| Message on the phone | Fix |
|---|---|
| *Wrong upload key* | The student used an old link. Send the current setup link. |
| *Unexpected reply from Drive script* | The deployment is not set to **Who has access: Anyone**, or the link is not the Web app link. |
| *Upload is not set up* | The student opened the app without the setup link. Send the link again, or enter the details in Settings. |
| No *Install app* option | Open the link in Chrome itself, not inside WhatsApp or Facebook. |
| App doesn't open offline | Open it once online from the home-screen icon first. |

## Notes on the method

- Definitions follow Hassan & Sozen (1997) and Pujol et al. (2024): CI = 0.5·A_col/A_ft,
  WI = (A_cw + 0.1·A_mw)/A_ft per direction, PI = CI + WI_min, CD and WD use the typical floor area.
- Column sizes marked *over plaster* are reduced by the plaster allowance on each face
  (default 12 mm, changeable in Settings).
- Uncertain walls count as zero in Case A. In Case B they take the type the student chose.
  A building is *classification-sensitive* if any reference flag changes between the two cases.
- The indices rank buildings for further assessment. They are not a safety rating.
