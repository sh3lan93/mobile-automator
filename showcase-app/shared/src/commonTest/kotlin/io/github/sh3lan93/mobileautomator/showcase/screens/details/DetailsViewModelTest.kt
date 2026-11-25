package io.github.sh3lan93.mobileautomator.showcase.screens.details

import io.github.sh3lan93.mobileautomator.showcase.data.FakeTmdbClient
import io.github.sh3lan93.mobileautomator.showcase.data.MovieDetails
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbCall
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
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class DetailsViewModelTest {

    /** A client whose details call answers [result]. */
    private fun fake(result: TmdbResult<MovieDetails>) = FakeTmdbClient(onMovieDetails = { result })

    /** The ids the details call was made with, in order. */
    private val FakeTmdbClient.ids: List<Int> get() = calls.map { (it as TmdbCall.Details).id }

    private val dispatcher = StandardTestDispatcher()
    private val store = LocalStore(InMemoryKeyValueStorage())
    private val details = MovieDetails(
        id = 278,
        title = "The Shawshank Redemption",
        releaseYear = "1994",
        runtimeMinutes = 142,
        genres = listOf("Drama", "Crime"),
        overview = "Two imprisoned men bond.",
        posterUrl = null,
    )

    @BeforeTest
    fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterTest
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun loadsTheGivenId() = runTest(dispatcher) {
        val client = fake(TmdbResult.Ok(details))
        DetailsViewModel(278, client, store)
        advanceUntilIdle()
        assertEquals(listOf(278), client.ids)
    }

    @Test
    fun loaded() = runTest(dispatcher) {
        val vm = DetailsViewModel(278, fake(TmdbResult.Ok(details)), store)
        assertEquals(DetailsUiState.Loading, vm.state.value)
        advanceUntilIdle()
        assertEquals(DetailsUiState.Loaded(details), vm.state.value)
    }

    @Test
    fun failure_isFailed() = runTest(dispatcher) {
        for (failure in TmdbFailure.entries) {
            val vm = DetailsViewModel(278, fake(TmdbResult.Failed(failure)), store)
            advanceUntilIdle()
            assertEquals(DetailsUiState.Failed(failure), vm.state.value, "for $failure")
        }
    }

    @Test
    fun retry_afterFailure_loadsAgain() = runTest(dispatcher) {
        val client = fake(TmdbResult.Failed(TmdbFailure.ServerError))
        val vm = DetailsViewModel(278, client, store)
        advanceUntilIdle()
        assertEquals(DetailsUiState.Failed(TmdbFailure.ServerError), vm.state.value)

        client.onMovieDetails = { TmdbResult.Ok(details) }
        vm.retry()
        assertEquals(DetailsUiState.Loading, vm.state.value)
        advanceUntilIdle()
        assertEquals(DetailsUiState.Loaded(details), vm.state.value)
        assertEquals(listOf(278, 278), client.ids)
    }

    @Test
    fun compactLayout_followsStore() = runTest(dispatcher) {
        val vm = DetailsViewModel(278, fake(TmdbResult.Ok(details)), store)
        assertFalse(vm.compactLayout.value)
        store.compactDetails.set(true)
        assertTrue(vm.compactLayout.value)
        store.compactDetails.set(false)
        assertFalse(vm.compactLayout.value)
    }
}
