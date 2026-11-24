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

sealed interface RatingUiState {
    data object Checking : RatingUiState
    data object NotRated : RatingUiState
    data class Rated(val value: Double) : RatingUiState
    data object Saving : RatingUiState

    /**
     * A check or write failed. [last] is what stays on screen: the last known [Rated] / [NotRated]
     * after a failed write, or [Checking] when the first check failed (nothing is known yet).
     */
    data class Failed(val failure: TmdbFailure, val last: RatingUiState) : RatingUiState
}

/**
 * The guest's rating of one film. Checks [movieId]'s rating on creation; [rate] and [remove]
 * show [RatingUiState.Saving] until TMDB confirms the write, and taps while saving are ignored.
 */
class RatingViewModel(private val movieId: Int, private val ratings: GuestRatings) : ViewModel() {

    private val _state = MutableStateFlow<RatingUiState>(RatingUiState.Checking)
    val state: StateFlow<RatingUiState> = _state.asStateFlow()

    // The last settled answer (Rated / NotRated, or Checking before the first), kept through a failed write.
    private var settled: RatingUiState = RatingUiState.Checking

    init {
        check()
    }

    fun rate(value: Int) = write { ratings.rate(movieId, value.toDouble()).map { RatingUiState.Rated(value.toDouble()) } }

    fun remove() = write { ratings.remove(movieId).map { RatingUiState.NotRated } }

    fun retry() {
        if (_state.value.let { it is RatingUiState.Failed && it.last == RatingUiState.Checking }) check()
    }

    private fun check() {
        _state.value = RatingUiState.Checking
        viewModelScope.launch {
            settle(ratings.ratingFor(movieId).map { it?.let(RatingUiState::Rated) ?: RatingUiState.NotRated })
        }
    }

    private fun write(block: suspend () -> TmdbResult<RatingUiState>) {
        // Only from a settled answer: never while saving (double taps) or before the first check.
        val current = _state.value
        if (current is RatingUiState.Saving || current is RatingUiState.Checking) return
        if (current is RatingUiState.Failed && current.last == RatingUiState.Checking) return
        _state.value = RatingUiState.Saving
        viewModelScope.launch { settle(block()) }
    }

    private fun settle(result: TmdbResult<RatingUiState>) {
        _state.value = when (result) {
            is TmdbResult.Ok -> result.value.also { settled = it }
            is TmdbResult.Failed -> RatingUiState.Failed(result.failure, settled)
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
    val shown = (state as? RatingUiState.Failed)?.last ?: state
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            when (shown) {
                RatingUiState.Checking -> "Checking your rating…"
                RatingUiState.NotRated -> "You have not rated this film"
                is RatingUiState.Rated -> ratingText(shown.value)
                RatingUiState.Saving -> "Saving your rating…"
                is RatingUiState.Failed -> ""
            },
            style = MaterialTheme.typography.titleMedium,
        )
        (state as? RatingUiState.Failed)?.let { failed ->
            Text(
                if (failed.failure == TmdbFailure.NoConnection) "Could not reach TMDB. Try again."
                else "Could not update your rating. Try again.",
                color = MaterialTheme.colorScheme.error,
            )
            if (failed.last == RatingUiState.Checking) Button(onClick = viewModel::retry) { Text("Retry") }
        }
        if (shown != RatingUiState.Checking) {
            val enabled = shown != RatingUiState.Saving
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                for (score in 1..10) ScoreButton(score, enabled) { viewModel.rate(score) }
            }
            if (shown is RatingUiState.Rated) {
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
