package io.github.sh3lan93.mobileautomator.showcase.screens.popular

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
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
    onAbout: () -> Unit,
    onOpen: (Int) -> Unit,
    viewModel: PopularViewModel = koinViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Popular films") },
                actions = {
                    TextButton(onClick = onSearch) { Text("Search") }
                    TextButton(onClick = onAbout) { Text("About") }
                },
            )
        },
    ) { padding ->
        val modifier = Modifier.fillMaxSize().padding(padding)
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
