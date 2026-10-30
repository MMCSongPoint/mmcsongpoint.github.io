# MMC SongPoint for Android

Search and play the rehearsal MP3s in the shared **Hymnal Mp3s** Google Drive folder.

**Download the app:** [MMC-SongPoint.apk](../../releases/latest/download/MMC-SongPoint.apk)
(on your Android phone, open the link, then open the downloaded file. If asked, allow
installing apps from your browser.)

## Features
- Tabs for each folder: Misc, Songs of Faith and Praise, Zions Praises, Christian Hymnal
- Instant search by title or hymn number, typo-tolerant
- "My part": play your voice part by default, and switch parts mid-song without losing your place
- Save songs for offline use (⬇ on each song, or ⋮ to save a whole book for your part)
- Keeps playing with the screen off, with a Play/Pause notification
- Repeat, slower speeds and 5-second skips for practice

## Adding songs
Drop MP3s into the matching Google Drive folder. The app picks them up the next time it's opened
(or tap ↻). Songs are grouped by hymn number, e.g. `0002 We Praise Thee O God 1.mp3` and
`0002 We Praise Thee O God-w-opt end 1.mp3` become one song with two versions.
The folder must stay shared as **Anyone with the link**.

## Changing settings
Edit `app/src/main/assets/www/config.js` on GitHub (pencil icon) and commit. GitHub builds
a new APK in about 5 minutes (Actions tab), and it shows up under Releases.
Installing a new build over the old one keeps saved songs.

## How it's built
`.github/workflows/build.yml` builds and signs the APK on every change. The signing key is
stored in the repository secrets `KEYSTORE_B64` and `KEYSTORE_PASSWORD`. Keep a backup of it:
without the same key, phones can't update to a new build.
