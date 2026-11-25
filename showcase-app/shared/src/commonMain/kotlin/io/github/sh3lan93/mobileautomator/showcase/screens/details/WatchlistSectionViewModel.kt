package io.github.sh3lan93.mobileautomator.showcase.screens.details

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.sh3lan93.mobileautomator.showcase.data.Movie
import io.github.sh3lan93.mobileautomator.showcase.data.Watchlist
import io.github.sh3lan93.mobileautomator.showcase.store.LocalStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn

/**
 * Whether [movie] is on the watchlist, read from the store each time, so a change made anywhere
 * shows here. The writes are local and synchronous: there is no saving or failure state.
 * Removing follows the watchlist removal flag as it is when the tap happens: off removes at once,
 * on sets [confirming] until [confirmRemove] or [keep] answers.
 */
class WatchlistSectionViewModel(
    private val movie: Movie,
    private val watchlist: Watchlist,
    private val store: LocalStore,
) : ViewModel() {
    val saved: StateFlow<Boolean> = watchlist.contains(movie.id).stateIn(viewModelScope, SharingStarted.Eagerly, false)

    private val _confirming = MutableStateFlow(false)

    /** `true` while the remove confirmation is open. */
    val confirming: StateFlow<Boolean> = _confirming.asStateFlow()

    fun add() = watchlist.add(movie)

    fun requestRemove() {
        if (store.confirmWatchlistRemoval.value.value) _confirming.value = true else watchlist.remove(movie.id)
    }

    fun confirmRemove() {
        _confirming.value = false
        watchlist.remove(movie.id)
    }

    fun keep() {
        _confirming.value = false
    }
}
