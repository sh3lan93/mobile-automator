package io.github.sh3lan93.mobileautomator.showcase.screens.filters

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.sh3lan93.mobileautomator.showcase.data.Genre
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbClient
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbFailure
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbResult
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface GenresUiState {
    data object Loading : GenresUiState
    /** TMDB's genres, in TMDB's order. */
    data class Loaded(val genres: List<Genre>) : GenresUiState
    data class Failed(val failure: TmdbFailure) : GenresUiState
}

/**
 * The Filters screen's own state: TMDB's genre list, loaded on creation. The filters themselves
 * live on the list's view model. [currentYear] bounds the release-year choices.
 */
class FiltersViewModel(private val client: TmdbClient, val currentYear: Int) : ViewModel() {

    private val _genres = MutableStateFlow<GenresUiState>(GenresUiState.Loading)
    val genres: StateFlow<GenresUiState> = _genres.asStateFlow()

    private var loadJob: Job? = null

    init {
        load()
    }

    fun retry() = load()

    private fun load() {
        loadJob?.cancel()
        _genres.value = GenresUiState.Loading
        loadJob = viewModelScope.launch {
            _genres.value = when (val result = client.movieGenres()) {
                is TmdbResult.Ok -> GenresUiState.Loaded(result.value)
                is TmdbResult.Failed -> GenresUiState.Failed(result.failure)
            }
        }
    }
}
