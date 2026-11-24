package io.github.sh3lan93.mobileautomator.showcase.screens.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.sh3lan93.mobileautomator.showcase.data.Movie
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbClient
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbFailure
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbResult
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** How long typing must pause before a search is sent. */
const val SEARCH_DEBOUNCE_MS = 400L

sealed interface SearchUiState {
    /** The field is blank: nothing searched. */
    data object Idle : SearchUiState
    data object Searching : SearchUiState
    /** [totalResults] is TMDB's count of every match, not the size of [movies]. */
    data class Results(val movies: List<Movie>, val totalResults: Int) : SearchUiState
    data object NoMatches : SearchUiState
    data class Failed(val failure: TmdbFailure) : SearchUiState
}

/**
 * Searches as the user types, with no submit key. Each change cancels the pending or in-flight
 * search, so only the latest query's response is ever shown. Blank text is [SearchUiState.Idle].
 */
class SearchViewModel(private val client: TmdbClient) : ViewModel() {

    private val _query = MutableStateFlow("")
    /** The field's text as typed; searches use it trimmed. */
    val query: StateFlow<String> = _query.asStateFlow()

    private val _state = MutableStateFlow<SearchUiState>(SearchUiState.Idle)
    val state: StateFlow<SearchUiState> = _state.asStateFlow()

    private var searchJob: Job? = null

    fun onQueryChange(text: String) {
        val unchanged = text.trim() == _query.value.trim()
        _query.value = text
        // Spaces added around the same title send no new request.
        if (!unchanged) search(afterMs = SEARCH_DEBOUNCE_MS)
    }

    /** Searches the current query again, now. */
    fun retry() = search(afterMs = 0)

    private fun search(afterMs: Long) {
        searchJob?.cancel()
        val query = _query.value.trim()
        if (query.isEmpty()) {
            _state.value = SearchUiState.Idle
            return
        }
        searchJob = viewModelScope.launch {
            delay(afterMs)
            _state.value = SearchUiState.Searching
            _state.value = when (val result = client.searchMovies(query)) {
                is TmdbResult.Ok ->
                    if (result.value.movies.isEmpty()) SearchUiState.NoMatches
                    else SearchUiState.Results(result.value.movies, result.value.totalResults)
                is TmdbResult.Failed -> SearchUiState.Failed(result.failure)
            }
        }
    }
}
