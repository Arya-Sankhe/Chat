package tech.klui.host

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.webkit.WebChromeClient
import androidx.core.view.WindowCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class KluiHostModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KluiHost")

    /** The installed package, which is also the OAuth callback scheme. Read from
        the APK rather than the embedded config, so a release whose Gradle step
        ran without APP_VARIANT still returns to itself. */
    Constant("applicationId") { appContext.reactContext?.packageName ?: "" }

    /** Runs script in the page (replies to bridge calls, native events). */
    Function("evaluate") { script: String ->
      KluiHostRegistry.current?.evaluate(script)
    }

    Function("showKeyboard") {
      KluiHostRegistry.current?.showKeyboard()
    }

    Function("hideKeyboard") {
      KluiHostRegistry.current?.hideKeyboard()
    }

    Function("syncSystemBarInsets") {
      KluiHostRegistry.current?.syncSystemBarInsets()
    }

    /** Resolves with the zoom the WebView reports once it is applied. */
    AsyncFunction("setTextZoom") { percent: Int, promise: Promise ->
      val host = KluiHostRegistry.current
        ?: return@AsyncFunction promise.reject(CodedException("ERR_NO_WEBVIEW", "No WebView to zoom", null))
      host.post { promise.resolve(host.setTextZoom(percent)) }
    }

    // Status bar icons and the gesture handle follow the screen behind them: dark on the
    // light theme, light on the dark one. (The Capacitor app had these inverted, which left
    // the clock and battery invisible; this host no longer copies that.)
    Function("setSystemBarStyle") { dark: Boolean ->
      val activity = appContext.currentActivity ?: return@Function
      activity.runOnUiThread {
        WindowCompat.getInsetsController(activity.window, activity.window.decorView).apply {
          isAppearanceLightStatusBars = !dark
          isAppearanceLightNavigationBars = !dark
        }
      }
    }

    // EmailComposePlugin: the draft opens in the mail app itself.
    Function("composeEmail") { app: String, to: String, subject: String, body: String ->
      val activity = appContext.currentActivity ?: throw CodedException("not_installed", "No email app to open.", null)
      val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:"))
      if (to.isNotBlank()) intent.putExtra(Intent.EXTRA_EMAIL, to.split(Regex("\\s*[,;]\\s*")).toTypedArray())
      intent.putExtra(Intent.EXTRA_SUBJECT, subject)
      intent.putExtra(Intent.EXTRA_TEXT, body)
      when (app) {
        "gmail" -> intent.setPackage("com.google.android.gm")
        "outlook" -> intent.setPackage("com.microsoft.office.outlook")
      }
      try {
        activity.startActivity(intent)
      } catch (_: ActivityNotFoundException) {
        throw CodedException("not_installed", "No email app to open.", null)
      }
    }

    Events("onVoiceEnd")

    OnCreate {
      KluiVoice.onEnd = { sendEvent("onVoiceEnd", emptyMap<String, Any>()) }
    }

    OnDestroy {
      appContext.reactContext?.let { KluiVoice.stop(it) }
    }

    OnActivityEntersBackground {
      KluiHostRegistry.current?.onActivityPaused()
    }

    AsyncFunction("voiceStart") { promise: Promise ->
      val context = appContext.reactContext ?: return@AsyncFunction promise.resolve(mapOf("running" to false))
      val start = { KluiVoice.start(context, appContext.currentActivity, promise) }
      // Android 13+ hides the service's notification (and its End button)
      // without this permission. Ask once, the first time voice mode starts;
      // the conversation keeps running in the background either way.
      val prefs = context.getSharedPreferences("klui_voice_session", Context.MODE_PRIVATE)
      val permissions = appContext.permissions
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && permissions != null &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
        !prefs.getBoolean("asked_notifications", false)
      ) {
        prefs.edit().putBoolean("asked_notifications", true).apply()
        permissions.askForPermissions({ start() }, Manifest.permission.POST_NOTIFICATIONS)
      } else {
        start()
      }
    }

    /** The Capacitor app's stored values, for the host to carry over on upgrade. */
    AsyncFunction("readLegacyStorage") {
      val context = appContext.reactContext ?: return@AsyncFunction mapOf("secure" to emptyMap<String, String>(), "prefs" to emptyMap<String, String>())
      KluiLegacyStorage.read(context)
    }

    AsyncFunction("clearLegacyStorage") { secureKeys: List<String>, prefKeys: List<String> ->
      appContext.reactContext?.let { KluiLegacyStorage.clear(it, secureKeys, prefKeys) }
    }

    Function("voiceStop") {
      appContext.reactContext?.let { KluiVoice.stop(it) }
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != KluiWebView.FILE_REQUEST) return@OnActivityResult
      val callback = KluiHostRegistry.pendingFiles ?: return@OnActivityResult
      KluiHostRegistry.pendingFiles = null
      if (payload.resultCode != Activity.RESULT_OK) {
        callback.onReceiveValue(null)
        return@OnActivityResult
      }
      val clip = payload.data?.clipData
      val uris: Array<Uri>? = if (clip != null && clip.itemCount > 0) {
        Array(clip.itemCount) { clip.getItemAt(it).uri }
      } else {
        WebChromeClient.FileChooserParams.parseResult(payload.resultCode, payload.data)
      }
      callback.onReceiveValue(uris)
    }

    View(KluiWebView::class) {
      Events("onMessage", "onLoadEnd")

      Prop("startPath") { view: KluiWebView, path: String -> view.setStartPath(path) }
      Prop("documentStartScript") { view: KluiWebView, script: String -> view.setDocumentStartScript(script) }
      Prop("textZoom") { view: KluiWebView, percent: Int -> view.setTextZoom(percent) }
      Prop("debuggingEnabled") { view: KluiWebView, enabled: Boolean -> view.setDebuggingEnabled(enabled) }

      OnViewDidUpdateProps { view: KluiWebView -> view.loadIfNeeded() }
      OnViewDestroys { view: KluiWebView -> view.destroy() }
    }
  }
}
