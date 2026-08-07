package tech.klui.app;

import android.content.Context;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.webkit.WebView;

import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

/**
 * Lets the Settings "Text size" slider scale the WebView's text without
 * touching layout. Android's own WebSettings.setTextZoom is the same
 * mechanism Chrome uses for its accessibility text-scaling option: it
 * resizes font glyphs only, so fixed-height containers (header, composer,
 * safe-area insets) never overflow or break.
 */
@CapacitorPlugin(name = "TextZoom")
public class TextZoomPlugin extends Plugin {
  @Override
  public void load() {
    WebView webView = getBridge().getWebView();
    ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> {
      Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
      int height = insets.isVisible(WindowInsetsCompat.Type.ime()) ? ime.bottom : 0;
      int cssPixels = Math.round(height / getContext().getResources().getDisplayMetrics().density);
      webView.evaluateJavascript(
          "if(document.body){document.body.style.setProperty('--native-keyboard-height','"
              + cssPixels
              + "px');document.body.classList.toggle('keyboard-open',"
              + (height > 0)
              + ");}",
          null);
      view.onApplyWindowInsets(insets.toWindowInsets());
      return insets;
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
      webView.requestFocus(View.FOCUS_DOWN);
      InputMethodManager manager =
          (InputMethodManager) getBridge().getActivity().getSystemService(Context.INPUT_METHOD_SERVICE);
      manager.showSoftInput(webView, InputMethodManager.SHOW_IMPLICIT);
      call.resolve();
    });
  }
}
