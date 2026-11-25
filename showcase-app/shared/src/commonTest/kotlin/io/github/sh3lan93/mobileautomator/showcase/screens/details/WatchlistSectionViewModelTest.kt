package io.github.sh3lan93.mobileautomator.showcase.screens.details

import io.github.sh3lan93.mobileautomator.showcase.data.Movie
import io.github.sh3lan93.mobileautomator.showcase.data.Watchlist
import io.github.sh3lan93.mobileautomator.showcase.store.InMemoryKeyValueStorage
import io.github.sh3lan93.mobileautomator.showcase.store.LocalStore
import io.github.sh3lan93.mobileautomator.showcase.store.WatchlistEntry
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WatchlistSectionViewModelTest {

    private val store = LocalStore(InMemoryKeyValueStorage())
    private val watchlist = Watchlist(store)
    private val shawshank = Movie(278, "The Shawshank Redemption", "1994", null)

    private fun viewModel() = WatchlistSectionViewModel(shawshank, watchlist)

    @Test
    fun notSaved_initially() {
        assertFalse(viewModel().saved.value)
    }

    @Test
    fun add_saved() {
        val vm = viewModel()
        vm.add()
        assertTrue(vm.saved.value)
        assertEquals(listOf(shawshank), watchlist.films.value)
    }

    @Test
    fun remove_notSaved() {
        watchlist.add(shawshank)
        val vm = viewModel()
        assertTrue(vm.saved.value)
        vm.remove()
        assertFalse(vm.saved.value)
        assertEquals(emptyList(), watchlist.films.value)
    }

    @Test
    fun savedElsewhere_isReflected() {
        val vm = viewModel()
        store.watchlist.set(listOf(WatchlistEntry(278, "The Shawshank Redemption", "1994")))
        assertTrue(vm.saved.value)
        store.reset()
        assertFalse(vm.saved.value)
    }
}
