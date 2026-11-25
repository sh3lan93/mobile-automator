package io.github.sh3lan93.mobileautomator.showcase.screens.watchlist

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.sh3lan93.mobileautomator.showcase.data.Movie
import io.github.sh3lan93.mobileautomator.showcase.data.Watchlist
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn

/** The saved films, straight from the store: a film removed on Details is gone here with no reload. */
class WatchlistViewModel(watchlist: Watchlist) : ViewModel() {
    val films: StateFlow<List<Movie>> = watchlist.films.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
}
