import ExpoModulesCore
import UIKit

/* The iOS side of modules/klui-host: the same JS interface as the Android module.
   Not compiled yet: this Mac has no Xcode. See clients/README.md. */
public class KluiHostModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KluiHost")

    Constant("applicationId") { Bundle.main.bundleIdentifier ?? "" }

    Function("evaluate") { (script: String) in
      DispatchQueue.main.async { KluiHostRegistry.current?.evaluate(script) }
    }

    // WKWebView only opens the keyboard from a user's tap on a field.
    Function("showKeyboard") {}

    Function("hideKeyboard") {
      DispatchQueue.main.async { KluiHostRegistry.current?.endEditing(true) }
    }

    Function("syncSystemBarInsets") {
      DispatchQueue.main.async { KluiHostRegistry.current?.syncInsets() }
    }

    AsyncFunction("setTextZoom") { (percent: Int, promise: Promise) in
      DispatchQueue.main.async {
        guard let host = KluiHostRegistry.current else {
          promise.reject("ERR_NO_WEBVIEW", "No WebView to zoom")
          return
        }
        promise.resolve(host.setTextZoom(percent))
      }
    }

    // React Native's StatusBar owns the status bar here; iOS has no navigation bar to style.
    Function("setSystemBarStyle") { (_: Bool) in }

    Function("composeEmail") { (_: String, to: String, subject: String, body: String) in
      var parts = URLComponents()
      parts.scheme = "mailto"
      parts.path = to
      parts.queryItems = [URLQueryItem(name: "subject", value: subject), URLQueryItem(name: "body", value: body)]
      guard let url = parts.url else { throw Exception(name: "not_installed", description: "No email app to open.") }
      DispatchQueue.main.async { UIApplication.shared.open(url) }
    }

    Events("onVoiceEnd")

    // Background voice needs its own audio session work; the page runs voice in the foreground.
    AsyncFunction("voiceStart") { () -> [String: Bool] in ["running": false] }
    Function("voiceStop") {}

    // Nothing to carry over yet. If a Capacitor iOS build reached users, its stores are read here.
    AsyncFunction("readLegacyStorage") { () -> [String: [String: String]] in ["secure": [:], "prefs": [:]] }
    AsyncFunction("clearLegacyStorage") { (_: [String], _: [String]) in }

    View(KluiWebView.self) {
      Events("onMessage", "onLoadEnd")
      Prop("startPath") { (view: KluiWebView, path: String) in view.startPath = path.hasPrefix("/") ? path : "/\(path)" }
      Prop("documentStartScript") { (view: KluiWebView, script: String) in view.setDocumentStartScript(script) }
      Prop("textZoom") { (view: KluiWebView, percent: Int) in _ = view.setTextZoom(percent) }
      Prop("debuggingEnabled") { (view: KluiWebView, enabled: Bool) in view.setDebuggingEnabled(enabled) }
      OnViewDidUpdateProps { (view: KluiWebView) in view.loadIfNeeded() }
    }
  }
}

enum KluiHostRegistry {
  static weak var current: KluiWebView?
}
