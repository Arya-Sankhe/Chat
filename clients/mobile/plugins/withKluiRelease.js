// Gives the generated android/app/build.gradle the Capacitor build's release
// setup, so it survives `expo prebuild` (clean or not):
// - KLUI_VERSION_CODE / KLUI_VERSION_NAME are read when Gradle runs (not only
//   at prebuild), so the documented release command sets the version;
// - KLUI_KEYSTORE_* sign the release with the existing key, so it installs
//   over the Capacitor app;
// - a production release never falls back to Expo's debug key: without those
//   values any release packaging task fails (and the APK would be unsigned).
const { withAppBuildGradle } = require("expo/config-plugins");

const BEGIN = "// @klui-release begin";
const END = "// @klui-release end";

function releaseGradle(requireSigning) {
  const production = requireSigning
    ? `
    buildTypes {
        release {
            signingConfig System.getenv("KLUI_KEYSTORE_PATH") ? signingConfigs.kluiRelease : null
        }
    }
}

gradle.taskGraph.whenReady { graph ->
    def releaseTask = graph.allTasks.find { it.project.path == ':app' && it.name =~ /^(assemble|bundle|package|install|sign|validateSigning).*Release/ }
    if (!releaseTask) return
    def missing = ["KLUI_KEYSTORE_PATH", "KLUI_KEYSTORE_PASSWORD", "KLUI_KEY_ALIAS", "KLUI_KEY_PASSWORD"].findAll { !System.getenv(it) }
    if (!missing.isEmpty()) {
        throw new GradleException("Release signing is not configured. Missing: \${missing.join(', ')}")
    }
}`
    : `
    buildTypes {
        release {
            if (System.getenv("KLUI_KEYSTORE_PATH")) signingConfig signingConfigs.kluiRelease
        }
    }
}`;
  return `${BEGIN}
android {
    defaultConfig {
        if (System.getenv("KLUI_VERSION_CODE")) versionCode Integer.parseInt(System.getenv("KLUI_VERSION_CODE"))
        if (System.getenv("KLUI_VERSION_NAME")) versionName System.getenv("KLUI_VERSION_NAME")
    }
    signingConfigs {
        kluiRelease {
            def keyStorePath = System.getenv("KLUI_KEYSTORE_PATH")
            if (keyStorePath) {
                storeFile file(keyStorePath)
                storePassword System.getenv("KLUI_KEYSTORE_PASSWORD")
                keyAlias System.getenv("KLUI_KEY_ALIAS")
                keyPassword System.getenv("KLUI_KEY_PASSWORD")
            }
        }
    }${production}
${END}`;
}

module.exports = function withKluiRelease(config, { requireSigning = false } = {}) {
  return withAppBuildGradle(config, (mod) => {
    // Replace the block each prebuild, so switching variants without --clean
    // never keeps the other variant's signing rules.
    const contents = mod.modResults.contents.replace(new RegExp(`\\n?${BEGIN}[\\s\\S]*?${END}\\n?`), "\n");
    mod.modResults.contents = `${contents.replace(/\n*$/, "\n")}\n${releaseGradle(requireSigning)}\n`;
    return mod;
  });
};
