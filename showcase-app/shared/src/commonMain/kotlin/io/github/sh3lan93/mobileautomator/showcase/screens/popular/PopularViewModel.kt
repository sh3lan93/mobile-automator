package io.github.sh3lan93.mobileautomator.showcase.screens.popular

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.sh3lan93.mobileautomator.showcase.data.FilterState
import io.github.sh3lan93.mobileautomator.showcase.data.Movie
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbClient
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbFailure
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbResult
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface PopularUiState {
    data object Loading : PopularUiState
    /**
     * [count] is the count line's number: the films listed for the popular list (one page),
     * TMDB's total of every match for a discover call.
     */
    data class Loaded(val movies: List<Movie>, val count: Int = movies.size) : PopularUiState
    /** The popular list came back empty. */
    data object Empty : PopularUiState
    /** A discover call (any non-default filters) came back empty. */
    data object NoMatches : PopularUiState
    data class Failed(val failure: TmdbFailure) : PopularUiState
}

/**
 * Holds the film list and the [filters] it is shown with. Starts [PopularUiState.Loading] and
 * loads on creation. The default filters load TMDB's popular list; any other filters load a
 * discover call. Each change cancels the in-flight load, so only the latest filters' response
 * is ever shown. Cancellation (leaving the screen) propagates out of the client and is never
 * turned into a failure.
 */
class PopularViewModel(private val client: TmdbClient) : ViewModel() {

    private val _state = MutableStateFlow<PopularUiState>(PopularUiState.Loading)
    val state: StateFlow<PopularUiState> = _state.asStateFlow()

    private val _filters = MutableStateFlow(FilterState())
    val filters: StateFlow<FilterState> = _filters.asStateFlow()

    private var loadJob: Job? = null

    init {
        load()
    }

    /** Shows the list for [state]; does nothing when it equals the current filters. */
    fun setFilters(state: FilterState) {
        if (state == _filters.value) return
        _filters.value = state
        load()
    }

    /** Loads the current filters again. */
    fun retry() = load()

    private fun load() {
        loadJob?.cancel()
        val filters = _filters.value
        _state.value = PopularUiState.Loading
        loadJob = viewModelScope.launch {
            _state.value = if (filters.isDefault) loadPopular() else loadDiscover(filters)
        }
    }

    private suspend fun loadPopular(): PopularUiState = when (val result = client.popularMovies()) {
        is TmdbResult.Ok ->
            if (result.value.isEmpty()) PopularUiState.Empty else PopularUiState.Loaded(result.value)
        is TmdbResult.Failed -> PopularUiState.Failed(result.failure)
    }

    private suspend fun loadDiscover(filters: FilterState): PopularUiState =
        when (val result = client.discoverMovies(filters.toDiscoverQuery())) {
            is TmdbResult.Ok ->
                if (result.value.movies.isEmpty()) PopularUiState.NoMatches
                else PopularUiState.Loaded(result.value.movies, result.value.totalResults)
            is TmdbResult.Failed -> PopularUiState.Failed(result.failure)
        }
}
