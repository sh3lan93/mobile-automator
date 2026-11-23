package io.github.sh3lan93.mobileautomator.showcase.data

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
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
        handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData,
    ): KtorTmdbClient {
        val http = HttpClient(MockEngine { request -> handler(request) }) {
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) }
        }
        return KtorTmdbClient(http, key)
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
}
