package io.github.sh3lan93.mobileautomator.showcase.screens.popular

import io.github.sh3lan93.mobileautomator.showcase.data.FakeTmdbClient
import io.github.sh3lan93.mobileautomator.showcase.data.FilterState
import io.github.sh3lan93.mobileautomator.showcase.data.Genre
import io.github.sh3lan93.mobileautomator.showcase.data.Movie
import io.github.sh3lan93.mobileautomator.showcase.data.SearchPage
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbCall
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

    /** A client whose popular list answers [popular] and whose discover call answers [discover]. */
    private fun fake(
        popular: TmdbResult<List<Movie>>,
        discover: TmdbResult<SearchPage> = TmdbResult.Ok(SearchPage(emptyList(), 0)),
    ) = FakeTmdbClient(onPopularMovies = { popular }, onDiscoverMovies = { discover })

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
        val vm = PopularViewModel(fake(TmdbResult.Ok(listOf(movie))))
        assertEquals(PopularUiState.Loading, vm.state.value)
        advanceUntilIdle()
        assertEquals(PopularUiState.Loaded(listOf(movie), count = 1), vm.state.value)
    }

    @Test
    fun emptyResult_isEmpty() = runTest(dispatcher) {
        val vm = PopularViewModel(fake(TmdbResult.Ok(emptyList())))
        advanceUntilIdle()
        assertEquals(PopularUiState.Empty, vm.state.value)
    }

    @Test
    fun failure_isFailedWithThatFailure() = runTest(dispatcher) {
        for (failure in TmdbFailure.entries) {
            val vm = PopularViewModel(fake(TmdbResult.Failed(failure)))
            advanceUntilIdle()
            assertEquals(PopularUiState.Failed(failure), vm.state.value, "for $failure")
        }
    }

    @Test
    fun retry_afterFailure_loadsAgain() = runTest(dispatcher) {
        val client = fake(TmdbResult.Failed(TmdbFailure.NoConnection))
        val vm = PopularViewModel(client)
        advanceUntilIdle()
        assertEquals(PopularUiState.Failed(TmdbFailure.NoConnection), vm.state.value)

        client.onPopularMovies = { TmdbResult.Ok(listOf(movie)) }
        vm.retry()
        assertEquals(PopularUiState.Loading, vm.state.value)
        advanceUntilIdle()
        assertEquals(PopularUiState.Loaded(listOf(movie), count = 1), vm.state.value)
    }

    @Test
    fun default_usesPopular_notDiscover() = runTest(dispatcher) {
        val client = fake(TmdbResult.Ok(listOf(movie)))
        val vm = PopularViewModel(client)
        advanceUntilIdle()
        assertEquals(FilterState(), vm.filters.value)
        assertEquals(listOf<TmdbCall>(TmdbCall.Popular), client.calls)
        assertEquals(PopularUiState.Loaded(listOf(movie), count = 1), vm.state.value)
    }

    @Test
    fun setFilters_loadsDiscoverWithThatQuery() = runTest(dispatcher) {
        val client = fake(TmdbResult.Ok(listOf(movie)))
        val vm = PopularViewModel(client)
        advanceUntilIdle()

        client.onDiscoverMovies = { TmdbResult.Ok(SearchPage(listOf(shawshank), 1)) }
        vm.setFilters(drama1994)
        assertEquals(drama1994, vm.filters.value)
        assertEquals(PopularUiState.Loading, vm.state.value)
        advanceUntilIdle()
        assertEquals(listOf<TmdbCall>(TmdbCall.Popular, TmdbCall.Discover(drama1994.toDiscoverQuery())), client.calls)
        assertEquals(PopularUiState.Loaded(listOf(shawshank), count = 1), vm.state.value)
    }

    @Test
    fun discoverCount_isTotalResults() = runTest(dispatcher) {
        val client = fake(TmdbResult.Ok(listOf(movie)))
        client.onDiscoverMovies = { TmdbResult.Ok(SearchPage(listOf(shawshank, movie), 312)) }
        val vm = PopularViewModel(client)
        vm.setFilters(drama1994)
        advanceUntilIdle()
        assertEquals(PopularUiState.Loaded(listOf(shawshank, movie), count = 312), vm.state.value)
    }

    @Test
    fun emptyDiscover_isNoMatches() = runTest(dispatcher) {
        val client = fake(TmdbResult.Ok(listOf(movie)))
        client.onDiscoverMovies = { TmdbResult.Ok(SearchPage(emptyList(), 0)) }
        val vm = PopularViewModel(client)
        vm.setFilters(rated9)
        advanceUntilIdle()
        assertEquals(PopularUiState.NoMatches, vm.state.value)
    }

    @Test
    fun backToDefault_usesPopularAgain() = runTest(dispatcher) {
        val client = fake(TmdbResult.Ok(listOf(movie)))
        client.onDiscoverMovies = { TmdbResult.Ok(SearchPage(listOf(shawshank), 1)) }
        val vm = PopularViewModel(client)
        advanceUntilIdle()
        vm.setFilters(drama1994)
        advanceUntilIdle()

        vm.setFilters(FilterState())
        advanceUntilIdle()
        assertEquals(
            listOf<TmdbCall>(TmdbCall.Popular, TmdbCall.Discover(drama1994.toDiscoverQuery()), TmdbCall.Popular),
            client.calls,
        )
        assertEquals(PopularUiState.Loaded(listOf(movie), count = 1), vm.state.value)
    }

    @Test
    fun lastChangeWins() = runTest(dispatcher) {
        val slow = CompletableDeferred<Unit>()
        val responses = mapOf(
            drama1994.toDiscoverQuery() to TmdbResult.Ok(SearchPage(listOf(shawshank), 1)),
            rated9.toDiscoverQuery() to TmdbResult.Ok(SearchPage(listOf(movie), 40)),
        )
        val client = fake(TmdbResult.Ok(listOf(movie)))
        client.onDiscoverMovies = { query ->
            if (query == drama1994.toDiscoverQuery()) slow.await()
            responses.getValue(query)
        }
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
        val client = fake(TmdbResult.Ok(listOf(movie)))
        val vm = PopularViewModel(client)
        advanceUntilIdle()
        vm.setFilters(FilterState())
        vm.setFilters(drama1994)
        advanceUntilIdle()
        vm.setFilters(drama1994.copy())
        advanceUntilIdle()
        assertEquals(listOf<TmdbCall>(TmdbCall.Popular, TmdbCall.Discover(drama1994.toDiscoverQuery())), client.calls)
    }

    @Test
    fun retry_reloadsCurrentFilters() = runTest(dispatcher) {
        val client = fake(TmdbResult.Ok(listOf(movie)))
        client.onDiscoverMovies = { TmdbResult.Failed(TmdbFailure.NoConnection) }
        val vm = PopularViewModel(client)
        vm.setFilters(drama1994)
        advanceUntilIdle()
        assertEquals(PopularUiState.Failed(TmdbFailure.NoConnection), vm.state.value)

        client.onDiscoverMovies = { TmdbResult.Ok(SearchPage(listOf(shawshank), 1)) }
        vm.retry()
        assertEquals(PopularUiState.Loading, vm.state.value)
        advanceUntilIdle()
        assertEquals(TmdbCall.Discover(drama1994.toDiscoverQuery()), client.calls.last())
        assertEquals(PopularUiState.Loaded(listOf(shawshank), count = 1), vm.state.value)
    }

    @Test
    fun discoverFailure_isFailed() = runTest(dispatcher) {
        for (failure in TmdbFailure.entries) {
            val client = fake(TmdbResult.Ok(listOf(movie)))
            client.onDiscoverMovies = { TmdbResult.Failed(failure) }
            val vm = PopularViewModel(client)
            vm.setFilters(rated9)
            advanceUntilIdle()
            assertEquals(PopularUiState.Failed(failure), vm.state.value, "for $failure")
        }
    }
}
