package io.github.sh3lan93.mobileautomator.showcase.screens.popular

import io.github.sh3lan93.mobileautomator.showcase.data.FilterState
import io.github.sh3lan93.mobileautomator.showcase.data.Genre
import io.github.sh3lan93.mobileautomator.showcase.data.Movie
import io.github.sh3lan93.mobileautomator.showcase.data.SearchPage
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbClient
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbFailure
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbResult
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
class PopularViewModelTest {

    /**
     * Records every call, in order. A discover query with a gate suspends until the test completes it.
     */
    private class FakeTmdbClient(var next: TmdbResult<List<Movie>>) : TmdbClient {
        val calls = mutableListOf<Call>()
        val discoverResponses = mutableMapOf<Map<String, String>, TmdbResult<SearchPage>>()
        val gates = mutableMapOf<Map<String, String>, CompletableDeferred<Unit>>()
        var nextDiscover: TmdbResult<SearchPage> = TmdbResult.Ok(SearchPage(emptyList(), 0))

        override suspend fun popularMovies(): TmdbResult<List<Movie>> {
            calls += Call.Popular
            return next
        }

        override suspend fun discoverMovies(query: Map<String, String>): TmdbResult<SearchPage> {
            calls += Call.Discover(query)
            gates[query]?.await()
            return discoverResponses[query] ?: nextDiscover
        }

        override suspend fun searchMovies(query: String) = error("not used")
        override suspend fun movieDetails(id: Int) = error("not used")
        override suspend fun movieGenres() = error("not used")
    }

    private sealed interface Call {
        data object Popular : Call
        data class Discover(val query: Map<String, String>) : Call
    }

    private val dispatcher = StandardTestDispatcher()
    private val movie = Movie(603, "The Matrix", "1999", null)
    private val shawshank = Movie(278, "The Shawshank Redemption", "1994", null)
    private val drama1994 = FilterState(genre = Genre(18, "Drama"), year = 1994)
    private val rated9 = FilterState(minRating = 9)

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

    @Test
    fun default_usesPopular_notDiscover() = runTest(dispatcher) {
        val client = FakeTmdbClient(TmdbResult.Ok(listOf(movie)))
        val vm = PopularViewModel(client)
        advanceUntilIdle()
        assertEquals(FilterState(), vm.filters.value)
        assertEquals(listOf<Call>(Call.Popular), client.calls)
        assertEquals(PopularUiState.Loaded(listOf(movie), count = 1), vm.state.value)
    }

    @Test
    fun setFilters_loadsDiscoverWithThatQuery() = runTest(dispatcher) {
        val client = FakeTmdbClient(TmdbResult.Ok(listOf(movie)))
        val vm = PopularViewModel(client)
        advanceUntilIdle()

        client.nextDiscover = TmdbResult.Ok(SearchPage(listOf(shawshank), 1))
        vm.setFilters(drama1994)
        assertEquals(drama1994, vm.filters.value)
        assertEquals(PopularUiState.Loading, vm.state.value)
        advanceUntilIdle()
        assertEquals(listOf(Call.Popular, Call.Discover(drama1994.toDiscoverQuery())), client.calls)
        assertEquals(PopularUiState.Loaded(listOf(shawshank), count = 1), vm.state.value)
    }

    @Test
    fun discoverCount_isTotalResults() = runTest(dispatcher) {
        val client = FakeTmdbClient(TmdbResult.Ok(listOf(movie)))
        client.nextDiscover = TmdbResult.Ok(SearchPage(listOf(shawshank, movie), 312))
        val vm = PopularViewModel(client)
        vm.setFilters(drama1994)
        advanceUntilIdle()
        assertEquals(PopularUiState.Loaded(listOf(shawshank, movie), count = 312), vm.state.value)
    }

    @Test
    fun emptyDiscover_isNoMatches() = runTest(dispatcher) {
        val client = FakeTmdbClient(TmdbResult.Ok(listOf(movie)))
        client.nextDiscover = TmdbResult.Ok(SearchPage(emptyList(), 0))
        val vm = PopularViewModel(client)
        vm.setFilters(rated9)
        advanceUntilIdle()
        assertEquals(PopularUiState.NoMatches, vm.state.value)
    }

