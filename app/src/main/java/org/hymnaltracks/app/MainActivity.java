package org.hymnaltracks.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Hosts the MMC SongPoint web interface (assets/www) in a WebView and gives it a
 * small native bridge for offline downloads and background playback.
 */
public class MainActivity extends Activity {

    static MainActivity current;

    private WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService downloads = Executors.newFixedThreadPool(2);
    private final Set<String> inProgress = new HashSet<>();
    private boolean askedNotifications;
    private android.webkit.ValueCallback<Uri[]> fileCallback;
    private static final int PICK_FILE = 42;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        current = this;
        boolean night = (getResources().getConfiguration().uiMode
                & android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES;
        applyBars(night ? "#141013" : "#f7f2f4", !night);

        web = new WebView(this);
        web.setBackgroundColor(night ? Color.parseColor("#141013") : Color.parseColor("#f7f2f4"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        // The page is our own bundled file; this lets it call the Drive API directly.
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        web.addJavascriptInterface(new Bridge(), "Native");
        web.setWebChromeClient(new WebChromeClient() {
            // Lets <input type="file"> (e.g. "Import notes") open Android's file picker.
            @Override
            public boolean onShowFileChooser(WebView view, android.webkit.ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    Intent i = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                    startActivityForResult(Intent.createChooser(i, "Choose a file"), PICK_FILE);
                    return true;
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("file".equals(u.getScheme())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, u)); // open web links in the browser
                return true;
            }
        });

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl("file:///android_asset/www/index.html");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILE && fileCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) result = new Uri[]{data.getData()};
            fileCallback.onReceiveValue(result);
            fileCallback = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    // Note: we deliberately don't pause the WebView in onPause(), so music keeps
    // playing when the screen is off or another app is open.

    @Override
    protected void onDestroy() {
        if (current == this) current = null;
        stopService(new Intent(this, PlaybackService.class));
        web.destroy();
        downloads.shutdownNow();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.handleBack && window.handleBack()", value -> {
            if (!"true".equals(value)) moveTaskToBack(true); // keep playing in the background
        });
    }

    /** Called from the notification's Play/Pause button. */
    void togglePlayback() {
        main.post(() -> web.evaluateJavascript("window.togglePlay && window.togglePlay()", null));
    }

    /** Colors the status and navigation bars to match the app's light/dark theme. */
    @SuppressWarnings("deprecation")
    void applyBars(String color, boolean light) {
        int c = Color.parseColor(color);
        getWindow().setStatusBarColor(c);
        getWindow().setNavigationBarColor(c);
        android.view.View decor = getWindow().getDecorView();
        int flags = decor.getSystemUiVisibility();
        int lightFlags = android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        decor.setSystemUiVisibility(light ? (flags | lightFlags) : (flags & ~lightFlags));
        if (web != null) web.setBackgroundColor(c);
    }

    private File audioDir() {
        File d = new File(getFilesDir(), "audio");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private static final String[] EXTS = {"mp3", "png", "jpg", "jpeg", "pdf"};

    /** A saved file for this Drive id, whatever its type, or null. */
    private File findLocal(String id) {
        String key = safeId(id);
        for (String ext : EXTS) {
            File f = new File(audioDir(), key + "." + ext);
            if (f.exists() && f.length() > 0) return f;
        }
        return null;
    }

    private static boolean fetch(String url, File target) {
        File tmp = new File(target.getPath() + ".part");
        boolean ok = false;
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(20000);
            c.setReadTimeout(60000);
            c.setInstanceFollowRedirects(true);
            if (c.getResponseCode() == 200) {
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(tmp)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                ok = tmp.length() > 0 && tmp.renameTo(target);
            }
            c.disconnect();
        } catch (Exception ignored) {
        } finally {
            if (!ok) tmp.delete();
        }
        return ok;
    }

    private static String safeId(String id) {
        return id.replaceAll("[^A-Za-z0-9_-]", "");
    }

    private void js(String code) {
        main.post(() -> web.evaluateJavascript(code, null));
    }

    private static String quote(String s) {
        return org.json.JSONObject.quote(s);
    }

    /** Methods callable from JavaScript as window.Native.* */
    class Bridge {
        @JavascriptInterface
        public boolean isAndroid() {
            return true;
        }

        /** {"name": "1.0.12", "code": 12} for the update check. */
        @JavascriptInterface
        public String appVersion() {
            try {
                android.content.pm.PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                long code = Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
                return new org.json.JSONObject().put("name", pi.versionName).put("code", code).toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public String localUrl(String id) {
            File f = findLocal(id);
            return f != null ? Uri.fromFile(f).toString() : "";
        }

        @JavascriptInterface
        public String downloadedIds() {
            JSONArray out = new JSONArray();
            File[] files = audioDir().listFiles();
            if (files != null) {
                for (File f : files) {
                    String n = f.getName();
                    int dot = n.lastIndexOf('.');
                    if (dot > 0 && !n.endsWith(".part") && f.length() > 0) out.put(n.substring(0, dot));
                }
            }
            return out.toString();
        }

        @JavascriptInterface
        public long downloadedBytes() {
            long total = 0;
            File[] files = audioDir().listFiles();
            if (files != null) for (File f : files) total += f.length();
            return total;
        }

        @JavascriptInterface
        public void download(final String id, final String url) {
            downloadAs(id, url, "mp3");
        }

        /** Saves a Drive file for offline use; calls window.onNativeDownload(id, ok). */
        @JavascriptInterface
        public void downloadAs(final String id, final String url, final String ext) {
            final String key = safeId(id);
            final String type = ext != null && ext.matches("[a-z0-9]{2,4}") ? ext : "bin";
            synchronized (inProgress) {
                if (!inProgress.add(key)) return;
            }
            downloads.execute(() -> {
                boolean ok;
                try {
                    ok = fetch(url, new File(audioDir(), key + "." + type));
                } finally {
                    synchronized (inProgress) {
                        inProgress.remove(key);
                    }
                }
                js("window.onNativeDownload && window.onNativeDownload(" + quote(id) + "," + ok + ")");
            });
        }

        /**
         * Turns a PDF (saved, cached, or downloaded now) into page images and calls
         * window.onNativePdf(id, ok, jsonArrayOfImageUrls).
         */
        @JavascriptInterface
        public void renderPdf(final String id, final String url) {
            final String key = safeId(id);
            downloads.execute(() -> {
                JSONArray pages = new JSONArray();
                boolean ok = false;
                try {
                    File pageDir = new File(getCacheDir(), "pages/" + key);
                    File[] done = pageDir.listFiles();
                    if (done != null && done.length > 0 && new File(pageDir, "count").exists()) {
                        int count = Integer.parseInt(new String(java.nio.file.Files.readAllBytes(new File(pageDir, "count").toPath())).trim());
                        for (int i = 0; i < count; i++) pages.put(Uri.fromFile(new File(pageDir, i + ".png")).toString());
                        ok = true;
                    } else {
                        File pdf = findLocal(id);
                        if (pdf == null) {
                            File cacheDir = new File(getCacheDir(), "pdf");
                            cacheDir.mkdirs();
                            pdf = new File(cacheDir, key + ".pdf");
                            if (!pdf.exists() && !fetch(url, pdf)) throw new java.io.IOException("download failed");
                        }
                        pageDir.mkdirs();
                        try (android.os.ParcelFileDescriptor fd = android.os.ParcelFileDescriptor.open(pdf, android.os.ParcelFileDescriptor.MODE_READ_ONLY);
                             android.graphics.pdf.PdfRenderer r = new android.graphics.pdf.PdfRenderer(fd)) {
                            for (int i = 0; i < r.getPageCount(); i++) {
                                try (android.graphics.pdf.PdfRenderer.Page page = r.openPage(i)) {
                                    int w = 1500;
                                    int h = Math.max(1, Math.round(w * (float) page.getHeight() / page.getWidth()));
                                    android.graphics.Bitmap bm = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888);
                                    bm.eraseColor(Color.WHITE);
                                    page.render(bm, null, null, android.graphics.pdf.PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                                    File out = new File(pageDir, i + ".png");
                                    try (OutputStream os = new FileOutputStream(out)) {
                                        bm.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, os);
                                    }
                                    bm.recycle();
                                    pages.put(Uri.fromFile(out).toString());
                                }
                            }
                            try (OutputStream os = new FileOutputStream(new File(pageDir, "count"))) {
                                os.write(String.valueOf(r.getPageCount()).getBytes());
                            }
                        }
                        ok = true;
                    }
                } catch (Exception ignored) {
                }
                js("window.onNativePdf && window.onNativePdf(" + quote(id) + "," + ok + "," + quote(pages.toString()) + ")");
            });
        }

        /** Saves text (e.g. a notes backup) to a file and opens the Android share sheet for it. */
        @JavascriptInterface
        public void shareFile(String name, String content, String mime) {
            shareBytes(name, content.getBytes(java.nio.charset.StandardCharsets.UTF_8), mime);
        }

        /** Same as shareFile, for binary files passed as base64 (e.g. a slide show). */
        @JavascriptInterface
        public void shareBase64(String name, String base64, String mime) {
            shareBytes(name, android.util.Base64.decode(base64, android.util.Base64.DEFAULT), mime);
        }

        private void shareBytes(String name, byte[] bytes, String mime) {
            try {
                File dir = new File(getCacheDir(), "share");
                dir.mkdirs();
                File f = new File(dir, name.replaceAll("[^A-Za-z0-9 ._()-]", "_"));
                try (OutputStream os = new FileOutputStream(f)) {
                    os.write(bytes);
                }
                Uri uri = ShareProvider.uriFor(f);
                Intent send = new Intent(Intent.ACTION_SEND)
                        .setType(mime)
                        .putExtra(Intent.EXTRA_STREAM, uri)
                        .putExtra(Intent.EXTRA_SUBJECT, f.getName())
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                main.post(() -> startActivity(Intent.createChooser(send, f.getName())
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)));
            } catch (Exception e) {
                js("window.toast && window.toast('Could not share the file')");
            }
        }

        /** Saves a file (e.g. sheet music PDF) to the phone's Downloads folder via Android's download manager. */
        @JavascriptInterface
        public void saveToDownloads(String url, String name, String mime) {
            main.post(() -> {
                try {
                    if (Build.VERSION.SDK_INT < 29 && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                        requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, 2);
                        js("window.toast && window.toast('Allow storage access, then tap Download again')");
                        return;
                    }
                    String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
                    android.app.DownloadManager.Request r = new android.app.DownloadManager.Request(Uri.parse(url))
                            .setTitle(safe)
                            .setMimeType(mime)
                            .setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                            .setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS, safe);
                    ((android.app.DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
                    js("window.toast && window.toast('Downloading to your Downloads folder…')");
                } catch (Exception e) {
                    js("window.toast && window.toast('Could not download the file')");
                }
            });
        }

        @JavascriptInterface
        public void keepScreenOn(boolean on) {
            main.post(() -> {
                if (on) getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        @JavascriptInterface
        public void remove(String id) {
            File f;
            while ((f = findLocal(id)) != null) f.delete();
        }

        @JavascriptInterface
        public void removeAll() {
            File[] files = audioDir().listFiles();
            if (files != null) for (File f : files) f.delete();
        }

        /** Keeps the app alive with a notification while music is playing. */
        @JavascriptInterface
        public void playbackState(boolean playing, String title, String subtitle) {
            main.post(() -> {
                if (playing && !askedNotifications && Build.VERSION.SDK_INT >= 33
                        && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    askedNotifications = true;
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
                }
                Intent i = new Intent(MainActivity.this, PlaybackService.class)
                        .putExtra("playing", playing)
                        .putExtra("title", title)
                        .putExtra("subtitle", subtitle);
                try {
                    startForegroundService(i);
                } catch (Exception ignored) {
                    // Android may refuse to start it in rare background cases; playback still works.
                }
            });
        }

        @JavascriptInterface
        public void setSystemBars(String color, boolean light) {
            main.post(() -> {
                try {
                    applyBars(color, light);
                } catch (Exception ignored) {
                }
            });
        }

        @JavascriptInterface
        public void stopPlayback() {
            main.post(() -> stopService(new Intent(MainActivity.this, PlaybackService.class)));
        }

        @JavascriptInterface
        public void openUrl(String url) {
            main.post(() -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))));
        }
    }
}
