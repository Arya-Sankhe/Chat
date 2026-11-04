package tech.klui.host

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.net.Uri
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.ContextCompat
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.IOException
import java.io.InputStream
import java.net.URLConnection

/**
 * The packaged app's one WebView: the web client served from the APK at
 * https://localhost (the origin the Capacitor app used, which the API's CORS
 * already allows), plus what Capacitor's host and the old TextZoom plugin did
 * natively: text zoom, system bar and animated keyboard insets forwarded to
 * the page as CSS variables, the file chooser and media permissions.
 */
@SuppressLint("ViewConstructor", "SetJavaScriptEnabled")
class KluiWebView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  var webView: WebView = WebView(context)
    private set
  private val onMessage by EventDispatcher()
  private val onLoadEnd by EventDispatcher()

  private var loaded = false
  private var startPath = "/"
  private var documentStartScript = ""
  private var textZoom = 100

  init {
    KluiHostRegistry.current = this
    setUpWebView()
  }

  private fun setUpWebView() {
    // Opaque, as the Capacitor WebView was: with a transparent one, regions
    // Chromium has not redrawn yet (after a resume, under a sheet) show stale
    // frames, e.g. a second settings row over the usage note.
    with(webView.settings) {
      javaScriptEnabled = true
      domStorageEnabled = true
      databaseEnabled = true
      mediaPlaybackRequiresUserGesture = false
      allowFileAccess = false
      allowContentAccess = true
      setSupportMultipleWindows(false)
      mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
    }
    installBridge()
    webView.webViewClient = Client()
    webView.webChromeClient = Chrome()
    addView(webView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
  }

  // region Props

  fun setStartPath(path: String) {
    startPath = if (path.startsWith("/")) path else "/$path"
  }

  fun setDocumentStartScript(script: String) {
    documentStartScript = script
  }

  fun setTextZoom(percent: Int): Int {
    textZoom = percent.coerceIn(85, 130)
    webView.settings.textZoom = textZoom
    val applied = webView.settings.textZoom
    Log.i(TAG, "Text zoom $textZoom% (WebView ${System.identityHashCode(webView)} reports $applied%)")
    return applied
  }

  fun setDebuggingEnabled(enabled: Boolean) {
    WebView.setWebContentsDebuggingEnabled(enabled)
  }

  fun loadIfNeeded() {
    if (loaded) return
    loaded = true
    load(startPath)
  }

  private fun load(path: String) {
    if (documentStartScript.isNotEmpty() && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
      WebViewCompat.addDocumentStartJavaScript(webView, documentStartScript, setOf(ORIGIN))
    }
    webView.loadUrl(ORIGIN + path)
  }

  /** WebViews without document-start scripts get it inlined into each page, as Capacitor did. */
  internal fun inlineStartScript(): String? =
    if (documentStartScript.isEmpty() || WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) null else documentStartScript

  // The page reaches the host only from its own main frame at https://localhost:
  // the chat's sandboxed visualization frames (opaque origins) never see it.
  // There is no JavascriptInterface fallback: that would hand every frame the
  // bridge, so a WebView without WebMessageListener (pre-Chromium 84) gets none.
  private fun installBridge() {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      Log.e(TAG, "WebMessageListener unsupported; native bridge disabled")
      return
    }
    WebViewCompat.addWebMessageListener(webView, BRIDGE, setOf(ORIGIN)) { _, message, _, isMainFrame, _ ->
      val data = message.data
      if (isMainFrame && data != null) onMessage(mapOf("data" to data))
      else Log.w(TAG, "Native calls are allowed from the main frame only")
    }
  }

  /* A WebView whose renderer died cannot be reused: replace it with a fresh
     one on the same page. */
  private fun replaceWebView(gone: WebView) {
    if (gone !== webView) return
    val url = gone.url?.takeIf { it.startsWith(ORIGIN) }?.removePrefix(ORIGIN)?.ifEmpty { "/" } ?: startPath
    removeView(gone)
    gone.destroy()
    webView = WebView(context)
    setUpWebView()
    webView.settings.textZoom = textZoom
    systemBarTop = -1
    systemBarBottom = -1
    keyboardHeight = -1
    load(url)
    syncSystemBarInsets()
    // React Native owns this view's layout and won't lay out a child added later.
    webView.measure(
      View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY)
    )
    webView.layout(0, 0, width, height)
  }

  // endregion

  fun evaluate(script: String) {
    webView.post { webView.evaluateJavascript(script, null) }
  }

  fun showKeyboard() {
    webView.post {
      if (!webView.hasFocus()) webView.requestFocus()
      val activity = appContext.currentActivity ?: return@post
      // Unlike showSoftInput, this waits for window focus and the editor connection.
      WindowCompat.getInsetsController(activity.window, webView).show(WindowInsetsCompat.Type.ime())
    }
  }

  fun hideKeyboard() {
    webView.post {
      val activity = appContext.currentActivity ?: return@post
      WindowCompat.getInsetsController(activity.window, webView).hide(WindowInsetsCompat.Type.ime())
    }
  }

  fun destroy() {
    if (KluiHostRegistry.current === this) KluiHostRegistry.current = null
    removeAllViews()
    webView.destroy()
  }

  // region Insets (TextZoomPlugin.installKeyboardInsets)

  private var keyboardHeight = -1
  private var keyboardUpdatePending = false
  private var imeAnimating = false
  private var targetInsets: WindowInsetsCompat? = null
  private var systemBarTop = -1
  private var systemBarBottom = -1

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    appContext.currentActivity?.let { configureWindow(it) }
    installInsets()
  }

  // The old MainActivity: true edge-to-edge from the first frame, drawn into
  // the camera cutout, with no Android contrast scrim behind the clock and
  // icons. The bars stay visible over the page, which pads itself clear of
  // them (--safe-area-inset-top/bottom).
  @Suppress("DEPRECATION")
  private fun configureWindow(activity: Activity) {
    val window = activity.window
    window.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
    WindowCompat.setDecorFitsSystemWindows(window, false)
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      window.attributes = window.attributes.apply {
        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
      }
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isStatusBarContrastEnforced = false
      window.isNavigationBarContrastEnforced = false
    }
    WindowCompat.getInsetsController(window, window.decorView).show(WindowInsetsCompat.Type.systemBars())
  }

  // Reconnect the editor on resume with one fresh keyboard transition.
  private var keyboardOpenWhenPaused = false

  fun onActivityPaused() {
    val activity = appContext.currentActivity ?: return
    val insets = ViewCompat.getRootWindowInsets(activity.window.decorView)
    keyboardOpenWhenPaused = insets != null && insets.isVisible(WindowInsetsCompat.Type.ime())
    if (keyboardOpenWhenPaused) WindowCompat.getInsetsController(activity.window, webView).hide(WindowInsetsCompat.Type.ime())
  }

  override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
    super.onWindowFocusChanged(hasWindowFocus)
    if (!hasWindowFocus || !keyboardOpenWhenPaused) return
    keyboardOpenWhenPaused = false
    val activity = appContext.currentActivity ?: return
    WindowCompat.getInsetsController(activity.window, webView).show(WindowInsetsCompat.Type.ime())
  }

  private fun installInsets() {
    // Keep the WebView full size: native padding exposes an unpainted strip
    // while Chromium catches up. Only the page's chat layout avoids the IME.
    ViewCompat.setOnApplyWindowInsetsListener(this) { _, insets ->
      targetInsets = insets
      applySystemBarInsets(insets)
      if (!imeAnimating) applyKeyboardInsets(insets)
      // Consume these before Chromium so it cannot apply a second resize.
      WindowInsetsCompat.Builder(insets)
        .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
        .setVisible(WindowInsetsCompat.Type.ime(), false)
        .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.NONE)
        .build()
    }
    val decor = appContext.currentActivity?.window?.decorView ?: rootView
    ViewCompat.setWindowInsetsAnimationCallback(decor, object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_STOP) {
      override fun onPrepare(animation: WindowInsetsAnimationCompat) {
        if (animation.typeMask and WindowInsetsCompat.Type.ime() != 0) imeAnimating = true
      }

      override fun onProgress(insets: WindowInsetsCompat, running: MutableList<WindowInsetsAnimationCompat>): WindowInsetsCompat {
        if (imeAnimating) applyKeyboardInsets(insets)
        return insets
      }

      override fun onEnd(animation: WindowInsetsAnimationCompat) {
        if (animation.typeMask and WindowInsetsCompat.Type.ime() != 0) {
          imeAnimating = false
          // Use the saved destination, never a stale root inset.
          targetInsets?.let { applyKeyboardInsets(it) }
        }
      }
    })
    ViewCompat.requestApplyInsets(this)
  }

  /** The first inset pass can land before the page exists; resend on request. */
  fun syncSystemBarInsets() {
    post {
      systemBarTop = -1
      systemBarBottom = -1
      keyboardHeight = -1
      ViewCompat.requestApplyInsets(this)
    }
  }

  // Status and navigation bars overlay the page, which reads their heights
  // from --safe-area-inset-top/bottom.
  private fun applySystemBarInsets(insets: WindowInsetsCompat) {
    val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
    if (bars.top == systemBarTop && bars.bottom == systemBarBottom) return
    systemBarTop = bars.top
    systemBarBottom = bars.bottom
    val density = resources.displayMetrics.density
    webView.evaluateJavascript(
      "document.documentElement.style.setProperty('--safe-area-inset-top','${bars.top / density}px');" +
        "document.documentElement.style.setProperty('--safe-area-inset-bottom','${bars.bottom / density}px');",
      null
    )
  }

  private fun applyKeyboardInsets(insets: WindowInsetsCompat) {
    val bottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
    if (keyboardHeight == bottom) return
    keyboardHeight = bottom
    if (!keyboardUpdatePending) sendKeyboardInsets()
  }

  private fun sendKeyboardInsets() {
    keyboardUpdatePending = true
    val bottom = keyboardHeight
    val cssHeight = bottom / resources.displayMetrics.density
    webView.evaluateJavascript(
      "document.documentElement.style.setProperty('--native-keyboard-height','${cssHeight}px');" +
        "if(document.body){document.body.classList.toggle('keyboard-open',${bottom > 0});}"
    ) {
      keyboardUpdatePending = false
      // A busy WebView gets the latest IME position, not a queue of old frames.
      if (keyboardHeight != bottom) sendKeyboardInsets()
    }
  }

  // endregion

  // region Page bridge

  private inner class Client : WebViewClient() {
    private val assets = WebViewAssetLoader.Builder()
      .setDomain(HOST)
      .setHttpAllowed(false)
      .addPathHandler("/", AppAssets(context) { inlineStartScript() })
      .build()

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
      if (request.url.host != HOST) return null
      return assets.shouldInterceptRequest(request.url)
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
      if (request.url.host == HOST) return false
      // Links that leave the app open outside it, as Capacitor did.
      return try {
        context.startActivity(Intent(Intent.ACTION_VIEW, request.url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
      } catch (_: Exception) {
        true
      }
    }

    override fun onPageFinished(view: WebView, url: String) {
      syncSystemBarInsets()
      onLoadEnd(mapOf("url" to url))
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
      Log.w(TAG, "WebView renderer gone (crashed=${detail.didCrash()}); recreating it")
      post { replaceWebView(view) }
      return true
    }
  }

  private inner class Chrome : WebChromeClient() {
    override fun onConsoleMessage(message: ConsoleMessage): Boolean {
      Log.d(TAG, "${message.messageLevel()} ${message.message()} (${message.sourceId()}:${message.lineNumber()})")
      return true
    }

    override fun onPermissionRequest(request: PermissionRequest) {
      val wanted = mutableListOf<String>()
      if (request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) wanted += Manifest.permission.RECORD_AUDIO
      if (request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) wanted += Manifest.permission.CAMERA
      val missing = wanted.filter { ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED }
      if (missing.isEmpty()) {
        post { request.grant(request.resources) }
        return
      }
      val permissions = appContext.permissions
      if (permissions == null) {
        post { request.deny() }
        return
      }
      permissions.askForPermissions({ result ->
        val granted = missing.all { result[it]?.status == PermissionsStatus.GRANTED }
        post { if (granted) request.grant(request.resources) else request.deny() }
      }, *missing.toTypedArray())
    }

    override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
      val activity: Activity = appContext.currentActivity ?: return false
      KluiHostRegistry.pendingFiles?.onReceiveValue(null)
      KluiHostRegistry.pendingFiles = callback
      val intent = params.createIntent().apply {
        if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
      }
      return try {
        activity.startActivityForResult(intent, FILE_REQUEST)
        true
      } catch (_: Exception) {
        KluiHostRegistry.pendingFiles = null
        false
      }
    }
  }

  // endregion

  companion object {
    const val TAG = "KluiHost"
    const val HOST = "localhost"
    const val ORIGIN = "https://localhost"
    /** The page's handle on the host (window.KluiNativeHost). */
    const val BRIDGE = "KluiNativeHost"
    const val FILE_REQUEST = 4710
  }
}

