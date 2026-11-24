package io.github.sh3lan93.mobileautomator.showcase.data

import io.github.sh3lan93.mobileautomator.showcase.store.LocalStore
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The guest's ratings, kept by TMDB under a guest session whose id lives in [store].
 *
 * A session is created on the first rating, never to read, so launching the app mints none.
 * When TMDB stops accepting the session, its id is dropped: reads are then empty (a new session
 * has no ratings) and a rating starts a new session. After a write is accepted, the rated list
 * is read back up to [confirmAttempts] times, [confirmIntervalMs] apart, until it shows the write,
 * so a screen that reads straight afterwards does not see TMDB's read-back lag. If it never shows
 * (or a read fails), the write is still reported Ok: TMDB accepted it.
 */
class GuestRatings(
    private val client: TmdbClient,
    private val store: LocalStore,
    private val confirmAttempts: Int = 10,
    private val confirmIntervalMs: Long = 500,
) {
    // Serialises writes and session creation, so two quick taps never create two sessions.
    private val writes = Mutex()

    // Read from the store on every call, never cached, so Reset app data takes effect at once.
    private val sessionId: String? get() = store.guestSessionId.value.value

    suspend fun rated(): TmdbResult<List<RatedMovie>> {
        val id = sessionId ?: return TmdbResult.Ok(emptyList())
        return when (val result = client.ratedMovies(id)) {
            is TmdbResult.Failed -> result
            is TmdbResult.Ok -> when (val call = result.value) {
                is GuestCall.Done -> TmdbResult.Ok(call.value)
                GuestCall.SessionExpired -> {
                    forget(id)
                    TmdbResult.Ok(emptyList())
                }
            }
        }
    }

    suspend fun ratingFor(movieId: Int): TmdbResult<Double?> =
        rated().map { films -> films.firstOrNull { it.movie.id == movieId }?.rating }

    suspend fun rate(movieId: Int, value: Double): TmdbResult<Unit> = writes.withLock {
        // One retry: a session that expired is replaced once; a new one expiring at once is a server fault.
        repeat(2) {
            val id = sessionId ?: when (val created = client.createGuestSession()) {
                is TmdbResult.Failed -> return created
                is TmdbResult.Ok -> created.value.also { store.guestSessionId.set(it) }
            }
            when (val result = client.rateMovie(id, movieId, value)) {
                is TmdbResult.Failed -> return result
                is TmdbResult.Ok -> when (result.value) {
                    is GuestCall.Done -> {
                        confirm { films -> films.any { it.movie.id == movieId && it.rating == value } }
                        return TmdbResult.Ok(Unit)
                    }
                    GuestCall.SessionExpired -> forget(id)
                }
            }
        }
        TmdbResult.Failed(TmdbFailure.ServerError)
    }

    suspend fun remove(movieId: Int): TmdbResult<Unit> = writes.withLock {
        val id = sessionId ?: return TmdbResult.Ok(Unit)
        when (val result = client.removeRating(id, movieId)) {
            is TmdbResult.Failed -> result
            is TmdbResult.Ok -> {
                when (result.value) {
                    is GuestCall.Done -> confirm { films -> films.none { it.movie.id == movieId } }
                    // Nothing is rated under the new session the next rating creates.
                    GuestCall.SessionExpired -> forget(id)
                }
                TmdbResult.Ok(Unit)
            }
        }
    }

    /** Reads the rated list until [shows] holds or attempts run out; a failed read ends it. */
    private suspend fun confirm(shows: (List<RatedMovie>) -> Boolean) {
        repeat(confirmAttempts) { attempt ->
            if (attempt > 0) delay(confirmIntervalMs)
            when (val result = rated()) {
                is TmdbResult.Failed -> return
                is TmdbResult.Ok -> if (shows(result.value)) return
            }
        }
    }

    /** Drops [id] unless a newer session already replaced it. */
    private fun forget(id: String) {
        if (sessionId == id) store.guestSessionId.set(null)
    }
}
