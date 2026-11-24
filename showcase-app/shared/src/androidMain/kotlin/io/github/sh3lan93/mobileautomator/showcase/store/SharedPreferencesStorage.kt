package io.github.sh3lan93.mobileautomator.showcase.store

import android.content.SharedPreferences

class SharedPreferencesStorage(private val prefs: SharedPreferences) : KeyValueStorage {
    override fun getString(key: String): String? = prefs.getString(key, null)
    override fun putString(key: String, value: String) = prefs.edit().putString(key, value).apply()
    override fun remove(key: String) = prefs.edit().remove(key).apply()
}
