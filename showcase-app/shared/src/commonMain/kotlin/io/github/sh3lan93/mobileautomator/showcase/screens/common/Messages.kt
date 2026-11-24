package io.github.sh3lan93.mobileautomator.showcase.screens.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbFailure
import io.github.sh3lan93.mobileautomator.showcase.screens.key.KeyProblemScreen

/** How every screen shows a [TmdbFailure]: key problems get their own screen, the rest a message with Retry. */
@Composable
fun FailureContent(failure: TmdbFailure, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    when (failure) {
        TmdbFailure.MissingKey -> KeyProblemScreen(
            heading = "Add your TMDB key",
            body = "Create showcase-app/tmdb.properties containing TMDB_API_KEY=<your key>, then rebuild the app.",
            modifier = modifier,
        )
        TmdbFailure.RejectedKey -> KeyProblemScreen(
            heading = "TMDB rejected your key",
            body = "Check TMDB_API_KEY in showcase-app/tmdb.properties, then rebuild the app.",
            modifier = modifier,
        )
        TmdbFailure.NoConnection -> Retryable("No connection", onRetry, modifier)
        TmdbFailure.ServerError -> Retryable("Something went wrong", onRetry, modifier)
    }
}

@Composable
fun Retryable(message: String, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    Centered(modifier) {
        Text(message)
        Button(onClick = onRetry) { Text("Retry") }
    }
}

@Composable
fun Centered(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) { content() }
}
