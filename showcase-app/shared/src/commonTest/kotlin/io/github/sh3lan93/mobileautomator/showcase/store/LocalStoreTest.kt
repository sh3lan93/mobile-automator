package io.github.sh3lan93.mobileautomator.showcase.store

import io.github.sh3lan93.mobileautomator.showcase.data.Simulation
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
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
    fun reset_emptiesWatchlist() {
        val store = LocalStore(storage)
        store.simulateOffline.set(true)
        store.watchlist.set(listOf(shawshank))
        store.reset()
        assertEquals(emptyList(), store.watchlist.value.value)
        assertEquals(emptyList(), LocalStore(storage).watchlist.value.value)
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

    @Test
    fun guestSessionId_persistsAndResetClearsIt() {
        val store = LocalStore(storage)
        assertNull(store.guestSessionId.value.value)
        store.guestSessionId.set("g1")
        assertEquals("g1", LocalStore(storage).guestSessionId.value.value)
        store.reset()
        assertNull(store.guestSessionId.value.value)
        assertNull(LocalStore(storage).guestSessionId.value.value)
    }

    @Test
    fun watchlist_freshStore_isEmpty() {
        assertEquals(emptyList(), LocalStore(storage).watchlist.value.value)
    }

    @Test
    fun watchlist_persistsAcrossStoreInstances() {
        LocalStore(storage).watchlist.set(listOf(shawshank, fightClub))
        assertEquals(listOf(shawshank, fightClub), LocalStore(storage).watchlist.value.value)
    }

    @Test
    fun watchlist_undecodableJson_readsEmpty() {
        storage.putString("reel_tracker.watchlist", "{not json")
        assertEquals(emptyList(), LocalStore(storage).watchlist.value.value)
    }

    @Test
    fun flags_freshStore_areOff() {
        val store = LocalStore(storage)
        assertFalse(store.compactDetails.value.value)
        assertFalse(store.confirmWatchlistRemoval.value.value)
    }

    @Test
    fun flags_persistAcrossStoreInstances() {
        LocalStore(storage).apply {
            compactDetails.set(true)
            confirmWatchlistRemoval.set(true)
        }
        val relaunched = LocalStore(storage)
        assertTrue(relaunched.compactDetails.value.value)
        assertTrue(relaunched.confirmWatchlistRemoval.value.value)
    }

    @Test
    fun reset_clearsFlags() {
        val store = LocalStore(storage)
        store.compactDetails.set(true)
        store.confirmWatchlistRemoval.set(true)
        store.reset()
        assertFalse(store.compactDetails.value.value)
        assertFalse(store.confirmWatchlistRemoval.value.value)
        assertFalse(LocalStore(storage).compactDetails.value.value)
        assertFalse(LocalStore(storage).confirmWatchlistRemoval.value.value)
        assertTrue(storage.keys().none { it.startsWith("reel_tracker.") }, "storage still holds ${storage.keys()}")
    }

    private companion object {
        val shawshank = WatchlistEntry(278, "The Shawshank Redemption", "1994", "https://image.tmdb.org/t/p/w154/a.jpg")
        val fightClub = WatchlistEntry(550, "Fight Club", null, null)
    }
}