    @Test
    fun backToDefault_usesPopularAgain() = runTest(dispatcher) {
        val client = FakeTmdbClient(TmdbResult.Ok(listOf(movie)))
        client.nextDiscover = TmdbResult.Ok(SearchPage(listOf(shawshank), 1))
        val vm = PopularViewModel(client)
        advanceUntilIdle()
        vm.setFilters(drama1994)
        advanceUntilIdle()

        vm.setFilters(FilterState())
        advanceUntilIdle()
        assertEquals(
            listOf(Call.Popular, Call.Discover(drama1994.toDiscoverQuery()), Call.Popular),
            client.calls,
        )
        assertEquals(PopularUiState.Loaded(listOf(movie)), vm.state.value)
    }

    @Test
    fun lastChangeWins() = runTest(dispatcher) {
        val client = FakeTmdbClient(TmdbResult.Ok(listOf(movie)))
        val slow = CompletableDeferred<Unit>()
        client.gates[drama1994.toDiscoverQuery()] = slow
        client.discoverResponses[drama1994.toDiscoverQuery()] = TmdbResult.Ok(SearchPage(listOf(shawshank), 1))
        client.discoverResponses[rated9.toDiscoverQuery()] = TmdbResult.Ok(SearchPage(listOf(movie), 40))
        val vm = PopularViewModel(client)
        advanceUntilIdle()

        vm.setFilters(drama1994)
        runCurrent()
        vm.setFilters(rated9)
        advanceUntilIdle()
        assertEquals(PopularUiState.Loaded(listOf(movie), count = 40), vm.state.value)

        // The first, slower response arrives late; it must not overwrite the later filters' results.
        slow.complete(Unit)
        advanceUntilIdle()
        assertEquals(PopularUiState.Loaded(listOf(movie), count = 40), vm.state.value)
        assertEquals(rated9, vm.filters.value)
    }

    @Test
    fun sameFilters_noReload() = runTest(dispatcher) {
        val client = FakeTmdbClient(TmdbResult.Ok(listOf(movie)))
        val vm = PopularViewModel(client)
        advanceUntilIdle()
        vm.setFilters(FilterState())
        vm.setFilters(drama1994)
        advanceUntilIdle()
        vm.setFilters(drama1994.copy())
        advanceUntilIdle()
        assertEquals(listOf(Call.Popular, Call.Discover(drama1994.toDiscoverQuery())), client.calls)
    }

    @Test
    fun retry_reloadsCurrentFilters() = runTest(dispatcher) {
        val client = FakeTmdbClient(TmdbResult.Ok(listOf(movie)))
        client.nextDiscover = TmdbResult.Failed(TmdbFailure.NoConnection)
        val vm = PopularViewModel(client)
        vm.setFilters(drama1994)
        advanceUntilIdle()
        assertEquals(PopularUiState.Failed(TmdbFailure.NoConnection), vm.state.value)

        client.nextDiscover = TmdbResult.Ok(SearchPage(listOf(shawshank), 1))
        vm.retry()
        assertEquals(PopularUiState.Loading, vm.state.value)
        advanceUntilIdle()
        assertEquals(Call.Discover(drama1994.toDiscoverQuery()), client.calls.last())
        assertEquals(PopularUiState.Loaded(listOf(shawshank), count = 1), vm.state.value)
    }

    @Test
    fun discoverFailure_isFailed() = runTest(dispatcher) {
        for (failure in TmdbFailure.entries) {
            val client = FakeTmdbClient(TmdbResult.Ok(listOf(movie)))
            client.nextDiscover = TmdbResult.Failed(failure)
            val vm = PopularViewModel(client)
            vm.setFilters(rated9)
            advanceUntilIdle()
            assertEquals(PopularUiState.Failed(failure), vm.state.value, "for $failure")
        }
    }
}
