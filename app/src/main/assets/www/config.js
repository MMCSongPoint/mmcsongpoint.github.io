// MMC SongPoint settings. Edit these, then rebuild the app.
window.HYMNAL_CONFIG = {
  appName: "MMC SongPoint",

  // Google API key (Google Cloud console > APIs & Services > Credentials),
  // restricted to the Google Drive API. It can only read folders shared as
  // "Anyone with the link".
  apiKey: "AIzaSyAmVMlKYs-RSB0bIEzrULMdrm_ORRpai2U",

  // The shared parent folder. Each subfolder becomes a tab.
  rootFolder: "1PgWHpL8UcC-gSJLue60OmJCZtlr9h3Yc",

  // Shared folder with sheet music (PDF/PNG), organised in the same book folders.
  sheetsFolder: "1l_7KwdxcOQdNoQGOBykE-FU1yvYZjhRe",


  // Shared folder with chord charts (ChordPro, incl. SongSelect .txt downloads), in book folders (e.g. SFP, Misc).
  chordsFolder: "1ep5r5BFyVg9Wu9tZvkEKQwcZc4Lm2tGQ",

  // Shared folder with PowerPoint slides (.ppt / .pptx), in the same book folders.
  slidesFolder: "1Hx53-izNpUViULSykFtNfmP0B_4ZNSf6",

  // Where the Android app looks for updates (GitHub releases).
  updateRepo: "MMCSongPoint/mmcsongpoint.github.io",
  webUrl: "https://mmcsongpoint.github.io/",

  // SongPoint server: accounts, song-list log, PowerPoint builder (Google Sheet "SongPoint Log" via its Apps Script web app).
  logUrl: "https://script.google.com/macros/s/AKfycby1iDryxk6b9SMzWLGpgASr-wnzV1VuCdvAu6IsZjETKKe0Uus_5UNRLRrC2qvsSwE5/exec",

  // Tab order (folders not listed come last, A-Z).
  collectionOrder: ["Misc", "SFP", "Zions Praises", "Christian Hymnal"],

  // Re-check Drive for changes when the app opens, if the last check is older than this.
  syncMinutes: 30,

  driveApi: "https://www.googleapis.com"
};
