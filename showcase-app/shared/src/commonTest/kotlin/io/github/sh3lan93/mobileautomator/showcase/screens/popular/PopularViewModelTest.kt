package io.github.sh3lan93.mobileautomator.showcase.screens.popular

import io.github.sh3lan93.mobileautomator.showcase.data.Movie
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
class PopularViewModelTest {

    private class FakeTmdbClient(var next: TmdbResult<List<Movie>>) : TmdbClient {
        override suspend fun popularMovies(): TmdbResult<List<Movie>> = next
    }

    private val dispatcher = StandardTestDispatcher()
    private val movie = Movie(603, "The Matrix", "1999", null)

    @BeforeTest
    fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterTest
    fun tearDown() = Dispatchers.resetMain()

    @Test
    fun startsLoading_thenLoaded() = runTest(dispatcher) {
        val vm = PopularViewModel(FakeTmdbClient(TmdbResult.Ok(listOf(movie))))
        assertEquals(PopularUiState.Loading, vm.state.value)
        advanceUntilIdle()
        assertEquals(PopularUiState.Loaded(listOf(movie)), vm.state.value)
    }

    @Test
    fun emptyResult_isEmpty() = runTest(dispatcher) {
        val vm = PopularViewModel(FakeTmdbClient(TmdbResult.Ok(emptyList())))
        advanceUntilIdle()
        assertEquals(PopularUiState.Empty, vm.state.value)
    }

    @Test
    fun failure_isFailedWithThatFailure() = runTest(dispatcher) {
        for (failure in TmdbFailure.entries) {
            val vm = PopularViewModel(FakeTmdbClient(TmdbResult.Failed(failure)))
            advanceUntilIdle()
            assertEquals(PopularUiState.Failed(failure), vm.state.value, "for $failure")
        }
    }

    @Test
    fun retry_afterFailure_loadsAgain() = runTest(dispatcher) {
        val client = FakeTmdbClient(TmdbResult.Failed(TmdbFailure.NoConnection))
        val vm = PopularViewModel(client)
        advanceUntilIdle()
        assertEquals(PopularUiState.Failed(TmdbFailure.NoConnection), vm.state.value)

        client.next = TmdbResult.Ok(listOf(movie))
        vm.retry()
        assertEquals(PopularUiState.Loading, vm.state.value)
        advanceUntilIdle()
        assertEquals(PopularUiState.Loaded(listOf(movie)), vm.state.value)
    }
}
