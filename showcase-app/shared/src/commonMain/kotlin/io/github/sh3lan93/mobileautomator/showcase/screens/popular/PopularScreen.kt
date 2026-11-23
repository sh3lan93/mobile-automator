package io.github.sh3lan93.mobileautomator.showcase.screens.popular

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import io.github.sh3lan93.mobileautomator.showcase.data.Movie
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbFailure
import io.github.sh3lan93.mobileautomator.showcase.screens.key.KeyProblemScreen
import org.koin.compose.viewmodel.koinViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PopularScreen(onAbout: () -> Unit, viewModel: PopularViewModel = koinViewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Popular films") },
                actions = { TextButton(onClick = onAbout) { Text("About") } },
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
            is PopularUiState.Loaded -> MovieList(s.movies, modifier)
            is PopularUiState.Failed -> when (s.failure) {
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
                TmdbFailure.NoConnection -> Retryable("No connection", viewModel::retry, modifier)
                TmdbFailure.ServerError -> Retryable("Something went wrong", viewModel::retry, modifier)
            }
        }
    }
}

@Composable
private fun MovieList(movies: List<Movie>, modifier: Modifier) {
    LazyColumn(modifier = modifier) {
        item {
            Text(
                "${movies.size} films",
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
        items(movies, key = { it.id }) { movie ->
            MovieRow(movie)
            HorizontalDivider()
        }
    }
}

@Composable
private fun MovieRow(movie: Movie) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AsyncImage(
            model = movie.posterUrl,
            contentDescription = movie.title,
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(width = 46.dp, height = 69.dp),
        )
        Column {
            Text(movie.title, style = MaterialTheme.typography.titleMedium)
            // A film with no release date shows no year line at all.
            movie.releaseYear?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        }
    }
}

@Composable
private fun Retryable(message: String, onRetry: () -> Unit, modifier: Modifier) {
    Centered(modifier) {
        Text(message)
        Button(onClick = onRetry) { Text("Retry") }
    }
}

@Composable
private fun Centered(modifier: Modifier, content: @Composable () -> Unit) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) { content() }
}
