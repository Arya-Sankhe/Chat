package tech.klui.host

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.Promise

/** VoiceSessionPlugin: starts and stops the voice service for the page. */
object KluiVoice {
  private val main = Handler(Looper.getMainLooper())
  private var pending: Promise? = null
  private var pendingAttempt = 0
  private var attempts = 0
  private var timeout: Runnable? = null
  var onEnd: (() -> Unit)? = null

  /** The notification's End button: tell the page to close voice mode. */
  fun dispatchEnd() {
    main.post { onEnd?.invoke() }
  }

  /** The service reports whether the start it was given reached the foreground. */
  fun reportStarted(attempt: Int, running: Boolean) {
    main.post { if (attempt == pendingAttempt) finish(running) }
  }

  fun start(context: Context, activity: Activity?, promise: Promise) {
    main.post {
      // A newer start replaces one still waiting on the service.
      finish(false)
      // Off screen, Android before 14 may start the service yet keep the
      // microphone silent, so report it as not running and let the page retry.
      val started = (activity as? LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.STARTED) ?: false
      if (!started) {
        promise.resolve(mapOf("running" to false))
        return@post
      }
      val attempt = ++attempts
      pending = promise
      pendingAttempt = attempt
      timeout = Runnable { if (attempt == pendingAttempt) finish(false) }.also { main.postDelayed(it, 5000) }
      try {
        val intent = Intent(context, KluiVoiceService::class.java).putExtra(KluiVoiceService.EXTRA_ATTEMPT, attempt)
        ContextCompat.startForegroundService(context, intent)
      } catch (_: RuntimeException) {
        // Started while Klui is no longer on screen; the page retries on return.
        finish(false)
      }
    }
  }

  fun stop(context: Context) {
    main.post { finish(false) }
    context.stopService(Intent(context, KluiVoiceService::class.java))
  }

  private fun finish(running: Boolean) {
    timeout?.let { main.removeCallbacks(it) }
    timeout = null
    val promise = pending
    pending = null
    pendingAttempt = 0
    promise?.resolve(mapOf("running" to running))
  }
}
