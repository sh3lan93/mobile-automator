package io.github.sh3lan93.mobileautomator.showcase.screens.details

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import io.github.sh3lan93.mobileautomator.showcase.data.MovieDetails
import io.github.sh3lan93.mobileautomator.showcase.data.toMovie
import io.github.sh3lan93.mobileautomator.showcase.screens.common.BackTopBar
import io.github.sh3lan93.mobileautomator.showcase.screens.common.Centered
import io.github.sh3lan93.mobileautomator.showcase.screens.common.FailureContent
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf

/** One film's details; the top bar carries the film title once loaded. */
@Composable
fun DetailsScreen(
    movieId: Int,
    onBack: () -> Unit,
    viewModel: DetailsViewModel = koinViewModel { parametersOf(movieId) },
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val compact by viewModel.compactLayout.collectAsStateWithLifecycle()
    Scaffold(
        topBar = {
            BackTopBar((state as? DetailsUiState.Loaded)?.details?.title ?: "", onBack)
        },
    ) { padding ->
        val modifier = Modifier.fillMaxSize().padding(padding)
        when (val s = state) {
            DetailsUiState.Loading -> Centered(modifier) { CircularProgressIndicator() }
            is DetailsUiState.Loaded -> DetailsContent(s.details, compact, modifier)
            is DetailsUiState.Failed -> FailureContent(s.failure, viewModel::retry, modifier)
        }
    }
}

/** The film; [compact] (a feature flag) changes only the facts and overview block between the poster and the sections. */
@Composable
private fun DetailsContent(details: MovieDetails, compact: Boolean, modifier: Modifier) {
    Column(
        modifier = modifier.verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Poster(details)
        if (compact) CompactFacts(details) else ClassicFacts(details)
        WatchlistSection(details.toMovie())
        RatingSection(details.id)
    }
}

/** The classic layout: each fact on its own line, only when TMDB sent it (never `null` or `0 min`). */
@Composable
private fun ClassicFacts(details: MovieDetails) {
    details.releaseYear?.let { Text("Released $it", style = MaterialTheme.typography.bodyLarge) }
    details.runtimeMinutes?.let { Text("$it min", style = MaterialTheme.typography.bodyLarge) }
    if (details.genres.isNotEmpty()) {
        Text(details.genres.joinToString(", "), style = MaterialTheme.typography.bodyLarge)
    }
    details.overview?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
}

/** The compact layout: one facts line, then the overview under an `Overview` heading. */
@Composable
private fun CompactFacts(details: MovieDetails) {
    compactFacts(details)?.let { Text(it, style = MaterialTheme.typography.bodyLarge) }
    details.overview?.let {
        Text("Overview", style = MaterialTheme.typography.titleMedium)
        Text(it, style = MaterialTheme.typography.bodyMedium)
    }
}

/** "Poster", not the title, so the title is one element on the screen (the top bar). */
@Composable
private fun Poster(details: MovieDetails) {
    AsyncImage(
        model = details.posterUrl,
        contentDescription = "Poster",
        contentScale = ContentScale.Crop,
        modifier = Modifier.size(width = 154.dp, height = 231.dp),
    )
}
