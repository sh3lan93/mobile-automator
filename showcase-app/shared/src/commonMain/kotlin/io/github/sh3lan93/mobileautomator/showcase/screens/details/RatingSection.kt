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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbFailure
import io.github.sh3lan93.mobileautomator.showcase.screens.common.ratingText
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf

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