/** Serves the bundled web client; app routes fall back to index.html. */
private class AppAssets(private val context: Context, private val inlineScript: () -> String?) : WebViewAssetLoader.PathHandler {
  override fun handle(path: String): WebResourceResponse? {
    val clean = path.trimStart('/').substringBefore('?')
    val asset = if (clean.isEmpty()) "index.html" else clean
    val stream = open("web/$asset")
    if (stream != null) return if (asset.endsWith(".html")) html(stream) else WebResourceResponse(mimeType(asset), null, stream)
    // A route like /c/<id> or /study/<id> is the app itself.
    if (!asset.substringAfterLast('/').contains('.')) {
      open("web/index.html")?.let { return html(it) }
    }
    return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), "".byteInputStream())
  }

  // The host info script goes first in <head> when the WebView can't add it itself.
  private fun html(stream: InputStream): WebResourceResponse {
    val script = inlineScript() ?: return WebResourceResponse("text/html", "utf-8", stream)
    val page = stream.bufferedReader().use { it.readText() }
    val head = Regex("<head[^>]*>", RegexOption.IGNORE_CASE).find(page)
    val tag = "<script>$script</script>"
    val out = if (head != null) page.replaceRange(head.range.last + 1, head.range.last + 1, tag) else tag + page
    return WebResourceResponse("text/html", "utf-8", out.byteInputStream())
  }

  private fun open(name: String): InputStream? = try {
    context.assets.open(name)
  } catch (_: IOException) {
    null
  }

  private fun mimeType(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
    "html" -> "text/html"
    "js", "mjs" -> "text/javascript"
    "css" -> "text/css"
    "json", "map" -> "application/json"
    "svg" -> "image/svg+xml"
    "webp" -> "image/webp"
    "png" -> "image/png"
    "jpg", "jpeg" -> "image/jpeg"
    "gif" -> "image/gif"
    "ico" -> "image/x-icon"
    "woff2" -> "font/woff2"
    "woff" -> "font/woff"
    "ttf" -> "font/ttf"
    "wasm" -> "application/wasm"
    "mp3" -> "audio/mpeg"
    "wav" -> "audio/wav"
    "ogg" -> "audio/ogg"
    "mp4" -> "video/mp4"
    "webm" -> "video/webm"
    "txt" -> "text/plain"
    else -> URLConnection.guessContentTypeFromName(name) ?: "application/octet-stream"
  }
}

/** The single live host, for the module's functions and activity callbacks. */
object KluiHostRegistry {
  var current: KluiWebView? = null
  var pendingFiles: ValueCallback<Array<Uri>>? = null
}
