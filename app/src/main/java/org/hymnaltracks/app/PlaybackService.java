package org.hymnaltracks.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * A foreground service that shows "Now playing" with a Play/Pause button and keeps
 * the app running while music plays with the screen off.
 */
public class PlaybackService extends Service {
    private static final String CHANNEL = "playback";
    private static final int ID = 7;
    private PowerManager.WakeLock wakeLock;
    private String title = "", subtitle = "";
    private boolean playing;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Playback", NotificationManager.IMPORTANCE_LOW);
        ch.setShowBadge(false);
        getSystemService(NotificationManager.class).createNotificationChannel(ch);
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "HymnalTracks:playback");
        wakeLock.setReferenceCounted(false);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "toggle".equals(intent.getAction())) {
            if (MainActivity.current != null) MainActivity.current.togglePlayback();
            return START_NOT_STICKY;
        }
        if (intent != null && intent.hasExtra("playing")) {
            playing = intent.getBooleanExtra("playing", false);
            String t = intent.getStringExtra("title");
            String s = intent.getStringExtra("subtitle");
            if (t != null) title = t;
            if (s != null) subtitle = s;
        }

        Notification n = build();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(ID, n);
        }

        if (playing) {
            wakeLock.acquire(3 * 60 * 60 * 1000L); // safety cap of 3 hours
        } else {
            if (wakeLock.isHeld()) wakeLock.release();
            stopForeground(STOP_FOREGROUND_DETACH); // leave the notification, let Android reclaim if idle
        }
        return START_NOT_STICKY;
    }

    private Notification build() {
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent toggle = PendingIntent.getService(this, 1,
                new Intent(this, PlaybackService.class).setAction("toggle"),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification.Action action = new Notification.Action.Builder(
                Icon.createWithResource(this, playing ? R.drawable.ic_pause : R.drawable.ic_play),
                playing ? "Pause" : "Play", toggle).build();

        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_note)
                .setContentTitle(title.isEmpty() ? getString(R.string.app_name) : title)
                .setContentText(subtitle)
                .setContentIntent(open)
                .setOngoing(playing)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setCategory(Notification.CATEGORY_TRANSPORT)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .addAction(action)
                .setStyle(new Notification.MediaStyle().setShowActionsInCompactView(0))
                .build();
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }
}
