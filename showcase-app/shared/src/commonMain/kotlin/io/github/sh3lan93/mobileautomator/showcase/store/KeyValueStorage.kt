package io.github.sh3lan93.mobileautomator.showcase.store

/** The only platform-specific piece of persistence; [LocalStore] owns every key and value on top of it. */
interface KeyValueStorage {
    fun getString(key: String): String?
    fun putString(key: String, value: String)
    fun remove(key: String)
}

/** For tests only; the apps persist through their platform storage. */
class InMemoryKeyValueStorage : KeyValueStorage {
    private val entries = mutableMapOf<String, String>()

    fun keys(): Set<String> = entries.keys.toSet()

    override fun getString(key: String): String? = entries[key]
    override fun putString(key: String, value: String) { entries[key] = value }
    override fun remove(key: String) { entries.remove(key) }
}
