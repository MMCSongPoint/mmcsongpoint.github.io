// Hymnal Tracks settings. Edit these, then rebuild the app.
window.HYMNAL_CONFIG = {
  appName: "Hymnal Tracks",

  // Google API key (Google Cloud console > APIs & Services > Credentials),
  // restricted to the Google Drive API. It can only read folders shared as
  // "Anyone with the link".
  apiKey: "AIzaSyAmVMlKYs-RSB0bIEzrULMdrm_ORRpai2U",

  // The shared parent folder. Each subfolder becomes a tab.
  rootFolder: "1isx_RdmSCOOdgDwbczpD-DG0psx2cY2C",

  // Shared folder with sheet music (PDF/PNG), organised in the same book folders.
  sheetsFolder: "1vAVM0v-hyV0aIbRILII6w_U8We2S2Rxh",

  // SHA-256 of the app password (asked once per phone). Set to "" for no password.
  passwordHash: "cc85c1a96dffb0ec870badd6424035ff854532061ceca48db95fb8233781810f",

  // Tab order (folders not listed come last, A-Z).
  collectionOrder: ["Misc", "Songs of Faith and Praise", "Zions Praises", "Christian Hymnal"],

  // Re-check Drive for changes when the app opens, if the last check is older than this.
  syncMinutes: 30,

  driveApi: "https://www.googleapis.com"
};
