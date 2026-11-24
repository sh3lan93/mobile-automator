package io.github.sh3lan93.mobileautomator.showcase.screens.filters

import io.github.sh3lan93.mobileautomator.showcase.data.FakeTmdbClient
import io.github.sh3lan93.mobileautomator.showcase.data.Genre
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbCall
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

    /** A client whose genre list answers [result]. */
    private fun fake(result: TmdbResult<List<Genre>>) = FakeTmdbClient(onMovieGenres = { result })

    private val dispatcher = StandardTestDispatcher()
    private val genres = listOf(Genre(28, "Action"), Genre(16, "Animation"), Genre(18, "Drama"))

    @BeforeTest
    fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterTest
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun loadsGenres_onCreation() = runTest(dispatcher) {
        val client = fake(TmdbResult.Ok(genres))
        val vm = FiltersViewModel(client, currentYear = 2026)
        assertEquals(GenresUiState.Loading, vm.genres.value)
        assertEquals(2026, vm.currentYear)
        advanceUntilIdle()
        assertEquals(GenresUiState.Loaded(genres), vm.genres.value)
        assertEquals(listOf<TmdbCall>(TmdbCall.Genres), client.calls)
    }

    @Test
    fun failure_isFailedWithThatFailure() = runTest(dispatcher) {
        for (failure in TmdbFailure.entries) {
            val vm = FiltersViewModel(fake(TmdbResult.Failed(failure)), currentYear = 2026)
            advanceUntilIdle()
            assertEquals(GenresUiState.Failed(failure), vm.genres.value, "for $failure")
        }
    }

    @Test
    fun retry_afterFailure_loadsAgain() = runTest(dispatcher) {
        val client = fake(TmdbResult.Failed(TmdbFailure.NoConnection))
        val vm = FiltersViewModel(client, currentYear = 2026)
        advanceUntilIdle()
        assertEquals(GenresUiState.Failed(TmdbFailure.NoConnection), vm.genres.value)

        client.onMovieGenres = { TmdbResult.Ok(genres) }
        vm.retry()
        assertEquals(GenresUiState.Loading, vm.genres.value)
        advanceUntilIdle()
        assertEquals(GenresUiState.Loaded(genres), vm.genres.value)
        assertEquals(listOf<TmdbCall>(TmdbCall.Genres, TmdbCall.Genres), client.calls)
    }
}
