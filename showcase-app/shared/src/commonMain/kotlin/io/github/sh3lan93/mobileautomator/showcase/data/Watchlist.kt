package io.github.sh3lan93.mobileautomator.showcase.data

import io.github.sh3lan93.mobileautomator.showcase.store.LocalStore
import io.github.sh3lan93.mobileautomator.showcase.store.WatchlistEntry
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/**
 * The films saved to the watchlist, kept on the device in [LocalStore.watchlist]. Every read is
 * derived from the store's one value, so no screen holds a copy that can go stale.
 */
class Watchlist(private val store: LocalStore) {

    /** The entries saved right now. */
    private val saved: List<WatchlistEntry> get() = store.watchlist.value.value

    /** Saved films, oldest first, as the screens show them. */
    val films: Flow<List<Movie>> = store.watchlist.value.map { list -> list.map { it.toMovie() } }.distinctUntilChanged()

    fun contains(movieId: Int): Flow<Boolean> =
        store.watchlist.value.map { list -> list.any { it.id == movieId } }.distinctUntilChanged()

    /** Appends [movie]; a no-op when it is already saved (a double tap keeps one entry). */
    fun add(movie: Movie) {
        val current = saved
        if (current.any { it.id == movie.id }) return
        store.watchlist.set(current + movie.toEntry())
    }

    /** Drops the film with [movieId]; a no-op when it is not saved. */
    fun remove(movieId: Int) {
        val current = saved
        if (current.none { it.id == movieId }) return
        store.watchlist.set(current.filterNot { it.id == movieId })
    }
}

private fun WatchlistEntry.toMovie() = Movie(id, title, releaseYear, posterUrl)

private fun Movie.toEntry() = WatchlistEntry(id, title, releaseYear, posterUrl)
