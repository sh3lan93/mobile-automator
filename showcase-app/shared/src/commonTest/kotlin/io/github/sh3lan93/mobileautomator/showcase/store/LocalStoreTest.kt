package io.github.sh3lan93.mobileautomator.showcase.store

import io.github.sh3lan93.mobileautomator.showcase.data.Simulation
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class LocalStoreTest {

    private val storage = InMemoryKeyValueStorage()

    @Test
    fun freshStore_switchesAreOff() {
        val store = LocalStore(storage)
        assertFalse(store.simulateOffline.value.value)
        assertFalse(store.simulateServerError.value.value)
    }

    @Test
    fun set_updatesValueFlowImmediately() {
        val store = LocalStore(storage)
        store.simulateOffline.set(true)
        assertTrue(store.simulateOffline.value.value)
    }

    @Test
    fun values_persistAcrossStoreInstances() {
        LocalStore(storage).apply {
            simulateOffline.set(true)
            simulateServerError.set(true)
        }
        val relaunched = LocalStore(storage)
        assertTrue(relaunched.simulateOffline.value.value)
        assertTrue(relaunched.simulateServerError.value.value)
    }

    @Test
    fun reset_clearsEveryValue_andEmitsDefaults() {
        val store = LocalStore(storage)
        store.simulateOffline.set(true)
        store.simulateServerError.set(true)
        store.reset()
        assertFalse(store.simulateOffline.value.value)
        assertFalse(store.simulateServerError.value.value)
        assertEquals(Simulation(), store.simulation())
        assertTrue(storage.keys().none { it.startsWith("reel_tracker.") })
    }

    @Test
    fun reset_clearsPersistedState() {
        LocalStore(storage).apply {
            simulateOffline.set(true)
            simulateServerError.set(true)
            reset()
        }
        val relaunched = LocalStore(storage)
        assertFalse(relaunched.simulateOffline.value.value)
        assertFalse(relaunched.simulateServerError.value.value)
    }

    @Test
    fun undecodableStoredValue_readsAsDefault() {
        storage.putString("reel_tracker.simulate_offline", "banana")
        assertFalse(LocalStore(storage).simulateOffline.value.value)
    }

    @Test
    fun simulation_combinesBothSwitches() {
        val store = LocalStore(storage)
        store.simulateOffline.set(true)
        assertEquals(Simulation(offline = true, serverError = false), store.simulation())
        store.simulateServerError.set(true)
        assertEquals(Simulation(offline = true, serverError = true), store.simulation())
        store.simulateOffline.set(false)
        assertEquals(Simulation(offline = false, serverError = true), store.simulation())
    }
}
