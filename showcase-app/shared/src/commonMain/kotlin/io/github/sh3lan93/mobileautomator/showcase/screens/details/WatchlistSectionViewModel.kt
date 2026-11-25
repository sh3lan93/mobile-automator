package io.github.sh3lan93.mobileautomator.showcase.screens.details

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.sh3lan93.mobileautomator.showcase.data.Movie
import io.github.sh3lan93.mobileautomator.showcase.data.Watchlist
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn

/**
 * Whether [movie] is on the watchlist, read from the store each time, so a change made anywhere
 * shows here. The writes are local and synchronous: there is no saving or failure state.
 */
class WatchlistSectionViewModel(private val movie: Movie, private val watchlist: Watchlist) : ViewModel() {
    val saved: StateFlow<Boolean> = watchlist.contains(movie.id).stateIn(viewModelScope, SharingStarted.Eagerly, false)

    fun add() = watchlist.add(movie)

    fun remove() = watchlist.remove(movie.id)
}
