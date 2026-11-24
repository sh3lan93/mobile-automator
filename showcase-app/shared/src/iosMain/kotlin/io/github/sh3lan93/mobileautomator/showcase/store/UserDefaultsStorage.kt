package io.github.sh3lan93.mobileautomator.showcase.store

import platform.Foundation.NSUserDefaults

class UserDefaultsStorage(private val defaults: NSUserDefaults) : KeyValueStorage {
    override fun getString(key: String): String? = defaults.stringForKey(key)
    override fun putString(key: String, value: String) = defaults.setObject(value, forKey = key)
    override fun remove(key: String) = defaults.removeObjectForKey(key)
}
