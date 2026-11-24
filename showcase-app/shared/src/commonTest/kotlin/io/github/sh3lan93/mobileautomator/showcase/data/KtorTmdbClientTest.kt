package io.github.sh3lan93.mobileautomator.showcase.data

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class KtorTmdbClientTest {

    private val jsonHeaders = headersOf(HttpHeaders.ContentType, "application/json")

    private fun client(
        key: String,
        simulation: () -> Simulation = { Simulation() },
        handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData,
    ): KtorTmdbClient {
        val http = HttpClient(MockEngine { request -> handler(request) }) {
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        }
        return KtorTmdbClient(http, key, simulation)
    }

    private fun MockRequestHandleScope.json(body: String, status: HttpStatusCode = HttpStatusCode.OK) =
        respond(body, status, jsonHeaders)

    @Test
    fun blankKey_returnsMissingKey_withoutCallingNetwork() = runTest {
        var calls = 0
        val result = client("  ") { calls++; json("""{"results":[]}""") }.popularMovies()
        assertEquals(TmdbResult.Failed(TmdbFailure.MissingKey), result)
        assertEquals(0, calls)
    }

    @Test
    fun sendsApiKeyAsQueryParameter() = runTest {
        var seen: HttpRequestData? = null
        client("k1") { request -> seen = request; json("""{"results":[]}""") }.popularMovies()
        val request = requireNotNull(seen)
        assertEquals("api.themoviedb.org", request.url.host)
        assertEquals("/3/movie/popular", request.url.encodedPath)
        assertEquals("k1", request.url.parameters["api_key"])
        assertEquals("en-US", request.url.parameters["language"])
        assertEquals("1", request.url.parameters["page"])
        assertNull(request.headers[HttpHeaders.Authorization])
    }

    @Test
    fun ok_parsesTitleYearAndPoster() = runTest {
        val body = """{"page":1,"results":[{"id":603,"title":"The Matrix","release_date":"1999-03-31","poster_path":"/m.jpg","extra":1}]}"""
        val result = client("k") { json(body) }.popularMovies()
        assertEquals(
            TmdbResult.Ok(listOf(Movie(603, "The Matrix", "1999", "https://image.tmdb.org/t/p/w342/m.jpg"))),
            result,
        )
    }

    @Test
    fun ok_keepsFilmWithNoDateAndNoPoster() = runTest {
        val body = """{"results":[{"id":7,"title":"Untitled","release_date":"","poster_path":null}]}"""
        val result = client("k") { json(body) }.popularMovies()
        assertEquals(TmdbResult.Ok(listOf(Movie(7, "Untitled", null, null))), result)
    }

    @Test
    fun http401_returnsRejectedKey() = runTest {
        val body = """{"status_code":7,"status_message":"Invalid API key: You must be granted a valid key.","success":false}"""
        val result = client("bad") { json(body, HttpStatusCode.Unauthorized) }.popularMovies()
        assertEquals(TmdbResult.Failed(TmdbFailure.RejectedKey), result)
    }

    @Test
    fun http429_returnsServerError() = runTest {
        val result = client("k") { json("{}", HttpStatusCode.TooManyRequests) }.popularMovies()
        assertEquals(TmdbResult.Failed(TmdbFailure.ServerError), result)
    }

    @Test
    fun http500_returnsServerError() = runTest {
        val result = client("k") { json("{}", HttpStatusCode.InternalServerError) }.popularMovies()
        assertEquals(TmdbResult.Failed(TmdbFailure.ServerError), result)
    }

    @Test
    fun malformedBody_returnsServerError() = runTest {
        val result = client("k") { json("not json") }.popularMovies()
        assertEquals(TmdbResult.Failed(TmdbFailure.ServerError), result)
    }

    @Test
    fun ioFailure_returnsNoConnection() = runTest {
        val result = client("k") { throw kotlinx.io.IOException("offline") }.popularMovies()
        assertEquals(TmdbResult.Failed(TmdbFailure.NoConnection), result)
    }

    @Test
    fun cancellation_isRethrown() = runTest {
        assertFailsWith<CancellationException> {
            client("k") { throw CancellationException() }.popularMovies()
        }
    }

    @Test
    fun simulateOffline_returnsNoConnection_withoutCallingNetwork() = runTest {
        var calls = 0
        val result = client("k", { Simulation(offline = true) }) { calls++; json("""{"results":[]}""") }.popularMovies()
        assertEquals(TmdbResult.Failed(TmdbFailure.NoConnection), result)
        assertEquals(0, calls)
    }

    @Test
    fun simulateServerError_returnsServerError_withoutCallingNetwork() = runTest {
        var calls = 0
        val result = client("k", { Simulation(serverError = true) }) { calls++; json("""{"results":[]}""") }.popularMovies()
        assertEquals(TmdbResult.Failed(TmdbFailure.ServerError), result)
        assertEquals(0, calls)
    }

    @Test
    fun bothSwitches_offlineWins() = runTest {
        val both = Simulation(offline = true, serverError = true)
        val result = client("k", { both }) { json("""{"results":[]}""") }.popularMovies()
        assertEquals(TmdbResult.Failed(TmdbFailure.NoConnection), result)
    }

    @Test
    fun blankKey_beatsSimulation() = runTest {
        val both = Simulation(offline = true, serverError = true)
        val result = client(" ", { both }) { json("""{"results":[]}""") }.popularMovies()
        assertEquals(TmdbResult.Failed(TmdbFailure.MissingKey), result)
    }

    @Test
    fun switchReadPerCall() = runTest {
        var simulation = Simulation(offline = true)
        val client = client("k", { simulation }) { json("""{"results":[]}""") }
        assertEquals(TmdbResult.Failed(TmdbFailure.NoConnection), client.popularMovies())
        simulation = Simulation()
        assertEquals(TmdbResult.Ok(emptyList()), client.popularMovies())
    }

    @Test
    fun simulation_appliesToSearchAndDetails_withoutCallingNetwork() = runTest {
        var calls = 0
        val offline = client("k", { Simulation(offline = true) }) { calls++; json("{}") }
        assertEquals(TmdbResult.Failed(TmdbFailure.NoConnection), offline.searchMovies("matrix"))
        assertEquals(TmdbResult.Failed(TmdbFailure.NoConnection), offline.movieDetails(278))
        val failing = client("k", { Simulation(serverError = true) }) { calls++; json("{}") }
        assertEquals(TmdbResult.Failed(TmdbFailure.ServerError), failing.searchMovies("matrix"))
        assertEquals(TmdbResult.Failed(TmdbFailure.ServerError), failing.movieDetails(278))
        assertEquals(0, calls)
    }

    @Test
    fun search_sendsQueryAndApiKey() = runTest {
        var seen: HttpRequestData? = null
        client("k1") { request -> seen = request; json("""{"results":[]}""") }.searchMovies("the matrix")
        val request = requireNotNull(seen)
        assertEquals("api.themoviedb.org", request.url.host)
        assertEquals("/3/search/movie", request.url.encodedPath)
        assertEquals("the matrix", request.url.parameters["query"])
        assertEquals("false", request.url.parameters["include_adult"])
        assertEquals("en-US", request.url.parameters["language"])
        assertEquals("1", request.url.parameters["page"])
        assertEquals("k1", request.url.parameters["api_key"])
        assertNull(request.headers[HttpHeaders.Authorization])
    }

    @Test
    fun search_parsesResults() = runTest {
        val results = (1..20).joinToString(",") { id ->
            if (id == 1) """{"id":603,"title":"The Matrix","release_date":"1999-03-31","poster_path":"/m.jpg"}"""
            else """{"id":$id,"title":"Film $id","release_date":"","poster_path":null}"""
        }
        val body = """{"page":1,"total_results":57,"total_pages":3,"results":[$results]}"""
        val result = client("k") { json(body) }.searchMovies("matrix")
        val page = (result as TmdbResult.Ok<SearchPage>).value
        assertEquals(57, page.totalResults)
        assertEquals(20, page.movies.size)
        assertEquals(Movie(603, "The Matrix", "1999", "https://image.tmdb.org/t/p/w342/m.jpg"), page.movies[0])
        assertEquals(Movie(2, "Film 2", null, null), page.movies[1])
    }

    @Test
    fun search_blankKey_returnsMissingKey_withoutCallingNetwork() = runTest {
        var calls = 0
        val result = client(" ") { calls++; json("""{"results":[]}""") }.searchMovies("matrix")
        assertEquals(TmdbResult.Failed(TmdbFailure.MissingKey), result)
        assertEquals(0, calls)
    }

    @Test
    fun search_http401_returnsRejectedKey() = runTest {
        val result = client("bad") { json("{}", HttpStatusCode.Unauthorized) }.searchMovies("matrix")
        assertEquals(TmdbResult.Failed(TmdbFailure.RejectedKey), result)
    }

    @Test
    fun details_sendsIdInPath() = runTest {
        var seen: HttpRequestData? = null
        client("k1") { request -> seen = request; json("""{"id":278,"title":"T"}""") }.movieDetails(278)
        val request = requireNotNull(seen)
        assertEquals("/3/movie/278", request.url.encodedPath)
        assertEquals("k1", request.url.parameters["api_key"])
        assertEquals("en-US", request.url.parameters["language"])
    }

    @Test
    fun details_parsesAllFields() = runTest {
        val body = """{"id":278,"title":"The Shawshank Redemption","release_date":"1994-09-23","poster_path":"/s.jpg",
            |"runtime":142,"genres":[{"id":18,"name":"Drama"},{"id":80,"name":"Crime"}],
            |"overview":"Two imprisoned men bond.","tagline":"x"}""".trimMargin()
        val result = client("k") { json(body) }.movieDetails(278)
        assertEquals(
            TmdbResult.Ok(
                MovieDetails(
                    id = 278,
                    title = "The Shawshank Redemption",
                    releaseYear = "1994",
                    runtimeMinutes = 142,
                    genres = listOf("Drama", "Crime"),
                    overview = "Two imprisoned men bond.",
                    posterUrl = "https://image.tmdb.org/t/p/w342/s.jpg",
                ),
            ),
            result,
        )
    }

    @Test
    fun details_missingOptionalFields_areNullOrEmpty() = runTest {
        val missing = MovieDetails(9, "Bare", null, null, emptyList(), null, null)
        val bodies = listOf(
            """{"id":9,"title":"Bare","runtime":null,"overview":"   ","release_date":"","poster_path":null}""",
            """{"id":9,"title":"Bare","runtime":0,"overview":""}""",
            """{"id":9,"title":"Bare"}""",
        )
        for (body in bodies) {
            assertEquals(TmdbResult.Ok(missing), client("k") { json(body) }.movieDetails(9), "for $body")
        }
    }

    @Test
    fun details_http404_returnsServerError() = runTest {
        val body = """{"success":false,"status_code":34,"status_message":"The resource you requested could not be found."}"""
        val result = client("k") { json(body, HttpStatusCode.NotFound) }.movieDetails(1)
        assertEquals(TmdbResult.Failed(TmdbFailure.ServerError), result)
    }

    // Guest session (#309). Bodies are the shapes TMDB returned in the live check of 2026-11-24.

    private val expiredBody = """{"success":false,"status_code":3,"status_message":"Authentication failed: You do not have permissions to access the service."}"""
    private val rejectedBody = """{"status_code":7,"status_message":"Invalid API key: You must be granted a valid key.","success":false}"""

    @Test
    fun createGuestSession_returnsId() = runTest {
        var seen: HttpRequestData? = null
        val body = """{"success":true,"guest_session_id":"g1","expires_at":"2026-11-25 10:00:00 UTC"}"""
        val result = client("k1") { request -> seen = request; json(body) }.createGuestSession()
        assertEquals(TmdbResult.Ok("g1"), result)
        val request = requireNotNull(seen)
        assertEquals(HttpMethod.Get, request.method)
        assertEquals("/3/authentication/guest_session/new", request.url.encodedPath)
        assertEquals("k1", request.url.parameters["api_key"])
        assertNull(request.headers[HttpHeaders.Authorization])
    }

    @Test
    fun rateMovie_postsValueWithSession() = runTest {
        var seen: HttpRequestData? = null
        val body = """{"success":true,"status_code":1,"status_message":"Success."}"""
        val result = client("k1") { request -> seen = request; json(body, HttpStatusCode.Created) }.rateMovie("g1", 278, 8.0)
        assertEquals(TmdbResult.Ok(GuestCall.Done(Unit)), result)
        val request = requireNotNull(seen)
        assertEquals(HttpMethod.Post, request.method)
        assertEquals("/3/movie/278/rating", request.url.encodedPath)
        assertEquals("g1", request.url.parameters["guest_session_id"])
        assertEquals("k1", request.url.parameters["api_key"])
        assertNull(request.headers[HttpHeaders.Authorization])
        assertEquals("""{"value":8.0}""", (request.body as TextContent).text)
    }

    @Test
    fun removeRating_deletesWithSession() = runTest {
        var seen: HttpRequestData? = null
        val body = """{"success":true,"status_code":13,"status_message":"The item/record was deleted successfully."}"""
        val result = client("k1") { request -> seen = request; json(body) }.removeRating("g1", 278)
        assertEquals(TmdbResult.Ok(GuestCall.Done(Unit)), result)
        val request = requireNotNull(seen)
        assertEquals(HttpMethod.Delete, request.method)
        assertEquals("/3/movie/278/rating", request.url.encodedPath)
        assertEquals("g1", request.url.parameters["guest_session_id"])
        assertEquals("k1", request.url.parameters["api_key"])
        assertNull(request.headers[HttpHeaders.Authorization])
    }

    @Test
    fun ratedMovies_parsesRatingAndFilm() = runTest {
        var seen: HttpRequestData? = null
        val body = """{"page":1,"total_results":1,"results":[{"id":278,"title":"The Shawshank Redemption","release_date":"1994-09-23","poster_path":"/s.jpg","rating":8.0}]}"""
        val result = client("k1") { request -> seen = request; json(body) }.ratedMovies("g1")
        assertEquals(
            TmdbResult.Ok(
                GuestCall.Done(
                    listOf(RatedMovie(Movie(278, "The Shawshank Redemption", "1994", "https://image.tmdb.org/t/p/w342/s.jpg"), 8.0)),
                ),
            ),
            result,
        )
        val request = requireNotNull(seen)
        assertEquals(HttpMethod.Get, request.method)
        assertEquals("/3/guest_session/g1/rated/movies", request.url.encodedPath)
        assertEquals("k1", request.url.parameters["api_key"])
        assertEquals("en-US", request.url.parameters["language"])
        assertEquals("1", request.url.parameters["page"])
        assertEquals("created_at.asc", request.url.parameters["sort_by"])
        assertNull(request.headers[HttpHeaders.Authorization])
    }

    @Test
    fun ratedMovies_404_isEmptyList() = runTest {
        val body = """{"success":false,"status_code":34,"status_message":"The resource you requested could not be found."}"""
        val result = client("k") { json(body, HttpStatusCode.NotFound) }.ratedMovies("g1")
        assertEquals(TmdbResult.Ok(GuestCall.Done(emptyList())), result)
    }

    @Test
    fun sessionCalls_401Status3_isSessionExpired() = runTest {
        val client = client("k") { json(expiredBody, HttpStatusCode.Unauthorized) }
        assertEquals(TmdbResult.Ok(GuestCall.SessionExpired), client.rateMovie("gone", 278, 8.0))
        assertEquals(TmdbResult.Ok(GuestCall.SessionExpired), client.removeRating("gone", 278))
        assertEquals(TmdbResult.Ok(GuestCall.SessionExpired), client.ratedMovies("gone"))
    }

    @Test
    fun sessionCalls_401Status7_isRejectedKey() = runTest {
        for (body in listOf(rejectedBody, "not json", "")) {
            val client = client("bad") { json(body, HttpStatusCode.Unauthorized) }
            val rejected = TmdbResult.Failed(TmdbFailure.RejectedKey)
            assertEquals(rejected, client.rateMovie("g1", 278, 8.0), "for $body")
            assertEquals(rejected, client.removeRating("g1", 278), "for $body")
            assertEquals(rejected, client.ratedMovies("g1"), "for $body")
            assertEquals(rejected, client.createGuestSession(), "for $body")
        }
    }

    @Test
    fun nonSessionCalls_401Status3_staysRejectedKey() = runTest {
        val client = client("k") { json(expiredBody, HttpStatusCode.Unauthorized) }
        assertEquals(TmdbResult.Failed(TmdbFailure.RejectedKey), client.popularMovies())
        assertEquals(TmdbResult.Failed(TmdbFailure.RejectedKey), client.createGuestSession())
    }

    @Test
    fun guestCalls_blankKey_missingKey_noRequest() = runTest {
        var calls = 0
        val client = client(" ") { calls++; json("{}") }
        val missing = TmdbResult.Failed(TmdbFailure.MissingKey)
        assertEquals(missing, client.createGuestSession())
        assertEquals(missing, client.rateMovie("g1", 278, 8.0))
        assertEquals(missing, client.removeRating("g1", 278))
        assertEquals(missing, client.ratedMovies("g1"))
        assertEquals(0, calls)
    }

    @Test
    fun guestCalls_simulatedOffline_noRequest() = runTest {
        var calls = 0
        val client = client("k", { Simulation(offline = true) }) { calls++; json("{}") }
        val offline = TmdbResult.Failed(TmdbFailure.NoConnection)
        assertEquals(offline, client.createGuestSession())
        assertEquals(offline, client.rateMovie("g1", 278, 8.0))
        assertEquals(offline, client.removeRating("g1", 278))
        assertEquals(offline, client.ratedMovies("g1"))
        assertEquals(0, calls)
    }

    @Test
    fun rateMovie_404_isServerError() = runTest {
        val body = """{"success":false,"status_code":34,"status_message":"The resource you requested could not be found."}"""
        val result = client("k") { json(body, HttpStatusCode.NotFound) }.rateMovie("g1", 999999999, 8.0)
        assertEquals(TmdbResult.Failed(TmdbFailure.ServerError), result)
    }
}
