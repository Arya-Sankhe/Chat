Pod::Spec.new do |s|
  s.name           = 'KluiHost'
  s.version        = '1.0.0'
  s.summary        = 'The web surface of the Klui app.'
  s.description    = 'Serves the bundled web client in a WKWebView and bridges it to the app.'
  s.author         = 'Klui'
  s.homepage       = 'https://klui.ai'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '16.0' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.swift'
  # Built by scripts/bundle-web.mjs --ios when pods install. A folder, so paths in it stay.
  s.prepare_command = 'node ../../../scripts/bundle-web.mjs --ios'
  s.resource_bundles = { 'KluiWeb' => ['web'] }
end
