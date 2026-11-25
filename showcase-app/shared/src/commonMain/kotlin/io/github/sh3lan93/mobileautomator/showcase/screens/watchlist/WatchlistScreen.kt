package io.github.sh3lan93.mobileautomator.showcase.screens.watchlist

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.sh3lan93.mobileautomator.showcase.screens.common.Centered
import io.github.sh3lan93.mobileautomator.showcase.screens.common.MovieList
import io.github.sh3lan93.mobileautomator.showcase.screens.common.MovieRowData
import io.github.sh3lan93.mobileautomator.showcase.screens.common.filmCount
import org.koin.compose.viewmodel.koinViewModel

/** The films saved to the watchlist, oldest first; a row opens the film's details. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WatchlistScreen(
    onBack: () -> Unit,
    onOpen: (Int) -> Unit,
    viewModel: WatchlistViewModel = koinViewModel(),
) {
    val films by viewModel.films.collectAsStateWithLifecycle()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Watchlist") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        val modifier = Modifier.fillMaxSize().padding(padding)
        if (films.isEmpty()) {
            Centered(modifier) { Text("Your watchlist is empty") }
        } else {
            MovieList(films.map(::MovieRowData), filmCount(films.size), onOpen, modifier)
        }
    }
}
