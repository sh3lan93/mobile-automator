package io.github.sh3lan93.mobileautomator.showcase.screens.watchlist

import io.github.sh3lan93.mobileautomator.showcase.data.Movie
import io.github.sh3lan93.mobileautomator.showcase.data.Watchlist
import io.github.sh3lan93.mobileautomator.showcase.store.InMemoryKeyValueStorage
import io.github.sh3lan93.mobileautomator.showcase.store.LocalStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals

@OptIn(ExperimentalCoroutinesApi::class)
class WatchlistViewModelTest {

    private val watchlist = Watchlist(LocalStore(InMemoryKeyValueStorage()))
    private val shawshank = Movie(278, "The Shawshank Redemption", "1994", null)
    private val fightClub = Movie(550, "Fight Club", "1999", null)

    @BeforeTest
    fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @AfterTest
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun empty_initially() {
        assertEquals(emptyList(), WatchlistViewModel(watchlist).films.value)
    }

    @Test
    fun listsSavedFilms() {
        watchlist.add(shawshank)
        watchlist.add(fightClub)
        assertEquals(listOf(shawshank, fightClub), WatchlistViewModel(watchlist).films.value)
    }

    @Test
    fun followsRemoval() {
        watchlist.add(shawshank)
        watchlist.add(fightClub)
        val vm = WatchlistViewModel(watchlist)
        // Removed on Details while this screen is on the back stack.
        watchlist.remove(shawshank.id)
        assertEquals(listOf(fightClub), vm.films.value)
    }
}
