package io.github.sh3lan93.mobileautomator.showcase.screens.filters

import io.github.sh3lan93.mobileautomator.showcase.data.Genre
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
class FiltersViewModelTest {

    private class FakeTmdbClient(var next: TmdbResult<List<Genre>>) : TmdbClient {
        var calls = 0

        override suspend fun movieGenres(): TmdbResult<List<Genre>> {
            calls++
            return next
        }

        override suspend fun popularMovies() = error("not used")
        override suspend fun searchMovies(query: String) = error("not used")
        override suspend fun movieDetails(id: Int) = error("not used")
        override suspend fun discoverMovies(query: Map<String, String>) = error("not used")
    }

    private val dispatcher = StandardTestDispatcher()
    private val genres = listOf(Genre(28, "Action"), Genre(16, "Animation"), Genre(18, "Drama"))

    @BeforeTest
    fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterTest
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun loadsGenres_onCreation() = runTest(dispatcher) {
        val client = FakeTmdbClient(TmdbResult.Ok(genres))
        val vm = FiltersViewModel(client, currentYear = 2026)
        assertEquals(GenresUiState.Loading, vm.genres.value)
        assertEquals(2026, vm.currentYear)
        advanceUntilIdle()
        assertEquals(GenresUiState.Loaded(genres), vm.genres.value)
        assertEquals(1, client.calls)
    }

    @Test
    fun failure_isFailedWithThatFailure() = runTest(dispatcher) {
        for (failure in TmdbFailure.entries) {
            val vm = FiltersViewModel(FakeTmdbClient(TmdbResult.Failed(failure)), currentYear = 2026)
            advanceUntilIdle()
            assertEquals(GenresUiState.Failed(failure), vm.genres.value, "for $failure")
        }
    }

    @Test
    fun retry_afterFailure_loadsAgain() = runTest(dispatcher) {
        val client = FakeTmdbClient(TmdbResult.Failed(TmdbFailure.NoConnection))
        val vm = FiltersViewModel(client, currentYear = 2026)
        advanceUntilIdle()
        assertEquals(GenresUiState.Failed(TmdbFailure.NoConnection), vm.genres.value)

        client.next = TmdbResult.Ok(genres)
        vm.retry()
        assertEquals(GenresUiState.Loading, vm.genres.value)
        advanceUntilIdle()
        assertEquals(GenresUiState.Loaded(genres), vm.genres.value)
        assertEquals(2, client.calls)
    }
}
