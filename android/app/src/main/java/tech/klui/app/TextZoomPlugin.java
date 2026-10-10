package tech.klui.app;

import android.view.View;
import android.webkit.WebView;

import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsAnimationCompat;
import java.util.List;
import androidx.core.graphics.Insets;

/**
 * Lets the Settings "Text size" slider scale the WebView's text without
 * touching layout. Android's own WebSettings.setTextZoom is the same
 * mechanism Chrome uses for its accessibility text-scaling option: it
 * resizes font glyphs only, so fixed-height containers (header, composer,
 * safe-area insets) never overflow or break.
 */
@CapacitorPlugin(name = "TextZoom")
public class TextZoomPlugin extends Plugin {
  public void installKeyboardInsets() {
    WebView webView = getBridge().getWebView();
    // Keep the WebView full size: native padding exposes an unpainted strip
    // while Chromium catches up. Only the page's chat layout avoids the IME.
    View container = (View) webView.getParent();
    ViewCompat.setOnApplyWindowInsetsListener(container, (view, insets) -> {
      targetInsets = insets;
      if (!imeAnimating) applyKeyboardInsets(webView, insets);
      // Consume these before Chromium so it cannot apply a second resize.
      return new WindowInsetsCompat.Builder(insets)
          .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
          .setVisible(WindowInsetsCompat.Type.ime(), false)
          .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.NONE)
          .build();
    });
    // Capacitor Keyboard installs a STOP callback on the decor root.
    // A descendant callback never sees IME frames; own that root callback.
    ViewCompat.setWindowInsetsAnimationCallback(getActivity().getWindow().getDecorView(),
        new WindowInsetsAnimationCompat.Callback(
            WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_STOP) {
          @Override
          public void onPrepare(WindowInsetsAnimationCompat animation) {
            if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) != 0) {
              imeAnimating = true;
            }
          }

          @Override
          public WindowInsetsCompat onProgress(WindowInsetsCompat insets,
              List<WindowInsetsAnimationCompat> animations) {
            if (imeAnimating) applyKeyboardInsets(webView, insets);
            return insets;
          }

          @Override
          public void onEnd(WindowInsetsAnimationCompat animation) {
            if ((animation.getTypeMask() & WindowInsetsCompat.Type.ime()) != 0) {
              imeAnimating = false;
              // Use the saved destination, never a stale root inset. This
              // also settles interrupted animations and IME height changes.
              if (targetInsets != null) applyKeyboardInsets(webView, targetInsets);
            }
          }
        });
    ViewCompat.requestApplyInsets(container);
  }

  private int keyboardHeight = -1;
  private boolean keyboardUpdatePending;
  private boolean imeAnimating;
  private WindowInsetsCompat targetInsets;

  private void applyKeyboardInsets(WebView webView, WindowInsetsCompat insets) {
    int bottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
    if (keyboardHeight == bottom) return;
    keyboardHeight = bottom;
    if (!keyboardUpdatePending) sendKeyboardInsets(webView);
  }

  private void sendKeyboardInsets(WebView webView) {
    keyboardUpdatePending = true;
    int bottom = keyboardHeight;
    float cssHeight = bottom / webView.getResources().getDisplayMetrics().density;
    webView.evaluateJavascript(
        "document.documentElement.style.setProperty('--native-keyboard-height','" + cssHeight + "px');"
            + "if(document.body){document.body.classList.toggle('keyboard-open'," + (bottom > 0) + ");}",
        ignored -> {
          keyboardUpdatePending = false;
          // A busy WebView gets the latest IME position, not a queue of old frames.
          if (keyboardHeight != bottom) sendKeyboardInsets(webView);
        });
  }

  @PluginMethod
  public void setTextZoom(PluginCall call) {
    int percent = call.getInt("percent", 100);
    if (percent < 85) percent = 85;
    if (percent > 130) percent = 130;
    final int clamped = percent;
    getBridge().executeOnMainThread(() -> {
      getBridge().getWebView().getSettings().setTextZoom(clamped);
      call.resolve();
    });
  }

  @PluginMethod
  public void showKeyboard(PluginCall call) {
    getBridge().executeOnMainThread(() -> {
      View webView = getBridge().getWebView();
      if (!webView.hasFocus()) webView.requestFocus();
      // Unlike showSoftInput, this schedules the request after window focus
      // and the WebView editor connection are ready, including cold startup.
      WindowCompat.getInsetsController(getActivity().getWindow(), webView)
          .show(WindowInsetsCompat.Type.ime());
      call.resolve();
    });
  }
}
