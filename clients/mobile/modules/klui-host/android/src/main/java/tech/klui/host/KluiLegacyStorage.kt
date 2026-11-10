package tech.klui.host

import android.content.Context
import android.util.Base64
import android.util.Log
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec

/* What the Capacitor app left on the device when this build installs over it
   (same package, so the same data and KeyStore):
   - @aparajita/capacitor-secure-storage: values AES-GCM encrypted with a
     KeyStore key per alias "capacitor-storage_<key>", stored in the
     WSSecureStorageSharedPreferences file as "<data>\u0010<iv>" (Base64);
   - @capacitor/preferences: plain strings in the CapacitorStorage file. */
object KluiLegacyStorage {
  private const val TAG = "KluiLegacyStorage"
  private const val SECURE_FILE = "WSSecureStorageSharedPreferences"
  private const val SECURE_PREFIX = "capacitor-storage_"
  private const val PREFS_FILE = "CapacitorStorage"
  private const val SEPARATOR = '\u0010'
  private const val BASE64_FLAGS = Base64.NO_PADDING or Base64.NO_WRAP

  /** Every readable legacy value. One that cannot be read now (KeyStore
      unavailable, decryption failure) is left out and stays for a later launch. */
  fun read(context: Context): Map<String, Map<String, String>> {
    val secure = mutableMapOf<String, String>()
    val keyStore = runCatching { KeyStore.getInstance("AndroidKeyStore").apply { load(null) } }
      .onFailure { Log.w(TAG, "Legacy KeyStore unavailable", it) }.getOrNull()
    for ((alias, stored) in context.getSharedPreferences(SECURE_FILE, Context.MODE_PRIVATE).all) {
      if (!alias.startsWith(SECURE_PREFIX) || stored !is String || keyStore == null) continue
      try {
        decrypt(keyStore, alias, stored)?.let { secure[alias.removePrefix(SECURE_PREFIX)] = it }
      } catch (error: Exception) {
        Log.w(TAG, "Could not read legacy secure value $alias", error)
      }
    }
    val prefs = mutableMapOf<String, String>()
    for ((key, value) in context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE).all) {
      if (value is String) prefs[key] = value
    }
    return mapOf("secure" to secure, "prefs" to prefs)
  }

  /** Drops the given legacy entries once their values live in the new stores;
      anything not listed (unread or not yet copied) stays. */
  fun clear(context: Context, secureKeys: List<String>, prefKeys: List<String>) {
    if (secureKeys.isNotEmpty()) {
      val keyStore = runCatching { KeyStore.getInstance("AndroidKeyStore").apply { load(null) } }.getOrNull()
      val edit = context.getSharedPreferences(SECURE_FILE, Context.MODE_PRIVATE).edit()
      for (key in secureKeys) {
        val alias = SECURE_PREFIX + key
        runCatching { if (keyStore?.containsAlias(alias) == true) keyStore.deleteEntry(alias) }
          .onFailure { Log.w(TAG, "Could not delete legacy key $alias", it) }
        edit.remove(alias)
      }
      edit.commit()
    }
    if (prefKeys.isNotEmpty()) {
      val edit = context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE).edit()
      for (key in prefKeys) edit.remove(key)
      edit.commit()
    }
  }

  private fun decrypt(keyStore: KeyStore, alias: String, stored: String): String? {
    val parts = stored.split(SEPARATOR)
    if (parts.size != 2) return null
    val entry = keyStore.getEntry(alias, null) as? KeyStore.SecretKeyEntry ?: return null
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, entry.secretKey, GCMParameterSpec(128, Base64.decode(parts[1], BASE64_FLAGS)))
    return String(cipher.doFinal(Base64.decode(parts[0], BASE64_FLAGS)), Charsets.UTF_8)
  }
}
