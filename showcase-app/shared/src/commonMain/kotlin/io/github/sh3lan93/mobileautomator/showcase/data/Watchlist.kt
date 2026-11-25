package io.github.sh3lan93.mobileautomator.showcase.data

import io.github.sh3lan93.mobileautomator.showcase.store.LocalStore
import io.github.sh3lan93.mobileautomator.showcase.store.WatchlistEntry
import kotlinx.coroutines.ExperimentalForInheritanceCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/**
 * The films saved to the watchlist, kept on the device in [LocalStore.watchlist]. Every read is
 * derived from the store's one value, so no screen holds a copy that can go stale.
 */
class Watchlist(private val store: LocalStore) {

    private val entries get() = store.watchlist.value

    /** Saved films, oldest first, as the screens show them. */
    val films: StateFlow<List<Movie>> = DerivedStateFlow(entries) { list -> list.map { it.toMovie() } }

    fun contains(movieId: Int): StateFlow<Boolean> = DerivedStateFlow(entries) { list -> list.any { it.id == movieId } }

    /** Appends [movie]; a no-op when it is already saved (a double tap keeps one entry). */
    fun add(movie: Movie) {
        val current = entries.value
        if (current.any { it.id == movie.id }) return
        store.watchlist.set(current + movie.toEntry())
    }

    /** Drops the film with [movieId]; a no-op when it is not saved. */
    fun remove(movieId: Int) {
        val current = entries.value
        if (current.none { it.id == movieId }) return
        store.watchlist.set(current.filterNot { it.id == movieId })
    }
}

private fun WatchlistEntry.toMovie() = Movie(id, title, releaseYear, posterUrl)

private fun Movie.toEntry() = WatchlistEntry(id, title, releaseYear, posterUrl)

/** [source] seen through [transform]: reads stay synchronous and need no scope, and nothing is cached. */
@OptIn(ExperimentalForInheritanceCoroutinesApi::class)
private class DerivedStateFlow<T, R>(private val source: StateFlow<T>, private val transform: (T) -> R) : StateFlow<R> {
    override val value: R get() = transform(source.value)
    override val replayCache: List<R> get() = listOf(value)
    override suspend fun collect(collector: FlowCollector<R>): Nothing {
        source.map(transform).distinctUntilChanged().collect(collector)
        awaitCancellation() // a StateFlow never completes, so this is never reached
    }
}
