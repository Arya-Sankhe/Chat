package tech.klui.app;

import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Lets the Settings "Text size" slider scale the WebView's text without
 * touching layout. Android's own WebSettings.setTextZoom is the same
 * mechanism Chrome uses for its accessibility text-scaling option: it
 * resizes font glyphs only, so fixed-height containers (header, composer,
 * safe-area insets) never overflow or break.
 */
@CapacitorPlugin(name = "TextZoom")
public class TextZoomPlugin extends Plugin {
  @PluginMethod
  public void setTextZoom(PluginCall call) {
    int percent = call.getInt("percent", 100);
    if (percent < 70) percent = 70;
    if (percent > 160) percent = 160;
    final int clamped = percent;
    getBridge().executeOnMainThread(() -> {
      getBridge().getWebView().getSettings().setTextZoom(clamped);
      call.resolve();
    });
  }
}
