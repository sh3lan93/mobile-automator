package io.github.sh3lan93.mobileautomator.showcase.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay

/**
 * A TMDB that keeps each guest session's ratings in [server], set up as the guest hooks of the
 * shared [client] (its other members stay unset, so they fail a test that calls them). Every call
 * is in [FakeTmdbClient.calls].
 *
 * Sessions are minted `s1`, `s2`, `s3`, each after [createDelayMs]. A session in [expired] is
 * refused. [writeGate] holds rates and removes until completed; [writeFailure] / [readFailure]
 * fail them. After a write, the next [lagReads] reads of the rated list still return the list as
 * it was before the write (the read-back lag seen live). A rated film is `Film <id>` unless
 * [catalog] holds it.
 */
class FakeGuestTmdb {
    val client = FakeTmdbClient()
    val server = mutableMapOf<String, MutableMap<Int, Double>>()
    val expired = mutableSetOf<String>()
    val catalog = mutableMapOf<Int, Movie>()
    var createDelayMs = 0L
    var lagReads = 0
    var writeGate: CompletableDeferred<Unit>? = null
    var writeFailure: TmdbFailure? = null
    var readFailure: TmdbFailure? = null

    private val sessionIds = ArrayDeque(listOf("s1", "s2", "s3"))
    private var lagRemaining = 0
    private var stale: List<RatedMovie> = emptyList()

    val creates get() = client.calls.count { it is TmdbCall.CreateGuestSession }
    val reads get() = client.calls.count { it is TmdbCall.RatedMovies }
    val writes get() = client.calls.count { it is TmdbCall.Rate || it is TmdbCall.RemoveRating }

    init {
        client.onCreateGuestSession = {
            delay(createDelayMs)
            TmdbResult.Ok(sessionIds.removeFirst())
        }
        client.onRateMovie = { sessionId, movieId, value -> write(sessionId) { put(movieId, value) } }
        client.onRemoveRating = { sessionId, movieId -> write(sessionId) { remove(movieId) } }
        client.onRatedMovies = { sessionId ->
            when {
                readFailure != null -> TmdbResult.Failed(readFailure!!)
                sessionId in expired -> TmdbResult.Ok(GuestCall.SessionExpired)
                lagRemaining > 0 -> {
                    lagRemaining--
                    TmdbResult.Ok(GuestCall.Done(stale))
                }
                else -> TmdbResult.Ok(GuestCall.Done(ratedIn(sessionId)))
            }
        }
    }

    private fun ratedIn(sessionId: String) =
        server[sessionId].orEmpty().map { (id, value) -> RatedMovie(catalog[id] ?: Movie(id, "Film $id", null, null), value) }

    private suspend fun write(sessionId: String, change: MutableMap<Int, Double>.() -> Unit): TmdbResult<GuestCall<Unit>> {
        writeGate?.await()
        writeFailure?.let { return TmdbResult.Failed(it) }
        if (sessionId in expired) return TmdbResult.Ok(GuestCall.SessionExpired)
        stale = ratedIn(sessionId)
        lagRemaining = lagReads
        server.getOrPut(sessionId) { mutableMapOf() }.change()
        return TmdbResult.Ok(GuestCall.Done(Unit))
    }
}
