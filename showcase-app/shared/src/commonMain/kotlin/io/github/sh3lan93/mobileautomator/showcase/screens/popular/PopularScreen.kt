package io.github.sh3lan93.mobileautomator.showcase.screens.popular

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.sh3lan93.mobileautomator.showcase.screens.common.Centered
import io.github.sh3lan93.mobileautomator.showcase.screens.common.FailureContent
import io.github.sh3lan93.mobileautomator.showcase.screens.common.MovieList
import io.github.sh3lan93.mobileautomator.showcase.screens.common.filmCount
import org.koin.compose.viewmodel.koinViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PopularScreen(
    onSearch: () -> Unit,
    onSettings: () -> Unit,
    onAbout: () -> Unit,
    onOpen: (Int) -> Unit,
    onRatings: () -> Unit,
    onFilters: () -> Unit,
    viewModel: PopularViewModel = koinViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val filters by viewModel.filters.collectAsStateWithLifecycle()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Popular films") },
                actions = {
                    TextButton(onClick = onSearch) { Text("Search") }
                    // Reloads the list, so a scenario can trigger a load right after turning a switch on.
                    IconButton(onClick = viewModel::retry) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                    IconButton(onClick = onRatings) {
                        Icon(Icons.Default.Star, contentDescription = "My ratings")
                    }
                    TextButton(onClick = onSettings) { Text("Settings") }
                    TextButton(onClick = onAbout) { Text("About") }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            FilterRow(filters.activeFiltersText(), onFilters)
            val modifier = Modifier.fillMaxSize()
            when (val s = state) {
                PopularUiState.Loading -> Centered(modifier) {
                    CircularProgressIndicator()
                    Text("Loading films…")
                }
                PopularUiState.Empty -> Centered(modifier) { Text("No films found") }
                PopularUiState.NoMatches -> Centered(modifier) { Text("No films match this combination") }
                // The films listed for the popular list (one page); TMDB's total for a discover call.
                is PopularUiState.Loaded -> MovieList(s.movies, filmCount(s.count), onOpen, modifier)
                is PopularUiState.Failed -> FailureContent(s.failure, viewModel::retry, modifier)
            }
        }
    }
}

/** Shown above the list in every state: the active filters as text, and the way to change them. */
@Composable
private fun FilterRow(activeFilters: String, onFilters: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(activeFilters, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        TextButton(onClick = onFilters) { Text("Filters") }
    }
}
