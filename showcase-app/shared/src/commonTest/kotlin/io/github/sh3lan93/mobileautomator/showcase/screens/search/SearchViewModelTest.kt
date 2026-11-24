package io.github.sh3lan93.mobileautomator.showcase.screens.search

import io.github.sh3lan93.mobileautomator.showcase.data.Movie
import io.github.sh3lan93.mobileautomator.showcase.data.SearchPage
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbClient
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbFailure
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbResult
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
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
class SearchViewModelTest {

    /** Records every query. A query with a gate suspends until the test completes it. */
    private class FakeTmdbClient : TmdbClient {
        val queries = mutableListOf<String>()
        val responses = mutableMapOf<String, TmdbResult<SearchPage>>()
        val gates = mutableMapOf<String, CompletableDeferred<Unit>>()
        var next: TmdbResult<SearchPage> = TmdbResult.Ok(SearchPage(emptyList(), 0))

        override suspend fun searchMovies(query: String): TmdbResult<SearchPage> {
            queries += query
            gates[query]?.await()
            return responses[query] ?: next
        }

        override suspend fun popularMovies() = error("not used")
        override suspend fun movieDetails(id: Int) = error("not used")
    }

    private val dispatcher = StandardTestDispatcher()
    private val shawshank = Movie(278, "The Shawshank Redemption", "1994", null)
    private val matrix = Movie(603, "The Matrix", "1999", null)
    private val shawshankPage = TmdbResult.Ok(SearchPage(listOf(shawshank), 3))
    private val matrixPage = TmdbResult.Ok(SearchPage(listOf(matrix), 9))

    @BeforeTest
    fun setUp() = Dispatchers.setMain(dispatcher)

    @AfterTest
    fun tearDown() = Dispatchers.resetMain()

    /** Lets the debounce window elapse and runs whatever it released. */
    private fun TestScope.passDebounce() {
        advanceTimeBy(SEARCH_DEBOUNCE_MS)
        runCurrent()
    }

    @Test
    fun startsIdle_noRequest() = runTest(dispatcher) {
        val client = FakeTmdbClient()
        val vm = SearchViewModel(client)
        advanceUntilIdle()
        assertEquals(SearchUiState.Idle, vm.state.value)
        assertEquals("", vm.query.value)
        assertEquals(emptyList(), client.queries)
    }

    @Test
    fun typing_searchesAfterDebounce() = runTest(dispatcher) {
        val client = FakeTmdbClient().apply {
            responses["Shawshank"] = shawshankPage
            gates["Shawshank"] = CompletableDeferred()
        }
        val vm = SearchViewModel(client)
        vm.onQueryChange("Shawshank")
        assertEquals("Shawshank", vm.query.value)

        advanceTimeBy(SEARCH_DEBOUNCE_MS - 1)
        runCurrent()
        assertEquals(emptyList(), client.queries)

        advanceTimeBy(1)
        runCurrent()
        assertEquals(listOf("Shawshank"), client.queries)
        assertEquals(SearchUiState.Searching, vm.state.value)

        client.gates.getValue("Shawshank").complete(Unit)
        advanceUntilIdle()
        assertEquals(SearchUiState.Results(listOf(shawshank), 3), vm.state.value)
    }

    @Test
    fun fastTyping_searchesOnlyTheLastQuery() = runTest(dispatcher) {
        val client = FakeTmdbClient().apply { responses["Shawshank"] = shawshankPage }
        val vm = SearchViewModel(client)
        vm.onQueryChange("S")
        advanceTimeBy(100)
        vm.onQueryChange("Sh")
        advanceTimeBy(100)
        vm.onQueryChange("Shawshank")
        advanceUntilIdle()
        assertEquals(listOf("Shawshank"), client.queries)
        assertEquals(SearchUiState.Results(listOf(shawshank), 3), vm.state.value)
    }

    @Test
    fun slowEarlierResponse_doesNotOverwriteLaterQuery() = runTest(dispatcher) {
        val slowMatrix = CompletableDeferred<Unit>()
        val client = FakeTmdbClient().apply {
            responses["Matrix"] = matrixPage
            responses["Shawshank"] = shawshankPage
            gates["Matrix"] = slowMatrix
        }
        val vm = SearchViewModel(client)
        vm.onQueryChange("Matrix")
        passDebounce()
        assertEquals(listOf("Matrix"), client.queries) // in flight, suspended

        vm.onQueryChange("Shawshank")
        passDebounce()
        advanceUntilIdle()
        assertEquals(listOf("Matrix", "Shawshank"), client.queries)
        assertEquals(SearchUiState.Results(listOf(shawshank), 3), vm.state.value)

        slowMatrix.complete(Unit) // the earlier response arrives late
        advanceUntilIdle()
        assertEquals(SearchUiState.Results(listOf(shawshank), 3), vm.state.value)
    }

