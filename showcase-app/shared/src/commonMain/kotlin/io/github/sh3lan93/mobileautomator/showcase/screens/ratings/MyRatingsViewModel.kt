package io.github.sh3lan93.mobileautomator.showcase.screens.ratings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.sh3lan93.mobileautomator.showcase.data.GuestRatings
import io.github.sh3lan93.mobileautomator.showcase.data.RatedMovie
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbFailure
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbResult
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface MyRatingsUiState {
    data object Loading : MyRatingsUiState
    data object Empty : MyRatingsUiState
    data class Loaded(val films: List<RatedMovie>) : MyRatingsUiState
    data class Failed(val failure: TmdbFailure) : MyRatingsUiState
}

/**
 * The films the guest rated, read back from TMDB. Nothing loads on creation: the screen calls
 * [refresh] each time it resumes (the first time included), so coming back from Details re-reads.
 */
class MyRatingsViewModel(private val ratings: GuestRatings) : ViewModel() {

    private val _state = MutableStateFlow<MyRatingsUiState>(MyRatingsUiState.Loading)
    val state: StateFlow<MyRatingsUiState> = _state.asStateFlow()

    private var loadJob: Job? = null

    fun refresh() {
        loadJob?.cancel()
        _state.value = MyRatingsUiState.Loading
        loadJob = viewModelScope.launch {
            _state.value = when (val result = ratings.rated()) {
                is TmdbResult.Ok -> if (result.value.isEmpty()) MyRatingsUiState.Empty else MyRatingsUiState.Loaded(result.value)
                is TmdbResult.Failed -> MyRatingsUiState.Failed(result.failure)
            }
        }
    }
}
