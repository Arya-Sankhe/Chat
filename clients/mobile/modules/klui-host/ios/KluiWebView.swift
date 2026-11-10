import ExpoModulesCore
import WebKit

let kluiScheme = "klui-app"
let kluiOrigin = "\(kluiScheme)://localhost"

/* WKWebView can't register a handler for https, so the bundled web client has its own
   scheme here. The API allows this origin by name (server/config.js). */
final class KluiWebView: ExpoView, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
  private var webView: WKWebView!
  private let onMessage = EventDispatcher()
  private let onLoadEnd = EventDispatcher()
  private var loaded = false
  private var textZoom = 100
  private var startScript = ""
  var startPath = "/"

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    KluiHostRegistry.current = self
    makeWebView()
    NotificationCenter.default.addObserver(self, selector: #selector(keyboardChanged), name: UIResponder.keyboardWillChangeFrameNotification, object: nil)
  }

  /* The page avoids the keyboard itself, from this height, as on Android. */
  @objc private func keyboardChanged(_ note: Notification) {
    guard let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
    let height = max(0, UIScreen.main.bounds.height - frame.minY)
    evaluate("document.documentElement.style.setProperty('--native-keyboard-height','\(height)px');if(document.body){document.body.classList.toggle('keyboard-open',\(height > 0));}")
  }

  private func makeWebView() {
    let configuration = WKWebViewConfiguration()
    configuration.setURLSchemeHandler(KluiAssetHandler(), forURLScheme: kluiScheme)
    configuration.allowsInlineMediaPlayback = true
    configuration.mediaTypesRequiringUserActionForPlayback = []
    let controller = configuration.userContentController
    controller.add(WeakMessageHandler(self), name: "kluiHost")
    controller.addUserScript(WKUserScript(
      source: "window.KluiNativeHost={postMessage:(text)=>window.webkit.messageHandlers.kluiHost.postMessage(text)};",
      injectionTime: .atDocumentStart,
      forMainFrameOnly: true
    ))
    if !startScript.isEmpty {
      controller.addUserScript(WKUserScript(source: startScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    let view = WKWebView(frame: bounds, configuration: configuration)
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.navigationDelegate = self
    view.uiDelegate = self
    view.isOpaque = true
    view.scrollView.contentInsetAdjustmentBehavior = .never
    view.scrollView.bounces = false
    addSubview(view)
    webView = view
  }

  func setDocumentStartScript(_ script: String) {
    guard script != startScript else { return }
    startScript = script
    let controller = webView.configuration.userContentController
    controller.removeAllUserScripts()
    controller.addUserScript(WKUserScript(
      source: "window.KluiNativeHost={postMessage:(text)=>window.webkit.messageHandlers.kluiHost.postMessage(text)};",
      injectionTime: .atDocumentStart,
      forMainFrameOnly: true
    ))
    controller.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
  }

  func setDebuggingEnabled(_ enabled: Bool) {
    if #available(iOS 16.4, *) { webView.isInspectable = enabled }
  }

  func loadIfNeeded() {
    guard !loaded else { return }
    loaded = true
    load(startPath)
  }

  private func load(_ path: String) {
    guard let url = URL(string: kluiOrigin + path) else { return }
    webView.load(URLRequest(url: url))
  }

  func evaluate(_ script: String) {
    webView.evaluateJavaScript(script, completionHandler: nil)
  }

  func setTextZoom(_ percent: Int) -> Int {
    textZoom = min(130, max(85, percent))
    applyTextZoom()
    return textZoom
  }

  private func applyTextZoom() {
    evaluate("document.documentElement.style.webkitTextSizeAdjust='\(textZoom)%';")
  }

  func syncInsets() {
    let insets = window?.safeAreaInsets ?? safeAreaInsets
    evaluate("document.documentElement.style.setProperty('--safe-area-inset-top','\(insets.top)px');document.documentElement.style.setProperty('--safe-area-inset-bottom','\(insets.bottom)px');")
  }

  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    syncInsets()
  }

  // MARK: Bridge

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    // Only the bundled page's main document talks to the app.
    guard message.frameInfo.isMainFrame,
          message.frameInfo.securityOrigin.protocol == kluiScheme,
          let data = message.body as? String else { return }
    onMessage(["data": data])
  }

  // MARK: Navigation

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = action.request.url else { return decisionHandler(.cancel) }
    if url.scheme == kluiScheme { return decisionHandler(.allow) }
    // Blobs, data and subframes stay in the page; anything else leaves the app.
    if url.scheme == "blob" || url.scheme == "data" || url.scheme == "about" || action.targetFrame?.isMainFrame == false {
      return decisionHandler(.allow)
    }
    UIApplication.shared.open(url)
    decisionHandler(.cancel)
  }

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url { UIApplication.shared.open(url) }
    return nil
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    applyTextZoom()
    syncInsets()
    onLoadEnd(["url": webView.url?.absoluteString ?? ""])
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    webView.reload()
  }

  @available(iOS 15.0, *)
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    decisionHandler(origin.protocol == kluiScheme ? .grant : .deny)
  }
}

/* WKUserContentController holds its handlers strongly. */
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
  weak var target: WKScriptMessageHandler?
  init(_ target: WKScriptMessageHandler) { self.target = target }
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    target?.userContentController(controller, didReceive: message)
  }
}

/* The bundled web client. A path with no file is a page route: index.html, as on Android. */
final class KluiAssetHandler: NSObject, WKURLSchemeHandler {
  private lazy var root: URL? = {
    let bundle = Bundle(for: KluiAssetHandler.self)
    return bundle.url(forResource: "KluiWeb", withExtension: "bundle")?.appendingPathComponent("web", isDirectory: true)
  }()

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url, let root else {
      task.didFailWithError(URLError(.fileDoesNotExist))
      return
    }
    var file = root.appendingPathComponent(url.path)
    var isFolder: ObjCBool = false
    let exists = FileManager.default.fileExists(atPath: file.path, isDirectory: &isFolder)
    let standardized = file.standardizedFileURL.path
    if !exists || isFolder.boolValue || !standardized.hasPrefix(root.standardizedFileURL.path) {
      file = root.appendingPathComponent("index.html")
    }
    guard let data = try? Data(contentsOf: file) else {
      task.didFailWithError(URLError(.fileDoesNotExist))
      return
    }
    let headers = ["Content-Type": mimeType(file.pathExtension), "Content-Length": String(data.count), "Cache-Control": "no-cache"]
    let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
    task.didReceive(response)
    task.didReceive(data)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

  private func mimeType(_ fileExtension: String) -> String {
    switch fileExtension.lowercased() {
    case "html": return "text/html; charset=utf-8"
    case "js", "mjs": return "text/javascript; charset=utf-8"
    case "css": return "text/css; charset=utf-8"
    case "json", "map": return "application/json"
    case "svg": return "image/svg+xml"
    case "png": return "image/png"
    case "jpg", "jpeg": return "image/jpeg"
    case "webp": return "image/webp"
    case "gif": return "image/gif"
    case "ico": return "image/x-icon"
    case "woff2": return "font/woff2"
    case "woff": return "font/woff"
    case "wasm": return "application/wasm"
    case "mp3": return "audio/mpeg"
    case "webm": return "video/webm"
    case "mp4": return "video/mp4"
    default: return "application/octet-stream"
    }
  }
}
