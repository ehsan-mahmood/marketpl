# Google Drive Credentials Setup (Marketpl)

This guide sets up a Google service account so the server can read and upload product images to a shared Google Drive folder.

## 1) Create or select a Google Cloud project

1. Open <https://console.cloud.google.com/>
2. Use the top project picker to create/select a project.

## 2) Enable Google Drive API

1. Go to **APIs & Services > Library**.
2. Search for **Google Drive API**.
3. Click **Enable**.

## 3) Create a service account

1. Go to **IAM & Admin > Service Accounts**.
2. Click **Create service account**.
3. Name it (example: `marketpl-drive-bot`).
4. Finish creation (no special IAM role is required for Drive file access).

## 4) Create and download JSON key

1. Open the service account.
2. Go to the **Keys** tab.
3. Click **Add key > Create new key**.
4. Choose **JSON** and download.

## 5) Place credentials file in project

Use one of these options:

- Preferred for local setup: place file as:
  - `google-service-account.json` in project root
- Or set env var to custom path:
  - `MARKETPL_GOOGLE_CREDENTIALS=/absolute/path/to/key.json`

PowerShell example:

```powershell
$env:MARKETPL_GOOGLE_CREDENTIALS="C:\path\to\service-account.json"
npm start
```

## 6) Share Drive folder with service account

1. Open downloaded JSON file.
2. Copy `client_email` (ends with `iam.gserviceaccount.com`).
3. In Google Drive, open the assets root folder and click **Share**.
4. Add that `client_email`.
5. Permission:
   - **Viewer** for read-only image serving.
   - **Editor** for read + upload/create folders.

## 7) Configure seller settings

In Seller Settings > Assets:

1. Set source to **Google Drive folder**.
2. Paste full folder share link (supported) or folder ID.
3. Save.

## 8) Restart and test

```powershell
cd "C:\Users\Ehsan Mahmood\Downloads\marketpl"
npm start
```

Then hard refresh browser (`Ctrl+F5`).

## Notes

- Credentials do not need to be created from the seller's Google account.
- Seller only needs to share their Drive folder with your service-account email.
- Keep JSON key private. Do not commit it to git.