    @Test
    fun blankOrSpacesQuery_isIdle_noRequest() = runTest(dispatcher) {
        val client = FakeTmdbClient().apply { responses["Shawshank"] = shawshankPage }
        val vm = SearchViewModel(client)
        for (text in listOf("", "   ")) {
            vm.onQueryChange(text)
            advanceUntilIdle()
            assertEquals(SearchUiState.Idle, vm.state.value, "for '$text'")
        }
        assertEquals(emptyList(), client.queries)

        // After results were shown, clearing the field drops them at once.
        vm.onQueryChange("Shawshank")
        advanceUntilIdle()
        assertEquals(SearchUiState.Results(listOf(shawshank), 3), vm.state.value)
        vm.onQueryChange("  ")
        assertEquals(SearchUiState.Idle, vm.state.value)
        advanceUntilIdle()
        assertEquals(SearchUiState.Idle, vm.state.value)
        assertEquals(listOf("Shawshank"), client.queries)
    }

    @Test
    fun clearingDuringPendingOrInFlightSearch_staysIdle() = runTest(dispatcher) {
        val inFlight = CompletableDeferred<Unit>()
        val client = FakeTmdbClient().apply {
            responses["Shawshank"] = shawshankPage
            gates["Shawshank"] = inFlight
        }
        val vm = SearchViewModel(client)

        vm.onQueryChange("Shaw") // cleared before the debounce fires
        advanceTimeBy(100)
        vm.onQueryChange("")
        advanceUntilIdle()
        assertEquals(emptyList(), client.queries)

        vm.onQueryChange("Shawshank") // cleared while the request is out
        passDebounce()
        assertEquals(listOf("Shawshank"), client.queries)
        vm.onQueryChange("")
        inFlight.complete(Unit)
        advanceUntilIdle()
        assertEquals(SearchUiState.Idle, vm.state.value)
    }

    @Test
    fun queryIsTrimmed() = runTest(dispatcher) {
        val client = FakeTmdbClient().apply { responses["Shawshank"] = shawshankPage }
        val vm = SearchViewModel(client)
        vm.onQueryChange("  Shawshank  ")
        advanceUntilIdle()
        assertEquals("  Shawshank  ", vm.query.value) // the field keeps what was typed
        assertEquals(listOf("Shawshank"), client.queries)
        assertEquals(SearchUiState.Results(listOf(shawshank), 3), vm.state.value)
    }

    @Test
    fun emptyResult_isNoMatches() = runTest(dispatcher) {
        val client = FakeTmdbClient().apply { next = TmdbResult.Ok(SearchPage(emptyList(), 4)) }
        val vm = SearchViewModel(client)
        vm.onQueryChange("xqzvbnmkw")
        advanceUntilIdle()
        assertEquals(SearchUiState.NoMatches, vm.state.value)
    }

    @Test
    fun failure_isFailed() = runTest(dispatcher) {
        for (failure in TmdbFailure.entries) {
            val client = FakeTmdbClient().apply { next = TmdbResult.Failed(failure) }
            val vm = SearchViewModel(client)
            vm.onQueryChange("Shawshank")
            advanceUntilIdle()
            assertEquals(SearchUiState.Failed(failure), vm.state.value, "for $failure")
        }
    }

    @Test
    fun retry_rerunsCurrentQuery() = runTest(dispatcher) {
        val client = FakeTmdbClient().apply { next = TmdbResult.Failed(TmdbFailure.NoConnection) }
        val vm = SearchViewModel(client)
        vm.onQueryChange(" Shawshank ")
        advanceUntilIdle()
        assertEquals(SearchUiState.Failed(TmdbFailure.NoConnection), vm.state.value)

        client.next = shawshankPage
        vm.retry()
        runCurrent() // now: no debounce on retry
        assertEquals(listOf("Shawshank", "Shawshank"), client.queries)
        assertEquals(SearchUiState.Results(listOf(shawshank), 3), vm.state.value)
    }
}
