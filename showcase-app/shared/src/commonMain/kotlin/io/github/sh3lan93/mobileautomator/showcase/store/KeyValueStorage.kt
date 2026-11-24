package io.github.sh3lan93.mobileautomator.showcase.store

/** The only platform-specific piece of persistence; [LocalStore] owns every key and value on top of it. */
interface KeyValueStorage {
    fun getString(key: String): String?
    fun putString(key: String, value: String)
    fun remove(key: String)
}
