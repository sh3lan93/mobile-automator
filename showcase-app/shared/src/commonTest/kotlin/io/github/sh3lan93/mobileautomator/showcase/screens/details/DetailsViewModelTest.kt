package io.github.sh3lan93.mobileautomator.showcase.screens.details

import io.github.sh3lan93.mobileautomator.showcase.data.MovieDetails
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbClient
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbFailure
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbResult
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
class DetailsViewModelTest {

    private class FakeTmdbClient(var next: TmdbResult<MovieDetails>) : TmdbClient {
        val ids = mutableListOf<Int>()

        override suspend fun movieDetails(id: Int): TmdbResult<MovieDetails> {
            ids += id
            return next
        }

        override suspend fun popularMovies() = error("not used")
        override suspend fun searchMovies(query: String) = error("not used")
        override suspend fun discoverMovies(query: Map<String, String>) = error("not used")
        override suspend fun movieGenres() = error("not used")
    }

    private val dispatcher = StandardTestDispatcher()
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
        val client = FakeTmdbClient(TmdbResult.Ok(details))
        DetailsViewModel(278, client)
        advanceUntilIdle()
        assertEquals(listOf(278), client.ids)
    }

    @Test
    fun loaded() = runTest(dispatcher) {
        val vm = DetailsViewModel(278, FakeTmdbClient(TmdbResult.Ok(details)))
        assertEquals(DetailsUiState.Loading, vm.state.value)
        advanceUntilIdle()
        assertEquals(DetailsUiState.Loaded(details), vm.state.value)
    }

    @Test
    fun failure_isFailed() = runTest(dispatcher) {
        for (failure in TmdbFailure.entries) {
            val vm = DetailsViewModel(278, FakeTmdbClient(TmdbResult.Failed(failure)))
            advanceUntilIdle()
            assertEquals(DetailsUiState.Failed(failure), vm.state.value, "for $failure")
        }
    }

    @Test
    fun retry_afterFailure_loadsAgain() = runTest(dispatcher) {
        val client = FakeTmdbClient(TmdbResult.Failed(TmdbFailure.ServerError))
        val vm = DetailsViewModel(278, client)
        advanceUntilIdle()
        assertEquals(DetailsUiState.Failed(TmdbFailure.ServerError), vm.state.value)

        client.next = TmdbResult.Ok(details)
        vm.retry()
        assertEquals(DetailsUiState.Loading, vm.state.value)
        advanceUntilIdle()
        assertEquals(DetailsUiState.Loaded(details), vm.state.value)
        assertEquals(listOf(278, 278), client.ids)
    }
}
