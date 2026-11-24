package io.github.sh3lan93.mobileautomator.showcase.screens.details

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import io.github.sh3lan93.mobileautomator.showcase.data.GuestRatings
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbFailure
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbResult
import io.github.sh3lan93.mobileautomator.showcase.data.ratingText
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf

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

    private inline fun <T, R> TmdbResult<T>.map(transform: (T) -> R): TmdbResult<R> = when (this) {
        is TmdbResult.Ok -> TmdbResult.Ok(transform(value))
        is TmdbResult.Failed -> this
    }
}

/** The rating status line, ten score buttons and (when rated) Remove rating, under a film's details. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RatingSection(
    movieId: Int,
    viewModel: RatingViewModel = koinViewModel(key = "rating-$movieId") { parametersOf(movieId) },
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val rating = state.rating
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            if (state.saving) "Saving your rating…"
            else when (rating) {
                null -> "Checking your rating…"
                KnownRating.NotRated -> "You have not rated this film"
                is KnownRating.Rated -> ratingText(rating.value)
            },
            style = MaterialTheme.typography.titleMedium,
        )
        state.failure?.let { failure ->
            Text(
                if (failure == TmdbFailure.NoConnection) "Could not reach TMDB. Try again."
                else "Could not update your rating. Try again.",
                color = MaterialTheme.colorScheme.error,
            )
            if (state.firstCheckFailed) Button(onClick = viewModel::retry) { Text("Retry") }
        }
        if (rating != null) {
            val enabled = !state.saving
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                for (score in 1..10) ScoreButton(score, enabled) { viewModel.rate(score) }
            }
            if (rating is KnownRating.Rated) {
                OutlinedButton(onClick = viewModel::remove, enabled = enabled) { Text("Remove rating") }
            }
        }
    }
}

/**
 * Shows the bare digit but exposes only `Rate <n> out of 10`, so the digit is never an element of
 * its own and `Rate 1 out of 10` is the one target for score 1.
 */
@Composable
private fun ScoreButton(score: Int, enabled: Boolean, onClick: () -> Unit) {
    val label = "Rate $score out of 10"
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        contentPadding = PaddingValues(0.dp),
        modifier = Modifier.size(width = 56.dp, height = 40.dp).clearAndSetSemantics {
            contentDescription = label
            role = Role.Button
            if (enabled) onClick(label) { onClick(); true } else disabled()
        },
    ) { Text("$score") }
}
