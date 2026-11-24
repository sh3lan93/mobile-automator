package io.github.sh3lan93.mobileautomator.showcase.screens.ratings

import io.github.sh3lan93.mobileautomator.showcase.data.GuestCall
import io.github.sh3lan93.mobileautomator.showcase.data.GuestRatings
import io.github.sh3lan93.mobileautomator.showcase.data.Movie
import io.github.sh3lan93.mobileautomator.showcase.data.RatedMovie
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbClient
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbFailure
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbResult
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

    /** The rated list of session `s1`: [next] is what the next read returns. */
    private class FakeTmdbClient(var next: TmdbResult<GuestCall<List<RatedMovie>>>) : TmdbClient {
        var reads = 0

        override suspend fun ratedMovies(sessionId: String): TmdbResult<GuestCall<List<RatedMovie>>> {
            reads++
            return next
        }

        override suspend fun popularMovies() = error("not used")
        override suspend fun searchMovies(query: String) = error("not used")
        override suspend fun movieDetails(id: Int) = error("not used")
        override suspend fun discoverMovies(query: Map<String, String>) = error("not used")
        override suspend fun movieGenres() = error("not used")
        override suspend fun createGuestSession() = error("not used")
        override suspend fun rateMovie(sessionId: String, movieId: Int, value: Double) = error("not used")
        override suspend fun removeRating(sessionId: String, movieId: Int) = error("not used")
    }

    private val dispatcher = StandardTestDispatcher()
    private val shawshank = RatedMovie(Movie(278, "The Shawshank Redemption", "1994", null), 8.0)
    private val store = LocalStore(InMemoryKeyValueStorage()).apply { guestSessionId.set("s1") }

    private fun list(vararg films: RatedMovie) = TmdbResult.Ok(GuestCall.Done(films.toList()))

    private fun viewModel(client: TmdbClient) = MyRatingsViewModel(GuestRatings(client, store))

    @BeforeTest
    fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterTest
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun loads_loaded() = runTest(dispatcher) {
        val vm = viewModel(FakeTmdbClient(list(shawshank)))
        assertEquals(MyRatingsUiState.Loading, vm.state.value)
        vm.refresh()
        advanceUntilIdle()
        assertEquals(MyRatingsUiState.Loaded(listOf(shawshank)), vm.state.value)
    }

    @Test
    fun noRatings_empty() = runTest(dispatcher) {
        val vm = viewModel(FakeTmdbClient(list()))
        vm.refresh()
        advanceUntilIdle()
        assertEquals(MyRatingsUiState.Empty, vm.state.value)
    }

    @Test
    fun failure_failed() = runTest(dispatcher) {
        val vm = viewModel(FakeTmdbClient(TmdbResult.Failed(TmdbFailure.NoConnection)))
        vm.refresh()
        advanceUntilIdle()
        assertEquals(MyRatingsUiState.Failed(TmdbFailure.NoConnection), vm.state.value)
    }

    @Test
    fun refresh_reReads() = runTest(dispatcher) {
        val client = FakeTmdbClient(list(shawshank))
        val vm = viewModel(client)
        vm.refresh()
        advanceUntilIdle()
        assertEquals(MyRatingsUiState.Loaded(listOf(shawshank)), vm.state.value)

        // Back from Details after removing the rating: the next resume reads the list again.
        client.next = list()
        vm.refresh()
        advanceUntilIdle()
        assertEquals(MyRatingsUiState.Empty, vm.state.value)
        assertEquals(2, client.reads)
    }
}
