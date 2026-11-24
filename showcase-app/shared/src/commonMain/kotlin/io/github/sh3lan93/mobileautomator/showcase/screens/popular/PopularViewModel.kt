package io.github.sh3lan93.mobileautomator.showcase.screens.popular

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
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
    data class Loaded(val movies: List<Movie>) : PopularUiState
    data object Empty : PopularUiState
    data class Failed(val failure: TmdbFailure) : PopularUiState
}

/**
 * Holds the popular films list. Starts [PopularUiState.Loading] and loads on creation.
 * Cancellation (leaving the screen) propagates out of the client and is never turned into a failure.
 */
class PopularViewModel(private val client: TmdbClient) : ViewModel() {

    private val _state = MutableStateFlow<PopularUiState>(PopularUiState.Loading)
    val state: StateFlow<PopularUiState> = _state.asStateFlow()

    private var loadJob: Job? = null

    init {
        load()
    }

    fun retry() = load()

    private fun load() {
        loadJob?.cancel()
        _state.value = PopularUiState.Loading
        loadJob = viewModelScope.launch {
            _state.value = when (val result = client.popularMovies()) {
                is TmdbResult.Ok ->
                    if (result.value.isEmpty()) PopularUiState.Empty else PopularUiState.Loaded(result.value)
                is TmdbResult.Failed -> PopularUiState.Failed(result.failure)
            }
        }
    }
}
