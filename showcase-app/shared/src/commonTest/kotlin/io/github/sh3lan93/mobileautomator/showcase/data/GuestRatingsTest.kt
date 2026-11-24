package io.github.sh3lan93.mobileautomator.showcase.data

import io.github.sh3lan93.mobileautomator.showcase.store.InMemoryKeyValueStorage
import io.github.sh3lan93.mobileautomator.showcase.store.LocalStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

@OptIn(ExperimentalCoroutinesApi::class)
class GuestRatingsTest {

    /**
     * A TMDB that keeps each session's ratings. After a write, the next [lagReads] reads of the
     * rated list still return the list as it was before the write (the read-back lag seen live).
     */
    private class FakeTmdbClient : TmdbClient {
        val log = mutableListOf<String>()
        private val sessionIds = ArrayDeque(listOf("s1", "s2", "s3"))
        var createDelayMs = 0L
        val expired = mutableSetOf<String>()
        var rateFailure: TmdbResult.Failed? = null
        var lagReads = 0
        val server = mutableMapOf<String, MutableMap<Int, Double>>()
        private var lagRemaining = 0
        private var stale: List<RatedMovie> = emptyList()

        val creates get() = log.count { it == "create" }
        val reads get() = log.count { it.startsWith("rated:") }

        private fun ratedIn(sessionId: String) =
            server[sessionId].orEmpty().map { (id, value) -> RatedMovie(Movie(id, "Film $id", null, null), value) }

        private fun write(sessionId: String, change: MutableMap<Int, Double>.() -> Unit) {
            stale = ratedIn(sessionId)
            lagRemaining = lagReads
            server.getOrPut(sessionId) { mutableMapOf() }.change()
        }

        override suspend fun createGuestSession(): TmdbResult<String> {
            log += "create"
            delay(createDelayMs)
            return TmdbResult.Ok(sessionIds.removeFirst())
        }

        override suspend fun rateMovie(sessionId: String, movieId: Int, value: Double): TmdbResult<GuestCall<Unit>> {
            log += "rate:$sessionId:$movieId:$value"
            rateFailure?.let { return it }
            if (sessionId in expired) return TmdbResult.Ok(GuestCall.SessionExpired)
            write(sessionId) { put(movieId, value) }
            return TmdbResult.Ok(GuestCall.Done(Unit))
        }

        override suspend fun removeRating(sessionId: String, movieId: Int): TmdbResult<GuestCall<Unit>> {
            log += "remove:$sessionId:$movieId"
            if (sessionId in expired) return TmdbResult.Ok(GuestCall.SessionExpired)
            write(sessionId) { remove(movieId) }
            return TmdbResult.Ok(GuestCall.Done(Unit))
        }

        override suspend fun ratedMovies(sessionId: String): TmdbResult<GuestCall<List<RatedMovie>>> {
            log += "rated:$sessionId"
            if (sessionId in expired) return TmdbResult.Ok(GuestCall.SessionExpired)
            if (lagRemaining > 0) {
                lagRemaining--
                return TmdbResult.Ok(GuestCall.Done(stale))
            }
            return TmdbResult.Ok(GuestCall.Done(ratedIn(sessionId)))
        }

        override suspend fun popularMovies() = error("not used")
        override suspend fun searchMovies(query: String) = error("not used")
        override suspend fun movieDetails(id: Int) = error("not used")
        override suspend fun discoverMovies(query: Map<String, String>) = error("not used")
        override suspend fun movieGenres() = error("not used")
    }

    private val client = FakeTmdbClient()
    private val store = LocalStore(InMemoryKeyValueStorage())
    private val ratings = GuestRatings(client, store, confirmAttempts = 10, confirmIntervalMs = 500)
    private val ok = TmdbResult.Ok(Unit)

    @Test
    fun noSession_readsAreEmpty_withoutRequests() = runTest {
        assertEquals(TmdbResult.Ok(emptyList()), ratings.rated())
        assertEquals(TmdbResult.Ok(null), ratings.ratingFor(278))
        assertEquals(ok, ratings.remove(278))
        assertEquals(emptyList(), client.log)
        assertNull(store.guestSessionId.value.value)
    }

    @Test
    fun firstRate_createsAndStoresSession_thenRates() = runTest {
        assertEquals(ok, ratings.rate(278, 8.0))
        assertEquals("s1", store.guestSessionId.value.value)
        assertEquals(listOf("create", "rate:s1:278:8.0"), client.log.take(2))
        assertEquals(mapOf(278 to 8.0), client.server["s1"]?.toMap())
        assertEquals(TmdbResult.Ok(8.0), ratings.ratingFor(278))
    }

