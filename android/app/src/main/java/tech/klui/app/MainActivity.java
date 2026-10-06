package tech.klui.app;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    registerPlugin(TextZoomPlugin.class);
    registerPlugin(EmailComposePlugin.class);
    super.onCreate(savedInstanceState);
    // Keyboard.load() runs on the bridge queue. Install our root callback
    // after it finishes, so its STOP callback cannot replace ours on startup.
    getBridge().execute(() -> getBridge().executeOnMainThread(() ->
        ((TextZoomPlugin) getBridge().getPlugin("TextZoom").getInstance()).installKeyboardInsets()));
    getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));

    // True edge-to-edge from the very first frame. The Capacitor StatusBar
    // plugin (configureNativeChrome in app.js) re-asserts this once the
    // WebView is up, but that happens after a JS round-trip. Setting it
    // here too means there's no flash of a default system bar color, and
    // no Android-drawn "contrast scrim" behind the clock/icons that would
    // otherwise sit on top of our transparent status bar and look like a
    // different-colored strip than the page underneath it.
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    getWindow().setStatusBarColor(Color.TRANSPARENT);
    getWindow().setNavigationBarColor(Color.TRANSPARENT);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      WindowManager.LayoutParams attributes = getWindow().getAttributes();
      attributes.layoutInDisplayCutoutMode =
          WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
      getWindow().setAttributes(attributes);
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      getWindow().setStatusBarContrastEnforced(false);
      getWindow().setNavigationBarContrastEnforced(false);
    }
    hideSystemBars();
  }

  private void hideSystemBars() {
    getWindow().getDecorView().setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    WindowInsetsControllerCompat controller =
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    controller.hide(WindowInsetsCompat.Type.systemBars());
    controller.setSystemBarsBehavior(
        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
  }

  private boolean keyboardOpenWhenStopped;

  @Override
  public void onPause() {
    // Reconnect the editor on resume with one fresh keyboard transition.
    WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(getWindow().getDecorView());
    keyboardOpenWhenStopped = insets != null && insets.isVisible(WindowInsetsCompat.Type.ime());
    if (keyboardOpenWhenStopped && getBridge() != null) {
      View webView = getBridge().getWebView();
      WindowCompat.getInsetsController(getWindow(), webView).hide(WindowInsetsCompat.Type.ime());

    }
    super.onPause();
  }

  @Override
  public void onResume() {
    super.onResume();
    hideSystemBars();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (!hasFocus) return;
    hideSystemBars();
    if (keyboardOpenWhenStopped && getBridge() != null) {
      keyboardOpenWhenStopped = false;
      WindowCompat.getInsetsController(getWindow(), getBridge().getWebView())
          .show(WindowInsetsCompat.Type.ime());
    }
  }
}
