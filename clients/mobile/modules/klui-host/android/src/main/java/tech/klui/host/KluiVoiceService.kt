package tech.klui.host

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * VoiceSessionService: keeps a voice conversation alive while Klui is in the
 * background or the screen is off. Android only lets a background app hear the
 * microphone (and keeps its process from being frozen) while a foreground
 * service with a visible notification is running, so voice mode holds one for
 * its lifetime.
 */
class KluiVoiceService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_END) {
      // "End" on the notification: the page closes voice mode, which stops us.
      KluiVoice.dispatchEnd()
      stopSelf()
      return START_NOT_STICKY
    }
    val attempt = intent?.getIntExtra(EXTRA_ATTEMPT, 0) ?: 0
    try {
      val types = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
      } else 0
      ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), types)
    } catch (_: RuntimeException) {
      // Not allowed right now (started from the background, or no microphone
      // permission): voice mode still works while the app is open.
      KluiVoice.reportStarted(attempt, false)
      stopSelf()
      return START_NOT_STICKY
    }
    KluiVoice.reportStarted(attempt, true)
    if (wakeLock == null) {
      val power = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Klui:VoiceSession").apply {
        setReferenceCounted(false)
        // A safety limit; a normal call ends long before and releases it.
        acquire(4 * 60 * 60 * 1000L)
      }
    }
    // If Android kills the app the call is over; never restart on our own.
    return START_NOT_STICKY
  }

  private fun buildNotification(): Notification {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL_ID) == null) {
      val channel = NotificationChannel(CHANNEL_ID, "Voice mode", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Shown while a voice conversation with Klui is on."
        setShowBadge(false)
      }
      manager.createNotificationChannel(channel)
    }
    val immutable = PendingIntent.FLAG_IMMUTABLE
    val open = packageManager.getLaunchIntentForPackage(packageName)
    val openIntent = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or immutable)
    val end = Intent(this, KluiVoiceService::class.java).setAction(ACTION_END)
    val endIntent = PendingIntent.getService(this, 1, end, PendingIntent.FLAG_UPDATE_CURRENT or immutable)
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_voice)
      .setContentTitle("Voice mode is on")
      .setContentText("Klui is listening. Tap to return to the conversation.")
      .setContentIntent(openIntent)
      .addAction(0, "End", endIntent)
      .setOngoing(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }

  override fun onDestroy() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    super.onDestroy()
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Swiping Klui away from recents ends the call.
    stopSelf()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  companion object {
    const val ACTION_END = "tech.klui.host.voice.END"
    const val EXTRA_ATTEMPT = "attempt"
    private const val CHANNEL_ID = "voice_session"
    private const val NOTIFICATION_ID = 4107
  }
}