    @Test
    fun secondRate_reusesSession() = runTest {
        ratings.rate(278, 8.0)
        ratings.rate(550, 6.5)
        assertEquals(1, client.creates)
        assertEquals(mapOf(278 to 8.0, 550 to 6.5), client.server["s1"]?.toMap())
    }

    @Test
    fun rate_waitsUntilListShowsValue() = runTest {
        client.lagReads = 2
        assertEquals(ok, ratings.rate(278, 8.0))
        assertEquals(3, client.reads)
        assertEquals(2 * 500L, testScheduler.currentTime)
    }

    @Test
    fun rate_confirmationGivesUp_stillOk() = runTest {
        client.lagReads = 100
        assertEquals(ok, ratings.rate(278, 8.0))
        assertEquals(10, client.reads)
    }

    @Test
    fun rate_updateWaitsForNewValue() = runTest {
        ratings.rate(278, 8.0)
        val readsBefore = client.reads
        client.lagReads = 1
        assertEquals(ok, ratings.rate(278, 4.0))
        assertEquals(2, client.reads - readsBefore)
    }

    @Test
    fun remove_waitsUntilFilmAbsent() = runTest {
        ratings.rate(278, 8.0)
        val readsBefore = client.reads
        client.lagReads = 2
        assertEquals(ok, ratings.remove(278))
        assertEquals(3, client.reads - readsBefore)
        assertEquals(emptyMap<Int, Double>(), client.server["s1"]?.toMap())
        assertEquals(TmdbResult.Ok(null), ratings.ratingFor(278))
    }

    @Test
    fun expiredSession_onRate_createsNewSessionAndRetriesOnce() = runTest {
        store.guestSessionId.set("old")
        client.expired += "old"
        assertEquals(ok, ratings.rate(278, 8.0))
        assertEquals(listOf("rate:old:278:8.0", "create", "rate:s1:278:8.0"), client.log.take(3))
        assertEquals("s1", store.guestSessionId.value.value)
        assertEquals(mapOf(278 to 8.0), client.server["s1"]?.toMap())
    }

    @Test
    fun expiredSession_onRead_clearsIdAndReadsEmpty() = runTest {
        store.guestSessionId.set("old")
        client.expired += "old"
        assertEquals(TmdbResult.Ok(emptyList()), ratings.rated())
        assertNull(store.guestSessionId.value.value)
        store.guestSessionId.set("old")
        assertEquals(TmdbResult.Ok(null), ratings.ratingFor(278))
        assertNull(store.guestSessionId.value.value)
        assertEquals(0, client.creates)
    }

    @Test
    fun expiredSession_onRemove_clearsIdAndIsOk() = runTest {
        store.guestSessionId.set("old")
        client.expired += "old"
        assertEquals(ok, ratings.remove(278))
        assertNull(store.guestSessionId.value.value)
        assertEquals(0, client.creates)
    }

    @Test
    fun rateFailure_isReturned_sessionKept() = runTest {
        ratings.rate(278, 8.0)
        client.rateFailure = TmdbResult.Failed(TmdbFailure.NoConnection)
        assertEquals(TmdbResult.Failed(TmdbFailure.NoConnection), ratings.rate(550, 7.0))
        assertEquals("s1", store.guestSessionId.value.value)
    }

    @Test
    fun concurrentRates_createOneSession() = runTest {
        client.createDelayMs = 100
        val results = listOf(
            async { ratings.rate(278, 8.0) },
            async { ratings.rate(550, 7.0) },
        ).awaitAll()
        assertEquals(listOf(ok, ok), results)
        assertEquals(1, client.creates)
        assertEquals(mapOf(278 to 8.0, 550 to 7.0), client.server["s1"]?.toMap())
    }

    @Test
    fun reset_clearsSession_nextRateCreatesNew() = runTest {
        ratings.rate(278, 8.0)
        store.reset()
        assertNull(store.guestSessionId.value.value)
        val requestsBefore = client.log.size
        assertEquals(TmdbResult.Ok(null), ratings.ratingFor(278))
        assertEquals(requestsBefore, client.log.size)
        ratings.rate(550, 7.0)
        assertEquals("s2", store.guestSessionId.value.value)
        assertEquals(TmdbResult.Ok(listOf(RatedMovie(Movie(550, "Film 550", null, null), 7.0))), ratings.rated())
    }

    @Test
    fun ratingText_formatsWholeAndHalf() {
        assertEquals("Your rating: 8/10", ratingText(8.0))
        assertEquals("Your rating: 10/10", ratingText(10.0))
        assertEquals("Your rating: 6.5/10", ratingText(6.5))
        assertEquals("Your rating: 0.5/10", ratingText(0.5))
    }
}
