package io.github.sh3lan93.mobileautomator.showcase.screens.ratings

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.sh3lan93.mobileautomator.showcase.screens.common.Centered
import io.github.sh3lan93.mobileautomator.showcase.screens.common.FailureContent
import io.github.sh3lan93.mobileautomator.showcase.screens.common.MovieList
import io.github.sh3lan93.mobileautomator.showcase.screens.common.MovieRowData
import io.github.sh3lan93.mobileautomator.showcase.screens.common.ratedFilmCount
import io.github.sh3lan93.mobileautomator.showcase.screens.common.ratingText
import org.koin.compose.viewmodel.koinViewModel

/** The films the guest rated, each with its rating; a row opens the film's details. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MyRatingsScreen(
    onBack: () -> Unit,
    onOpen: (Int) -> Unit,
    viewModel: MyRatingsViewModel = koinViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    // Every resume re-reads, so a rating removed on Details is gone when the user comes back.
    LifecycleResumeEffect(viewModel) {
        viewModel.refresh()
        onPauseOrDispose {}
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("My ratings") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        val modifier = Modifier.fillMaxSize().padding(padding)
        when (val s = state) {
            MyRatingsUiState.Loading -> Centered(modifier) {
                CircularProgressIndicator()
                Text("Loading your ratings…")
            }
            MyRatingsUiState.Empty -> Centered(modifier) { Text("You have not rated any films yet") }
            is MyRatingsUiState.Loaded -> MovieList(
                rows = s.films.map { MovieRowData(it.movie, ratingText(it.rating)) },
                countLine = ratedFilmCount(s.films.size),
                onOpen = onOpen,
                modifier = modifier,
            )
            is MyRatingsUiState.Failed -> FailureContent(s.failure, viewModel::refresh, modifier)
        }
    }
}
