package tech.klui.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Keeps a voice conversation alive while Klui is in the background or the
 * screen is off. Android only lets a background app hear the microphone (and
 * keeps its process from being frozen) while a foreground service with a
 * visible notification is running, so voice mode holds one for its lifetime.
 */
public class VoiceSessionService extends Service {
  static final String ACTION_END = "tech.klui.app.voice.END";
  static final String EXTRA_ATTEMPT = "attempt";
  private static final String CHANNEL_ID = "voice_session";
  private static final int NOTIFICATION_ID = 4107;

  private PowerManager.WakeLock wakeLock;

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    if (intent != null && ACTION_END.equals(intent.getAction())) {
      // "End" on the notification: the page closes voice mode, which stops us.
      VoiceSessionPlugin.dispatchEnd();
      stopSelf();
      return START_NOT_STICKY;
    }
    int attempt = intent != null ? intent.getIntExtra(EXTRA_ATTEMPT, 0) : 0;
    try {
      int types = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
          ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE | ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
          : 0;
      ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), types);
    } catch (RuntimeException error) {
      // Not allowed right now (started from the background, or no microphone
      // permission): voice mode still works while the app is open.
      VoiceSessionPlugin.reportStarted(attempt, false);
      stopSelf();
      return START_NOT_STICKY;
    }
    VoiceSessionPlugin.reportStarted(attempt, true);
    if (wakeLock == null) {
      PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
      wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Klui:VoiceSession");
      wakeLock.setReferenceCounted(false);
      // A safety limit; a normal call ends long before and releases it.
      wakeLock.acquire(4 * 60 * 60 * 1000L);
    }
    // If Android kills the app the call is over; never restart on our own.
    return START_NOT_STICKY;
  }

  private Notification buildNotification() {
    NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL_ID) == null) {
      NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Voice mode", NotificationManager.IMPORTANCE_LOW);
      channel.setDescription("Shown while a voice conversation with Klui is on.");
      channel.setShowBadge(false);
      manager.createNotificationChannel(channel);
    }
    int immutable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
    Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
    PendingIntent openIntent = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | immutable);
    Intent end = new Intent(this, VoiceSessionService.class).setAction(ACTION_END);
    PendingIntent endIntent = PendingIntent.getService(this, 1, end, PendingIntent.FLAG_UPDATE_CURRENT | immutable);
    return new NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_stat_voice)
        .setContentTitle("Voice mode is on")
        .setContentText("Klui is listening. Tap to return to the conversation.")
        .setContentIntent(openIntent)
        .addAction(0, "End", endIntent)
        .setOngoing(true)
        .setSilent(true)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .build();
  }

  @Override
  public void onDestroy() {
    if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    wakeLock = null;
    super.onDestroy();
  }

  @Override
  public void onTaskRemoved(Intent rootIntent) {
    // Swiping Klui away from recents ends the call.
    stopSelf();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
