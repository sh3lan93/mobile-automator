package io.github.sh3lan93.mobileautomator.showcase.store

/** Stands in for the platform storage in tests; [keys] lets a test check what is left after reset. */
class InMemoryKeyValueStorage : KeyValueStorage {
    private val entries = mutableMapOf<String, String>()

    fun keys(): Set<String> = entries.keys.toSet()

    override fun getString(key: String): String? = entries[key]
    override fun putString(key: String, value: String) { entries[key] = value }
    override fun remove(key: String) { entries.remove(key) }
}
