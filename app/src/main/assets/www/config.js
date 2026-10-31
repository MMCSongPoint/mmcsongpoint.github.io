// MMC SongPoint settings. Edit these, then rebuild the app.
window.HYMNAL_CONFIG = {
  appName: "MMC SongPoint",

  // Google API key (Google Cloud console > APIs & Services > Credentials),
  // restricted to the Google Drive API. It can only read folders shared as
  // "Anyone with the link".
  apiKey: "AIzaSyAmVMlKYs-RSB0bIEzrULMdrm_ORRpai2U",

  // The shared parent folder. Each subfolder becomes a tab.
  rootFolder: "1isx_RdmSCOOdgDwbczpD-DG0psx2cY2C",

  // Shared folder with sheet music (PDF/PNG), organised in the same book folders.
  sheetsFolder: "1vAVM0v-hyV0aIbRILII6w_U8We2S2Rxh",


  // Shared folder with PowerPoint slides (.ppt / .pptx), in the same book folders.
  slidesFolder: "14piomFAoPOo8nBAOT2qs3majiEtZunLq",

  // Where the Android app looks for updates (GitHub releases).
  updateRepo: "jadon1676-cpu/hymnal-tracks",
  webUrl: "https://jadon1676-cpu.github.io/hymnal-tracks/",

  // SongPoint server: accounts, song-list log, PowerPoint builder (Google Sheet "SongPoint Log" via its Apps Script web app).
  logUrl: "https://script.google.com/macros/s/AKfycbznkfdtHJ0RI_6MiQKlRu80g_XOxTZaGNkt18KEGXN-2T4zZoK1Qy7VK5W-88a8a6xgww/exec",

  // Tab order (folders not listed come last, A-Z).
  collectionOrder: ["Misc", "SFP", "Zions Praises", "Christian Hymnal"],

  // Re-check Drive for changes when the app opens, if the last check is older than this.
  syncMinutes: 30,

  driveApi: "https://www.googleapis.com"
};
