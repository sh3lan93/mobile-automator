package io.github.sh3lan93.mobileautomator.showcase.screens.details

import io.github.sh3lan93.mobileautomator.showcase.data.Movie
import io.github.sh3lan93.mobileautomator.showcase.data.Watchlist
import io.github.sh3lan93.mobileautomator.showcase.store.InMemoryKeyValueStorage
import io.github.sh3lan93.mobileautomator.showcase.store.LocalStore
import io.github.sh3lan93.mobileautomator.showcase.store.WatchlistEntry
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class WatchlistSectionViewModelTest {

    private val store = LocalStore(InMemoryKeyValueStorage())
    private val watchlist = Watchlist(store)
    private val shawshank = Movie(278, "The Shawshank Redemption", "1994", null)

    private fun viewModel() = WatchlistSectionViewModel(shawshank, watchlist)

    @BeforeTest
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @AfterTest
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun notSaved_initially() = runTest {
        assertFalse(viewModel().saved.value)
    }

    @Test
    fun add_saved() = runTest {
        val vm = viewModel()
        vm.add()
        assertTrue(vm.saved.value)
        assertEquals(listOf(shawshank), watchlist.films.first())
    }

    @Test
    fun remove_notSaved() = runTest {
        watchlist.add(shawshank)
        val vm = viewModel()
        assertTrue(vm.saved.value)
        vm.remove()
        assertFalse(vm.saved.value)
        assertEquals(emptyList(), watchlist.films.first())
    }

    @Test
    fun savedElsewhere_isReflected() = runTest {
        val vm = viewModel()
        store.watchlist.set(listOf(WatchlistEntry(278, "The Shawshank Redemption", "1994")))
        assertTrue(vm.saved.value)
        store.reset()
        assertFalse(vm.saved.value)
    }
}
