package io.github.sh3lan93.mobileautomator.showcase.screens.details

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.sh3lan93.mobileautomator.showcase.data.Movie
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf

/**
 * The membership line and the one button that changes it, under a film's details. The two lines
 * never contain each other, so either is a unique target.
 */
@Composable
fun WatchlistSection(
    movie: Movie,
    viewModel: WatchlistSectionViewModel = koinViewModel(key = "watchlist-${movie.id}") { parametersOf(movie) },
) {
    val saved by viewModel.saved.collectAsStateWithLifecycle()
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            if (saved) "In your watchlist" else "Not saved to your watchlist",
            style = MaterialTheme.typography.titleMedium,
        )
        if (saved) {
            OutlinedButton(onClick = viewModel::remove) { Text("Remove from watchlist") }
        } else {
            Button(onClick = viewModel::add) { Text("Add to watchlist") }
        }
    }
}
