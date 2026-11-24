package io.github.sh3lan93.mobileautomator.showcase.screens.details

import io.github.sh3lan93.mobileautomator.showcase.data.GuestCall
import io.github.sh3lan93.mobileautomator.showcase.data.GuestRatings
import io.github.sh3lan93.mobileautomator.showcase.data.Movie
import io.github.sh3lan93.mobileautomator.showcase.data.RatedMovie
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbClient
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbFailure
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbResult
import io.github.sh3lan93.mobileautomator.showcase.store.InMemoryKeyValueStorage
import io.github.sh3lan93.mobileautomator.showcase.store.LocalStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals

@OptIn(ExperimentalCoroutinesApi::class)
class RatingViewModelTest {

    /** A TMDB with one session; [readFailure] / [writeFailure] fail the next calls, [writeGate] holds writes. */
    private class FakeTmdbClient : TmdbClient {
        val log = mutableListOf<String>()
        val server = mutableMapOf<Int, Double>()
        var readFailure: TmdbFailure? = null
        var writeFailure: TmdbFailure? = null
        var writeGate: CompletableDeferred<Unit>? = null

        val writes get() = log.count { it.startsWith("rate:") || it.startsWith("remove:") }

        override suspend fun createGuestSession(): TmdbResult<String> {
            log += "create"
            return TmdbResult.Ok("s1")
        }

        override suspend fun rateMovie(sessionId: String, movieId: Int, value: Double): TmdbResult<GuestCall<Unit>> {
            log += "rate:$movieId:$value"
            writeGate?.await()
            writeFailure?.let { return TmdbResult.Failed(it) }
            server[movieId] = value
            return TmdbResult.Ok(GuestCall.Done(Unit))
        }

        override suspend fun removeRating(sessionId: String, movieId: Int): TmdbResult<GuestCall<Unit>> {
            log += "remove:$movieId"
            writeGate?.await()
            writeFailure?.let { return TmdbResult.Failed(it) }
            server.remove(movieId)
            return TmdbResult.Ok(GuestCall.Done(Unit))
        }

        override suspend fun ratedMovies(sessionId: String): TmdbResult<GuestCall<List<RatedMovie>>> {
            log += "rated"
            readFailure?.let { return TmdbResult.Failed(it) }
            return TmdbResult.Ok(GuestCall.Done(server.map { (id, v) -> RatedMovie(Movie(id, "Film $id", null, null), v) }))
        }

        override suspend fun popularMovies() = error("not used")
        override suspend fun searchMovies(query: String) = error("not used")
        override suspend fun movieDetails(id: Int) = error("not used")
        override suspend fun discoverMovies(query: Map<String, String>) = error("not used")
        override suspend fun movieGenres() = error("not used")
    }

    private val dispatcher = StandardTestDispatcher()
    private val client = FakeTmdbClient()
    private val store = LocalStore(InMemoryKeyValueStorage())
    private val ratings = GuestRatings(client, store, confirmAttempts = 1, confirmIntervalMs = 0)

    @BeforeTest
    fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterTest
    fun tearDown() = Dispatchers.resetMain()

    /** Gives the store a session holding [rated], as if the guest had rated before. */
    private fun ratedBefore(vararg rated: Pair<Int, Double>) {
        store.guestSessionId.set("s1")
        client.server.putAll(rated)
    }

    @Test
    fun checksOnInit_notRated() = runTest(dispatcher) {
        val vm = RatingViewModel(278, ratings)
        assertEquals(RatingUiState.Checking, vm.state.value)
        advanceUntilIdle()
        assertEquals(RatingUiState.NotRated, vm.state.value)
    }

    @Test
    fun checksOnInit_rated() = runTest(dispatcher) {
        ratedBefore(278 to 8.0, 550 to 6.5)
        val vm = RatingViewModel(278, ratings)
        advanceUntilIdle()
        assertEquals(RatingUiState.Rated(8.0), vm.state.value)
    }

    @Test
    fun rate_showsSavingThenRated() = runTest(dispatcher) {
        val vm = RatingViewModel(278, ratings)
        advanceUntilIdle()
        vm.rate(8)
        assertEquals(RatingUiState.Saving, vm.state.value)
        advanceUntilIdle()
        assertEquals(RatingUiState.Rated(8.0), vm.state.value)
        assertEquals(mapOf(278 to 8.0), client.server.toMap())
    }

    @Test
    fun rate_ignoredWhileSaving() = runTest(dispatcher) {
        val vm = RatingViewModel(278, ratings)
        advanceUntilIdle()
        val gate = CompletableDeferred<Unit>()
        client.writeGate = gate
        vm.rate(8)
        runCurrent()
        vm.rate(3)
        vm.remove()
        runCurrent()
        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals(1, client.writes)
        assertEquals(RatingUiState.Rated(8.0), vm.state.value)
    }

    @Test
    fun remove_showsNotRated() = runTest(dispatcher) {
        ratedBefore(278 to 8.0)
        val vm = RatingViewModel(278, ratings)
        advanceUntilIdle()
        vm.remove()
        assertEquals(RatingUiState.Saving, vm.state.value)
        advanceUntilIdle()
        assertEquals(RatingUiState.NotRated, vm.state.value)
        assertEquals(emptyMap(), client.server.toMap())
    }

    @Test
    fun rateFailure_keepsLastStateAndShowsFailure() = runTest(dispatcher) {
        ratedBefore(278 to 8.0)
        val vm = RatingViewModel(278, ratings)
        advanceUntilIdle()
        client.writeFailure = TmdbFailure.NoConnection
        vm.rate(4)
        advanceUntilIdle()
        assertEquals(RatingUiState.Failed(TmdbFailure.NoConnection, RatingUiState.Rated(8.0)), vm.state.value)

        // A later tap is accepted again and settles normally.
        client.writeFailure = null
        vm.rate(4)
        advanceUntilIdle()
        assertEquals(RatingUiState.Rated(4.0), vm.state.value)
    }

    @Test
    fun checkFailure_retryReadsAgain() = runTest(dispatcher) {
        ratedBefore(278 to 8.0)
        client.readFailure = TmdbFailure.ServerError
        val vm = RatingViewModel(278, ratings)
        advanceUntilIdle()
        assertEquals(RatingUiState.Failed(TmdbFailure.ServerError, RatingUiState.Checking), vm.state.value)

        client.readFailure = null
        vm.retry()
        assertEquals(RatingUiState.Checking, vm.state.value)
        advanceUntilIdle()
        assertEquals(RatingUiState.Rated(8.0), vm.state.value)
        assertEquals(2, client.log.count { it == "rated" })
    }
}
