package io.github.sh3lan93.mobileautomator.showcase.store

import io.github.sh3lan93.mobileautomator.showcase.data.Simulation
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json

/** Turns a value into its stored string and back; `encode` returning `null` removes the key. */
internal class Codec<T>(val encode: (T) -> String?, val decode: (String) -> T?)

class StoredValue<T> internal constructor(
    private val key: String,
    private val default: T,
    private val codec: Codec<T>,
    private val storage: KeyValueStorage,
    private val onChange: () -> Unit,
) {
    // A stored string that does not decode (corrupt or from another version) reads as the default.
    private val state = MutableStateFlow(storage.getString(key)?.let(codec.decode) ?: default)
    val value: StateFlow<T> = state.asStateFlow()

    fun set(newValue: T) {
        val encoded = codec.encode(newValue)
        if (encoded == null) storage.remove(key) else storage.putString(key, encoded)
        state.value = newValue
        onChange()
    }

    internal fun clear() {
        storage.remove(key)
        state.value = default
        onChange()
    }
}

/**
 * Everything the app persists on the device. Every value is declared through a factory that
 * registers it, so [reset] clears values added later without being edited.
 */
class LocalStore(private val storage: KeyValueStorage) {

    private val registry = mutableListOf<StoredValue<*>>()

    val simulateOffline = boolean("simulate_offline")
    val simulateServerError = boolean("simulate_server_error")

    private val _simulation = MutableStateFlow(currentSimulation())
    val simulation: StateFlow<Simulation> = _simulation.asStateFlow()

    /** Removes every registered key; every value is back to its default. */
    fun reset() = registry.forEach { it.clear() }

    private fun currentSimulation() = Simulation(simulateOffline.value.value, simulateServerError.value.value)

    private fun onValueChanged() {
        _simulation.value = currentSimulation()
    }

    private fun boolean(key: String, default: Boolean = false) =
        register(key, default, Codec({ it.toString() }, String::toBooleanStrictOrNull))

    @Suppress("unused") // first used by #309 (guest session id)
    private fun string(key: String) = register<String?>(key, null, Codec({ it }, { it }))

    @Suppress("unused") // first used by #310 (watchlist)
    private fun <T> json(key: String, default: T, serializer: KSerializer<T>) = register(
        key,
        default,
        Codec({ Json.encodeToString(serializer, it) }, { runCatching { Json.decodeFromString(serializer, it) }.getOrNull() }),
    )

    private fun <T> register(key: String, default: T, codec: Codec<T>) =
        StoredValue("$KEY_PREFIX$key", default, codec, storage, ::onValueChanged).also { registry += it }

    private companion object {
        const val KEY_PREFIX = "reel_tracker."
    }
}
