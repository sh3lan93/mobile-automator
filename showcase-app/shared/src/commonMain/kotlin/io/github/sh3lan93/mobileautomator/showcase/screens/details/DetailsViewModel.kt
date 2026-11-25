package io.github.sh3lan93.mobileautomator.showcase.screens.details

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.sh3lan93.mobileautomator.showcase.data.MovieDetails
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbClient
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbFailure
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbResult
import io.github.sh3lan93.mobileautomator.showcase.store.LocalStore
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface DetailsUiState {
    data object Loading : DetailsUiState
    data class Loaded(val details: MovieDetails) : DetailsUiState
    data class Failed(val failure: TmdbFailure) : DetailsUiState
}

/**
 * Holds one film's details. Starts [DetailsUiState.Loading] and loads [movieId] on creation.
 * A film TMDB no longer has (404) arrives as [TmdbFailure.ServerError], so it shows with Retry.
 */
class DetailsViewModel(private val movieId: Int, private val client: TmdbClient, store: LocalStore) : ViewModel() {

    /** The details layout flag, read from the store: `true` shows the compact layout, `false` the classic one. */
    val compactLayout: StateFlow<Boolean> = store.compactDetails.value

    private val _state = MutableStateFlow<DetailsUiState>(DetailsUiState.Loading)
    val state: StateFlow<DetailsUiState> = _state.asStateFlow()

    private var loadJob: Job? = null

    init {
        load()
    }

    fun retry() = load()

    private fun load() {
        loadJob?.cancel()
        _state.value = DetailsUiState.Loading
        loadJob = viewModelScope.launch {
            _state.value = when (val result = client.movieDetails(movieId)) {
                is TmdbResult.Ok -> DetailsUiState.Loaded(result.value)
                is TmdbResult.Failed -> DetailsUiState.Failed(result.failure)
            }
        }
    }
}
