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
 * Hosts the Hymnal Tracks web interface (assets/www) in a WebView and gives it a
 * small native bridge for offline downloads and background playback.
 */
public class MainActivity extends Activity {

    static MainActivity current;

    private WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService downloads = Executors.newFixedThreadPool(2);
    private final Set<String> inProgress = new HashSet<>();
    private boolean askedNotifications;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        current = this;
        getWindow().setStatusBarColor(Color.parseColor("#0f1115"));
        getWindow().setNavigationBarColor(Color.parseColor("#171a21"));

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0f1115"));
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
        web.setWebChromeClient(new WebChromeClient());
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

    private File audioDir() {
        File d = new File(getFilesDir(), "audio");
        if (!d.exists()) d.mkdirs();
        return d;
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

        @JavascriptInterface
        public String localUrl(String id) {
            File f = new File(audioDir(), safeId(id) + ".mp3");
            return f.exists() && f.length() > 0 ? Uri.fromFile(f).toString() : "";
        }

        @JavascriptInterface
        public String downloadedIds() {
            JSONArray out = new JSONArray();
            File[] files = audioDir().listFiles();
            if (files != null) {
                for (File f : files) {
                    String n = f.getName();
                    if (n.endsWith(".mp3") && f.length() > 0) out.put(n.substring(0, n.length() - 4));
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
            final String key = safeId(id);
            synchronized (inProgress) {
                if (!inProgress.add(key)) return;
            }
            downloads.execute(() -> {
                File target = new File(audioDir(), key + ".mp3");
                File tmp = new File(audioDir(), key + ".part");
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
                    synchronized (inProgress) {
                        inProgress.remove(key);
                    }
                }
                js("window.onNativeDownload && window.onNativeDownload(" + quote(id) + "," + ok + ")");
            });
        }

        @JavascriptInterface
        public void remove(String id) {
            new File(audioDir(), safeId(id) + ".mp3").delete();
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
        public void stopPlayback() {
            main.post(() -> stopService(new Intent(MainActivity.this, PlaybackService.class)));
        }

        @JavascriptInterface
        public void openUrl(String url) {
            main.post(() -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))));
        }
    }
}
