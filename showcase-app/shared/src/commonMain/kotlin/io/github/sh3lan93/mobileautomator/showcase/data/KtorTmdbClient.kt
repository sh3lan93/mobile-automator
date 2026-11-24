package io.github.sh3lan93.mobileautomator.showcase.data

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.expectSuccess
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.parameter
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.coroutines.CancellationException
import kotlinx.io.IOException
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * [TmdbClient] over Ktor. Uses the v3 `api_key` query parameter, never a bearer token.
 * [http] must have ContentNegotiation with a JSON that ignores unknown keys.
 * [simulation] is a function rather than the store so the client stays independent of persistence.
 */
class KtorTmdbClient(
    private val http: HttpClient,
    apiKey: String,
    private val simulation: () -> Simulation = { Simulation() },
) : TmdbClient {

    private val apiKey = apiKey.trim()

    override suspend fun popularMovies(): TmdbResult<List<Movie>> =
        call("movie/popular", params = {
            parameter("language", "en-US")
            parameter("page", 1)
        }) { response ->
            response.body<PageDto>().results.map { it.toMovie() }
        }

    override suspend fun searchMovies(query: String): TmdbResult<SearchPage> =
        call("search/movie", params = {
            parameter("query", query)
            parameter("include_adult", false)
            parameter("language", "en-US")
            parameter("page", 1)
        }) { response ->
            response.body<PageDto>().toSearchPage()
        }

    override suspend fun movieDetails(id: Int): TmdbResult<MovieDetails> =
        call("movie/$id", params = {
            parameter("language", "en-US")
        }) { response ->
            response.body<DetailsDto>().toDetails()
        }

    override suspend fun discoverMovies(query: Map<String, String>): TmdbResult<SearchPage> =
        call("discover/movie", params = {
            query.forEach { (name, value) -> parameter(name, value) }
        }) { response ->
            response.body<PageDto>().toSearchPage()
        }

    override suspend fun movieGenres(): TmdbResult<List<Genre>> =
        call("genre/movie/list", params = {
            parameter("language", "en-US")
        }) { response ->
            response.body<GenresDto>().genres.map { Genre(it.id, it.name) }
        }

    override suspend fun createGuestSession(): TmdbResult<String> =
        call("authentication/guest_session/new") { response ->
            response.body<GuestSessionDto>().guestSessionId
        }

    override suspend fun rateMovie(sessionId: String, movieId: Int, value: Double): TmdbResult<GuestCall<Unit>> =
        guestCall(
            "movie/$movieId/rating",
            method = HttpMethod.Post,
            params = { parameter("guest_session_id", sessionId) },
            body = RatingBodyDto(value),
        ) { GuestCall.Done(Unit) }

    override suspend fun removeRating(sessionId: String, movieId: Int): TmdbResult<GuestCall<Unit>> =
        guestCall(
            "movie/$movieId/rating",
            method = HttpMethod.Delete,
            params = { parameter("guest_session_id", sessionId) },
        ) { GuestCall.Done(Unit) }

    override suspend fun ratedMovies(sessionId: String): TmdbResult<GuestCall<List<RatedMovie>>> =
        guestCall(
            "guest_session/$sessionId/rated/movies",
            params = {
                parameter("language", "en-US")
                parameter("page", 1)
                parameter("sort_by", "created_at.asc")
            },
            // TMDB answers 404 (status_code 34), not an empty page, for a session that rated nothing.
            notFound = GuestCall.Done(emptyList()),
        ) { response ->
            GuestCall.Done(response.body<PageDto>().results.mapNotNull { dto -> dto.rating?.let { RatedMovie(dto.toMovie(), it) } })
        }

    /**
     * A call that acts on a guest session (the caller puts the session id in [path] or [params]).
     * A 401 whose body says status_code 3 (an unknown or expired guest session) is
     * [GuestCall.SessionExpired]; with [notFound], a 404 is that value. Every other non-2xx keeps
     * [call]'s mapping, so a 401 for a bad key (TMDB's 7) is still [TmdbFailure.RejectedKey].
     */
    private suspend fun <T> guestCall(
        path: String,
        method: HttpMethod = HttpMethod.Get,
        params: HttpRequestBuilder.() -> Unit = {},
        body: Any? = null,
        notFound: GuestCall<T>? = null,
        parse: suspend (HttpResponse) -> GuestCall<T>,
    ): TmdbResult<GuestCall<T>> = call(
        path,
        params = params,
        method = method,
        body = body,
        recover = { response ->
            when (response.status) {
                HttpStatusCode.Unauthorized -> GuestCall.SessionExpired.takeIf { statusCodeOf(response) == SESSION_DENIED }
                HttpStatusCode.NotFound -> notFound
                else -> null
            }
        },
        parse = parse,
    )

    /**
     * Sends `api_key` on every request; [params] adds the endpoint's own query parameters.
     * [body] is sent as JSON. A non-2xx response goes to [recover] first; when it returns `null`,
     * a 401 is [TmdbFailure.RejectedKey] and any other non-2xx [TmdbFailure.ServerError].
     */
    private suspend fun <T : Any> call(
        path: String,
        params: HttpRequestBuilder.() -> Unit = {},
        method: HttpMethod = HttpMethod.Get,
        body: Any? = null,
        recover: suspend (HttpResponse) -> T? = { null },
        parse: suspend (HttpResponse) -> T,
    ): TmdbResult<T> {
        if (apiKey.isEmpty()) return TmdbResult.Failed(TmdbFailure.MissingKey)
        // Read per call so turning a switch off makes the next retry reach the network.
        val simulated = simulation()
        if (simulated.offline) return TmdbResult.Failed(TmdbFailure.NoConnection)
        if (simulated.serverError) return TmdbResult.Failed(TmdbFailure.ServerError)
        return try {
            val response = http.request("$BASE_URL/$path") {
                this.method = method
                expectSuccess = false
                parameter("api_key", apiKey)
                params()
                if (body != null) {
                    contentType(ContentType.Application.Json)
                    setBody(body)
                }
            }
            if (response.status.isSuccess()) {
                TmdbResult.Ok(parse(response))
            } else {
                recover(response)?.let { TmdbResult.Ok(it) } ?: TmdbResult.Failed(
                    if (response.status == HttpStatusCode.Unauthorized) TmdbFailure.RejectedKey else TmdbFailure.ServerError,
                )
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            // Engine I/O failures, including Ktor's connect/request timeouts (IOException subtypes).
            TmdbResult.Failed(TmdbFailure.NoConnection)
        } catch (e: Exception) {
            // A 2xx body that does not parse.
            TmdbResult.Failed(TmdbFailure.ServerError)
        }
    }

    /** TMDB's `status_code` from an error body; `null` when the body does not parse. */
    private suspend fun statusCodeOf(response: HttpResponse): Int? = try {
        response.body<StatusDto>().statusCode
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    @Serializable
    private data class StatusDto(@SerialName("status_code") val statusCode: Int? = null)

    @Serializable
    private data class GuestSessionDto(@SerialName("guest_session_id") val guestSessionId: String)

    @Serializable
    private data class RatingBodyDto(val value: Double)

    @Serializable
    private data class PageDto(
        val results: List<MovieDto> = emptyList(),
        @SerialName("total_results") val totalResults: Int = 0,
    ) {
        fun toSearchPage() = SearchPage(results.map { it.toMovie() }, totalResults)
    }

    @Serializable
    private data class MovieDto(
        val id: Int,
        val title: String,
        @SerialName("release_date") val releaseDate: String? = null,
        @SerialName("poster_path") val posterPath: String? = null,
        /** Only on a guest session's rated list. */
        val rating: Double? = null,
    ) {
        fun toMovie() = Movie(
            id = id,
            title = title,
            releaseYear = releaseYearOf(releaseDate),
            posterUrl = posterUrlOf(posterPath),
        )
    }

    @Serializable
    private data class DetailsDto(
        val id: Int,
        val title: String,
        @SerialName("release_date") val releaseDate: String? = null,
        @SerialName("poster_path") val posterPath: String? = null,
        val runtime: Int? = null,
        val genres: List<GenreDto> = emptyList(),
        val overview: String? = null,
    ) {
        fun toDetails() = MovieDetails(
            id = id,
            title = title,
            releaseYear = releaseYearOf(releaseDate),
            runtimeMinutes = runtime?.takeIf { it > 0 },
            genres = genres.map { it.name },
            overview = overview?.trim()?.takeIf { it.isNotEmpty() },
            posterUrl = posterUrlOf(posterPath),
        )
    }

    @Serializable
    private data class GenreDto(val name: String)

    @Serializable
    private data class GenresDto(val genres: List<GenreListItemDto> = emptyList())

    @Serializable
    private data class GenreListItemDto(val id: Int, val name: String)

    private companion object {
        const val BASE_URL = "https://api.themoviedb.org/3"
        const val POSTER_BASE_URL = "https://image.tmdb.org/t/p/w342"

        /** TMDB's status_code for an unknown or expired session on a 401. */
        const val SESSION_DENIED = 3

        /** `"1999-03-31"` → `"1999"`; blank or short dates → `null`. */
        fun releaseYearOf(releaseDate: String?): String? =
            releaseDate?.trim()?.takeIf { it.length >= 4 }?.take(4)

        fun posterUrlOf(posterPath: String?): String? =
            posterPath?.takeIf { it.isNotBlank() }?.let { POSTER_BASE_URL + it }
    }
}
