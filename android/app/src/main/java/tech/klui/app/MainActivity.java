package tech.klui.app;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    registerPlugin(TextZoomPlugin.class);
    super.onCreate(savedInstanceState);

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
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      getWindow().setStatusBarContrastEnforced(false);
      getWindow().setNavigationBarContrastEnforced(false);
    }
  }
}
