package io.github.sh3lan93.mobileautomator.showcase.screens.details

import io.github.sh3lan93.mobileautomator.showcase.data.FakeGuestTmdb
import io.github.sh3lan93.mobileautomator.showcase.data.GuestRatings
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbFailure
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

    private val dispatcher = StandardTestDispatcher()
    private val tmdb = FakeGuestTmdb()
    private val store = LocalStore(InMemoryKeyValueStorage())
    private val ratings = GuestRatings(tmdb.client, store, confirmAttempts = 1, confirmIntervalMs = 0)

    @BeforeTest
    fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterTest
    fun tearDown() = Dispatchers.resetMain()

    /** Gives the store a session holding [rated], as if the guest had rated before. */
    private fun ratedBefore(vararg rated: Pair<Int, Double>) {
        store.guestSessionId.set("s1")
        tmdb.server["s1"] = mutableMapOf(*rated)
    }

    @Test
    fun checksOnInit_notRated() = runTest(dispatcher) {
        val vm = RatingViewModel(278, ratings)
        assertEquals(RatingUiState(rating = null), vm.state.value)
        advanceUntilIdle()
        assertEquals(RatingUiState(KnownRating.NotRated), vm.state.value)
    }

    @Test
    fun checksOnInit_rated() = runTest(dispatcher) {
        ratedBefore(278 to 8.0, 550 to 6.5)
        val vm = RatingViewModel(278, ratings)
        advanceUntilIdle()
        assertEquals(RatingUiState(KnownRating.Rated(8.0)), vm.state.value)
    }

    @Test
    fun rate_showsSavingThenRated() = runTest(dispatcher) {
        val vm = RatingViewModel(278, ratings)
        advanceUntilIdle()
        vm.rate(8)
        assertEquals(RatingUiState(KnownRating.NotRated, saving = true), vm.state.value)
        advanceUntilIdle()
        assertEquals(RatingUiState(KnownRating.Rated(8.0)), vm.state.value)
        assertEquals(mapOf(278 to 8.0), tmdb.server["s1"]?.toMap())
    }

    @Test
    fun rate_ignoredWhileSaving() = runTest(dispatcher) {
        val vm = RatingViewModel(278, ratings)
        advanceUntilIdle()
        val gate = CompletableDeferred<Unit>()
        tmdb.writeGate = gate
        vm.rate(8)
        runCurrent()
        vm.rate(3)
        vm.remove()
        runCurrent()
        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals(1, tmdb.writes)
        assertEquals(RatingUiState(KnownRating.Rated(8.0)), vm.state.value)
    }

    @Test
    fun remove_showsNotRated() = runTest(dispatcher) {
        ratedBefore(278 to 8.0)
        val vm = RatingViewModel(278, ratings)
        advanceUntilIdle()
        vm.remove()
        // The known rating stays while saving, so Remove rating stays on screen (disabled).
        assertEquals(RatingUiState(KnownRating.Rated(8.0), saving = true), vm.state.value)
        advanceUntilIdle()
        assertEquals(RatingUiState(KnownRating.NotRated), vm.state.value)
        assertEquals(emptyMap(), tmdb.server["s1"]?.toMap())
    }

    @Test
    fun rateFailure_keepsLastStateAndShowsFailure() = runTest(dispatcher) {
        ratedBefore(278 to 8.0)
        val vm = RatingViewModel(278, ratings)
        advanceUntilIdle()
        tmdb.writeFailure = TmdbFailure.NoConnection
        vm.rate(4)
        advanceUntilIdle()
        assertEquals(RatingUiState(KnownRating.Rated(8.0), failure = TmdbFailure.NoConnection), vm.state.value)
        assertEquals(false, vm.state.value.firstCheckFailed)

        // A later tap is accepted again and settles normally.
        tmdb.writeFailure = null
        vm.rate(4)
        advanceUntilIdle()
        assertEquals(RatingUiState(KnownRating.Rated(4.0)), vm.state.value)
    }

    @Test
    fun checkFailure_retryReadsAgain() = runTest(dispatcher) {
        ratedBefore(278 to 8.0)
        tmdb.readFailure = TmdbFailure.ServerError
        val vm = RatingViewModel(278, ratings)
        advanceUntilIdle()
        assertEquals(RatingUiState(rating = null, failure = TmdbFailure.ServerError), vm.state.value)
        assertEquals(true, vm.state.value.firstCheckFailed)

        // Taps before anything is known are ignored.
        vm.rate(5)
        vm.remove()
        advanceUntilIdle()
        assertEquals(0, tmdb.writes)

        tmdb.readFailure = null
        vm.retry()
        assertEquals(RatingUiState(rating = null), vm.state.value)
        advanceUntilIdle()
        assertEquals(RatingUiState(KnownRating.Rated(8.0)), vm.state.value)
        assertEquals(2, tmdb.reads)
    }
}
