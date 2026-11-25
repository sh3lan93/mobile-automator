package io.github.sh3lan93.mobileautomator.showcase.screens.details

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.sh3lan93.mobileautomator.showcase.data.Movie
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf

/**
 * The membership line and the one button that changes it, under a film's details. The two lines
 * never contain each other, so either is a unique target. While the view model is confirming a
 * removal (the watchlist removal flag is on), a dialog asks first.
 */
@Composable
fun WatchlistSection(
    movie: Movie,
    viewModel: WatchlistSectionViewModel = koinViewModel(key = "watchlist-${movie.id}") { parametersOf(movie) },
) {
    val saved by viewModel.saved.collectAsStateWithLifecycle()
    val confirming by viewModel.confirming.collectAsStateWithLifecycle()
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            if (saved) "In your watchlist" else "Not saved to your watchlist",
            style = MaterialTheme.typography.titleMedium,
        )
        if (saved) {
            OutlinedButton(onClick = viewModel::requestRemove) { Text("Remove from watchlist") }
        } else {
            Button(onClick = viewModel::add) { Text("Add to watchlist") }
        }
    }
    if (confirming) {
        AlertDialog(
            onDismissRequest = viewModel::keep,
            text = { Text("Remove ${movie.title} from your watchlist?") },
            confirmButton = { TextButton(onClick = viewModel::confirmRemove) { Text("Yes, remove") } },
            dismissButton = { TextButton(onClick = viewModel::keep) { Text("Keep it") } },
        )
    }
}
