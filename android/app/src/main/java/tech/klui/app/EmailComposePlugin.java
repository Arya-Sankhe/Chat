package tech.klui.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Opens an email draft in the chosen mail app (Gmail, Outlook, or the
 * default one) instead of the app's in-app browser. Rejects when that app
 * isn't installed so the page can fall back to the web compose link.
 */
@CapacitorPlugin(name = "EmailCompose")
public class EmailComposePlugin extends Plugin {
  @PluginMethod
  public void compose(PluginCall call) {
    String app = call.getString("app", "mailto");
    String to = call.getString("to", "");
    Intent intent = new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:"));
    if (!to.trim().isEmpty()) intent.putExtra(Intent.EXTRA_EMAIL, to.split("\\s*[,;]\\s*"));
    intent.putExtra(Intent.EXTRA_SUBJECT, call.getString("subject", ""));
    intent.putExtra(Intent.EXTRA_TEXT, call.getString("body", ""));
    if ("gmail".equals(app)) intent.setPackage("com.google.android.gm");
    else if ("outlook".equals(app)) intent.setPackage("com.microsoft.office.outlook");
    try {
      getActivity().startActivity(intent);
      call.resolve();
    } catch (ActivityNotFoundException error) {
      call.reject("No email app to open.", "not_installed");
    }
  }
}
