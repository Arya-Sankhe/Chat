package tech.klui.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.lang.ref.WeakReference;

/**
 * Voice mode calls start() once the microphone is open and stop() when the
 * conversation ends. start() resolves { running } only after the service has
 * actually become a foreground service, so the page knows whether the
 * conversation will survive leaving the app.
 */
@CapacitorPlugin(
    name = "VoiceSession",
    permissions = @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }))
public class VoiceSessionPlugin extends Plugin {
  private static final String PREFS = "klui_voice_session";
  private static final String ASKED_NOTIFICATIONS = "asked_notifications";
  private static WeakReference<VoiceSessionPlugin> live = new WeakReference<>(null);

  private final Handler main = new Handler(Looper.getMainLooper());
  private PluginCall pendingStart;
  private int pendingAttempt;
  private int attempts;
  private Runnable startTimeout;

  @Override
  public void load() {
    live = new WeakReference<>(this);
  }

  /** The notification's End button: tell the page to close voice mode. */
  static void dispatchEnd() {
    VoiceSessionPlugin plugin = live.get();
    if (plugin != null) plugin.notifyListeners("end", null);
  }

  /** The service reports whether the start it was given reached the foreground. */
  static void reportStarted(int attempt, boolean running) {
    VoiceSessionPlugin plugin = live.get();
    if (plugin != null) plugin.main.post(() -> {
      if (attempt == plugin.pendingAttempt) plugin.finishStart(running);
    });
  }

  @PluginMethod
  public void start(PluginCall call) {
    // Android 13+ hides the service's notification (and its End button)
    // without this permission. Ask once, the first time voice mode starts;
    // the conversation keeps running in the background either way.
    SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
        && getPermissionState("notifications") != PermissionState.GRANTED
        && !prefs.getBoolean(ASKED_NOTIFICATIONS, false)) {
      prefs.edit().putBoolean(ASKED_NOTIFICATIONS, true).apply();
      requestPermissionForAlias("notifications", call, "notificationsAnswered");
      return;
    }
    startService(call);
  }

  @PermissionCallback
  private void notificationsAnswered(PluginCall call) {
    startService(call);
  }

  private void startService(PluginCall call) {
    main.post(() -> {
      // A newer start replaces one still waiting on the service.
      finishStart(false);
      // Off screen, Android before 14 may start the service yet keep the
      // microphone silent, so report it as not running and let the page retry.
      if (!getActivity().getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.STARTED)) {
        JSObject result = new JSObject();
        result.put("running", false);
        call.resolve(result);
        return;
      }
      int attempt = ++attempts;
      pendingStart = call;
      pendingAttempt = attempt;
      startTimeout = () -> { if (attempt == pendingAttempt) finishStart(false); };
      main.postDelayed(startTimeout, 5000);
      try {
        Intent intent = new Intent(getContext(), VoiceSessionService.class)
            .putExtra(VoiceSessionService.EXTRA_ATTEMPT, attempt);
        ContextCompat.startForegroundService(getContext(), intent);
      } catch (RuntimeException error) {
        // Started while Klui is no longer on screen; the page retries on return.
        finishStart(false);
      }
    });
  }

  private void finishStart(boolean running) {
    if (startTimeout != null) main.removeCallbacks(startTimeout);
    startTimeout = null;
    PluginCall call = pendingStart;
    pendingStart = null;
    pendingAttempt = 0;
    if (call == null) return;
    JSObject result = new JSObject();
    result.put("running", running);
    call.resolve(result);
  }

  @PluginMethod
  public void stop(PluginCall call) {
    main.post(() -> finishStart(false));
    getContext().stopService(new Intent(getContext(), VoiceSessionService.class));
    call.resolve();
  }

  @Override
  protected void handleOnDestroy() {
    getContext().stopService(new Intent(getContext(), VoiceSessionService.class));
  }
}
