package io.github.sh3lan93.mobileautomator.showcase.screens.details

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.sh3lan93.mobileautomator.showcase.data.GuestRatings
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbFailure
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbResult
import io.github.sh3lan93.mobileautomator.showcase.data.map
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** What the guest's rating of a film is known to be. */
sealed interface KnownRating {
    data object NotRated : KnownRating
    data class Rated(val value: Double) : KnownRating
}

/**
 * The rating section's state. [rating] is `null` until the first check answers; [saving] is set
 * while a write is in flight (the known [rating] stays); [failure] is the last check or write that
 * failed, cleared by the next one.
 */
data class RatingUiState(
    val rating: KnownRating?,
    val saving: Boolean = false,
    val failure: TmdbFailure? = null,
) {
    /** The first check failed, so nothing is known and only Retry helps. */
    val firstCheckFailed: Boolean get() = rating == null && failure != null
}

/**
 * The guest's rating of one film. Checks [movieId]'s rating on creation; [rate] and [remove]
 * set [RatingUiState.saving] until TMDB confirms the write, and taps while saving are ignored.
 */
class RatingViewModel(private val movieId: Int, private val ratings: GuestRatings) : ViewModel() {

    private val _state = MutableStateFlow(RatingUiState(rating = null))
    val state: StateFlow<RatingUiState> = _state.asStateFlow()

    init {
        check()
    }

    fun rate(value: Int) = write { ratings.rate(movieId, value.toDouble()).map { KnownRating.Rated(value.toDouble()) } }

    fun remove() = write { ratings.remove(movieId).map { KnownRating.NotRated } }

    fun retry() {
        if (_state.value.firstCheckFailed) check()
    }

    private fun check() {
        _state.value = RatingUiState(rating = null)
        viewModelScope.launch {
            settle(ratings.ratingFor(movieId).map { it?.let(KnownRating::Rated) ?: KnownRating.NotRated })
        }
    }

    private fun write(block: suspend () -> TmdbResult<KnownRating>) {
        // Only from a known rating: never while saving (double taps) or before the first check answers.
        val current = _state.value
        if (current.saving || current.rating == null) return
        _state.value = current.copy(saving = true, failure = null)
        viewModelScope.launch { settle(block()) }
    }

    private fun settle(result: TmdbResult<KnownRating>) {
        _state.value = when (result) {
            is TmdbResult.Ok -> RatingUiState(rating = result.value)
            is TmdbResult.Failed -> _state.value.copy(saving = false, failure = result.failure)
        }
    }
}
