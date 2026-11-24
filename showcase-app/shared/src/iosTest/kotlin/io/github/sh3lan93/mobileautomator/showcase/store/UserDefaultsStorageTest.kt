package io.github.sh3lan93.mobileautomator.showcase.store

import platform.Foundation.NSUserDefaults
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class UserDefaultsStorageTest {

    private val suiteName = "io.github.sh3lan93.mobileautomator.showcase.store.test"
    private val defaults = NSUserDefaults(suiteName = suiteName)
    private val storage = UserDefaultsStorage(defaults)

    @AfterTest
    fun tearDown() = defaults.removePersistentDomainForName(suiteName)

    @Test
    fun putThenGet_roundTrips() {
        storage.putString("k", "v")
        assertEquals("v", storage.getString("k"))
    }

    @Test
    fun remove_deletesTheKey() {
        storage.putString("k", "v")
        storage.remove("k")
        assertNull(storage.getString("k"))
    }

    @Test
    fun localStoreReset_leavesTheSuiteEmpty() {
        val store = LocalStore(storage)
        store.simulateOffline.set(true)
        store.simulateServerError.set(true)
        store.reset()
        assertTrue(defaults.persistentDomainForName(suiteName).orEmpty().isEmpty())
    }
}
