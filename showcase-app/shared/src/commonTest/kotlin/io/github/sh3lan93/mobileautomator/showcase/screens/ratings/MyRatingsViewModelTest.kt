package io.github.sh3lan93.mobileautomator.showcase.screens.ratings

import io.github.sh3lan93.mobileautomator.showcase.data.FakeGuestTmdb
import io.github.sh3lan93.mobileautomator.showcase.data.GuestRatings
import io.github.sh3lan93.mobileautomator.showcase.data.Movie
import io.github.sh3lan93.mobileautomator.showcase.data.RatedMovie
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbFailure
import io.github.sh3lan93.mobileautomator.showcase.store.InMemoryKeyValueStorage
import io.github.sh3lan93.mobileautomator.showcase.store.LocalStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals

@OptIn(ExperimentalCoroutinesApi::class)
class MyRatingsViewModelTest {

    private val dispatcher = StandardTestDispatcher()
    private val shawshank = RatedMovie(Movie(278, "The Shawshank Redemption", "1994", null), 8.0)
    private val store = LocalStore(InMemoryKeyValueStorage()).apply { guestSessionId.set("s1") }

    private val tmdb = FakeGuestTmdb().apply { catalog[278] = shawshank.movie }

    /** Session `s1` on [tmdb] holds [films]. */
    private fun rated(vararg films: RatedMovie) {
        tmdb.server["s1"] = films.associate { it.movie.id to it.rating }.toMutableMap()
    }

    private fun viewModel() = MyRatingsViewModel(GuestRatings(tmdb.client, store))

    @BeforeTest
    fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterTest
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun loads_loaded() = runTest(dispatcher) {
        rated(shawshank)
        val vm = viewModel()
        assertEquals(MyRatingsUiState.Loading, vm.state.value)
        vm.refresh()
        advanceUntilIdle()
        assertEquals(MyRatingsUiState.Loaded(listOf(shawshank)), vm.state.value)
    }

    @Test
    fun noRatings_empty() = runTest(dispatcher) {
        rated()
        val vm = viewModel()
        vm.refresh()
        advanceUntilIdle()
        assertEquals(MyRatingsUiState.Empty, vm.state.value)
    }

    @Test
    fun failure_failed() = runTest(dispatcher) {
        tmdb.readFailure = TmdbFailure.NoConnection
        val vm = viewModel()
        vm.refresh()
        advanceUntilIdle()
        assertEquals(MyRatingsUiState.Failed(TmdbFailure.NoConnection), vm.state.value)
    }

    @Test
    fun refresh_reReads() = runTest(dispatcher) {
        rated(shawshank)
        val vm = viewModel()
        vm.refresh()
        advanceUntilIdle()
        assertEquals(MyRatingsUiState.Loaded(listOf(shawshank)), vm.state.value)

        // Back from Details after removing the rating: the next resume reads the list again.
        rated()
        vm.refresh()
        advanceUntilIdle()
        assertEquals(MyRatingsUiState.Empty, vm.state.value)
        assertEquals(2, tmdb.reads)
    }
}
