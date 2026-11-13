// MMC SongPoint settings. Edit these, then rebuild the app.
window.HYMNAL_CONFIG = {
  appName: "MMC SongPoint",

  // Google API key (Google Cloud console > APIs & Services > Credentials),
  // restricted to the Google Drive API. It can only read folders shared as
  // "Anyone with the link".
  apiKey: "AIzaSyAmVMlKYs-RSB0bIEzrULMdrm_ORRpai2U",

  // The shared parent folder. Each subfolder becomes a tab.
  rootFolder: "1PgWHpL8UcC-gSJLue60OmJCZtlr9h3Yc",
  // MIDI files, a folder per book like the MP3s (SongPoint › Hymnal MIDI, shared "Anyone with the link")
  midiFolder: "1gbr1Fs8XcyGZ2sIxcAI6w1vzhxp2bjgd",

  // Shared folder with sheet music (PDF/PNG), organised in the same book folders.
  sheetsFolder: "1l_7KwdxcOQdNoQGOBykE-FU1yvYZjhRe",


  // Shared folder with chord charts (ChordPro, incl. SongSelect .txt downloads), in book folders (e.g. SFP, Misc).
  chordsFolder: "1ep5r5BFyVg9Wu9tZvkEKQwcZc4Lm2tGQ",

  // Slide pictures (Slide Images), one folder per song in the same book folders.
  slideImagesFolder: "1ushl4sKjW03TOb00Q6-n60Uz6jlcfZgU",   // Slide Images: one folder of slide pictures per song (made with "Save slides as pictures")
  slidesProxy: "https://songpoint-slides.worshipteammmc.workers.dev",   // Cloudflare Worker that serves (and keeps a copy of) the slide pictures; Drive and the server are the fallbacks

  // Where the Android app looks for updates (GitHub releases).
  updateRepo: "MMCSongPoint/mmcsongpoint.github.io",
  webUrl: "https://mmcsongpoint.github.io/",
  // The listening page on its own (Firebase Hosting, project "songpoint"): approved MIDI songs, no sign-in.
  listenUrl: "https://songpoint.web.app/",

  // SongPoint server: accounts, song-list log, PowerPoint builder (Google Sheet "SongPoint Log" via its Apps Script web app).
  logUrl: "https://script.google.com/macros/s/AKfycby1iDryxk6b9SMzWLGpgASr-wnzV1VuCdvAu6IsZjETKKe0Uus_5UNRLRrC2qvsSwE5/exec",

  // Firebase Realtime Database (worship team account): followers get the leader's slide / song changes through it in
  // a fraction of a second when the Wi-Fi won't let devices connect to each other. Empty = use the Apps Script server.
  rtdb: "https://songpoint-default-rtdb.firebaseio.com",

  // Tab order (folders not listed come last, A-Z).
  collectionOrder: ["Misc", "SFP", "Zions Praises", "Christian Hymnal"],

  // Re-check Drive for changes when the app opens, if the last check is older than this.
  syncMinutes: 30,

  driveApi: "https://www.googleapis.com"
};
