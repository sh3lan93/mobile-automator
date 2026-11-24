package io.github.sh3lan93.mobileautomator.showcase.data

import io.github.sh3lan93.mobileautomator.showcase.store.InMemoryKeyValueStorage
import io.github.sh3lan93.mobileautomator.showcase.store.LocalStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

@OptIn(ExperimentalCoroutinesApi::class)
class GuestRatingsTest {

    private val tmdb = FakeGuestTmdb()
    private val store = LocalStore(InMemoryKeyValueStorage())
    private val ratings = GuestRatings(tmdb.client, store, confirmAttempts = 10, confirmIntervalMs = 500)
    private val ok = TmdbResult.Ok(Unit)

    @Test
    fun noSession_readsAreEmpty_withoutRequests() = runTest {
        assertEquals(TmdbResult.Ok(emptyList()), ratings.rated())
        assertEquals(TmdbResult.Ok(null), ratings.ratingFor(278))
        assertEquals(ok, ratings.remove(278))
        assertEquals(emptyList(), tmdb.client.calls)
        assertNull(store.guestSessionId.value.value)
    }

    @Test
    fun firstRate_createsAndStoresSession_thenRates() = runTest {
        assertEquals(ok, ratings.rate(278, 8.0))
        assertEquals("s1", store.guestSessionId.value.value)
        assertEquals(listOf(TmdbCall.CreateGuestSession, TmdbCall.Rate("s1", 278, 8.0)), tmdb.client.calls.take(2))
        assertEquals(mapOf(278 to 8.0), tmdb.server["s1"]?.toMap())
        assertEquals(TmdbResult.Ok(8.0), ratings.ratingFor(278))
    }

    @Test
    fun secondRate_reusesSession() = runTest {
        ratings.rate(278, 8.0)
        ratings.rate(550, 6.5)
        assertEquals(1, tmdb.creates)
        assertEquals(mapOf(278 to 8.0, 550 to 6.5), tmdb.server["s1"]?.toMap())
    }

    @Test
    fun rate_waitsUntilListShowsValue() = runTest {
        tmdb.lagReads = 2
        assertEquals(ok, ratings.rate(278, 8.0))
        assertEquals(3, tmdb.reads)
        assertEquals(2 * 500L, testScheduler.currentTime)
    }

    @Test
    fun rate_confirmationGivesUp_stillOk() = runTest {
        tmdb.lagReads = 100
        assertEquals(ok, ratings.rate(278, 8.0))
        assertEquals(10, tmdb.reads)
    }

    @Test
    fun rate_updateWaitsForNewValue() = runTest {
        ratings.rate(278, 8.0)
        val readsBefore = tmdb.reads
        tmdb.lagReads = 1
        assertEquals(ok, ratings.rate(278, 4.0))
        assertEquals(2, tmdb.reads - readsBefore)
    }

    @Test
    fun remove_waitsUntilFilmAbsent() = runTest {
        ratings.rate(278, 8.0)
        val readsBefore = tmdb.reads
        tmdb.lagReads = 2
        assertEquals(ok, ratings.remove(278))
        assertEquals(3, tmdb.reads - readsBefore)
        assertEquals(emptyMap<Int, Double>(), tmdb.server["s1"]?.toMap())
        assertEquals(TmdbResult.Ok(null), ratings.ratingFor(278))
    }

    @Test
    fun expiredSession_onRate_createsNewSessionAndRetriesOnce() = runTest {
        store.guestSessionId.set("old")
        tmdb.expired += "old"
        assertEquals(ok, ratings.rate(278, 8.0))
        assertEquals(
            listOf(TmdbCall.Rate("old", 278, 8.0), TmdbCall.CreateGuestSession, TmdbCall.Rate("s1", 278, 8.0)),
            tmdb.client.calls.take(3),
        )
        assertEquals("s1", store.guestSessionId.value.value)
        assertEquals(mapOf(278 to 8.0), tmdb.server["s1"]?.toMap())
    }

    @Test
    fun expiredSession_onRead_clearsIdAndReadsEmpty() = runTest {
        store.guestSessionId.set("old")
        tmdb.expired += "old"
        assertEquals(TmdbResult.Ok(emptyList()), ratings.rated())
        assertNull(store.guestSessionId.value.value)
        store.guestSessionId.set("old")
        assertEquals(TmdbResult.Ok(null), ratings.ratingFor(278))
        assertNull(store.guestSessionId.value.value)
        assertEquals(0, tmdb.creates)
    }

    @Test
    fun expiredSession_onRemove_clearsIdAndIsOk() = runTest {
        store.guestSessionId.set("old")
        tmdb.expired += "old"
        assertEquals(ok, ratings.remove(278))
        assertNull(store.guestSessionId.value.value)
        assertEquals(0, tmdb.creates)
    }

    @Test
    fun rateFailure_isReturned_sessionKept() = runTest {
        ratings.rate(278, 8.0)
        tmdb.writeFailure = TmdbFailure.NoConnection
        assertEquals(TmdbResult.Failed(TmdbFailure.NoConnection), ratings.rate(550, 7.0))
        assertEquals("s1", store.guestSessionId.value.value)
    }

    @Test
    fun concurrentRates_createOneSession() = runTest {
        tmdb.createDelayMs = 100
        val results = listOf(
            async { ratings.rate(278, 8.0) },
            async { ratings.rate(550, 7.0) },
        ).awaitAll()
        assertEquals(listOf(ok, ok), results)
        assertEquals(1, tmdb.creates)
        assertEquals(mapOf(278 to 8.0, 550 to 7.0), tmdb.server["s1"]?.toMap())
    }

    @Test
    fun reset_clearsSession_nextRateCreatesNew() = runTest {
        ratings.rate(278, 8.0)
        store.reset()
        assertNull(store.guestSessionId.value.value)
        val requestsBefore = tmdb.client.calls.size
        assertEquals(TmdbResult.Ok(null), ratings.ratingFor(278))
        assertEquals(requestsBefore, tmdb.client.calls.size)
        ratings.rate(550, 7.0)
        assertEquals("s2", store.guestSessionId.value.value)
        assertEquals(TmdbResult.Ok(listOf(RatedMovie(Movie(550, "Film 550", null, null), 7.0))), ratings.rated())
    }
}
