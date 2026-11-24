package io.github.sh3lan93.mobileautomator.showcase.screens.search

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.sh3lan93.mobileautomator.showcase.screens.common.Centered
import io.github.sh3lan93.mobileautomator.showcase.screens.common.FailureContent
import io.github.sh3lan93.mobileautomator.showcase.screens.common.MovieList
import io.github.sh3lan93.mobileautomator.showcase.screens.common.filmCount
import org.koin.compose.viewmodel.koinViewModel

/** Searches as the user types; a result row opens the film by id. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchScreen(onBack: () -> Unit, onOpen: (Int) -> Unit, viewModel: SearchViewModel = koinViewModel()) {
    val query by viewModel.query.collectAsStateWithLifecycle()
    val state by viewModel.state.collectAsStateWithLifecycle()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Search") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            OutlinedTextField(
                value = query,
                onValueChange = viewModel::onQueryChange,
                label = { Text("Search films") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            )
            val modifier = Modifier.fillMaxSize()
            when (val s = state) {
                SearchUiState.Idle -> Centered(modifier) { Text("Type a film title to search") }
                SearchUiState.Searching -> Centered(modifier) {
                    CircularProgressIndicator()
                    Text("Searching…")
                }
                // The search count is TMDB's total of every match, not the page listed.
                is SearchUiState.Results -> MovieList(s.movies, filmCount(s.totalResults), onOpen, modifier)
                SearchUiState.NoMatches -> Centered(modifier) { Text("No films match your search") }
                is SearchUiState.Failed -> FailureContent(s.failure, viewModel::retry, modifier)
            }
        }
    }
}
