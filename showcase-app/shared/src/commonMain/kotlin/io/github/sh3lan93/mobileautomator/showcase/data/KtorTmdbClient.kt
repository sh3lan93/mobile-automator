package io.github.sh3lan93.mobileautomator.showcase.data

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.expectSuccess
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.client.statement.HttpResponse
import io.ktor.http.HttpStatusCode
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
            val page = response.body<PageDto>()
            SearchPage(page.results.map { it.toMovie() }, page.totalResults)
        }

    override suspend fun movieDetails(id: Int): TmdbResult<MovieDetails> =
        call("movie/$id", params = {
            parameter("language", "en-US")
        }) { response ->
            response.body<DetailsDto>().toDetails()
        }

    /** Sends `api_key` on every request; [params] adds the endpoint's own query parameters. */
    private suspend fun <T> call(
        path: String,
        params: HttpRequestBuilder.() -> Unit = {},
        parse: suspend (HttpResponse) -> T,
    ): TmdbResult<T> {
        if (apiKey.isEmpty()) return TmdbResult.Failed(TmdbFailure.MissingKey)
        // Read per call so turning a switch off makes the next retry reach the network.
        val simulated = simulation()
        if (simulated.offline) return TmdbResult.Failed(TmdbFailure.NoConnection)
        if (simulated.serverError) return TmdbResult.Failed(TmdbFailure.ServerError)
        return try {
            val response = http.get("$BASE_URL/$path") {
                expectSuccess = false
                parameter("api_key", apiKey)
                params()
            }
            when {
                response.status == HttpStatusCode.Unauthorized -> TmdbResult.Failed(TmdbFailure.RejectedKey)
                !response.status.isSuccess() -> TmdbResult.Failed(TmdbFailure.ServerError)
                else -> TmdbResult.Ok(parse(response))
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

    @Serializable
    private data class PageDto(
        val results: List<MovieDto> = emptyList(),
        @SerialName("total_results") val totalResults: Int = 0,
    )

    @Serializable
    private data class MovieDto(
        val id: Int,
        val title: String,
        @SerialName("release_date") val releaseDate: String? = null,
        @SerialName("poster_path") val posterPath: String? = null,
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

    private companion object {
        const val BASE_URL = "https://api.themoviedb.org/3"
        const val POSTER_BASE_URL = "https://image.tmdb.org/t/p/w342"

        /** `"1999-03-31"` → `"1999"`; blank or short dates → `null`. */
        fun releaseYearOf(releaseDate: String?): String? =
            releaseDate?.trim()?.takeIf { it.length >= 4 }?.take(4)

        fun posterUrlOf(posterPath: String?): String? =
            posterPath?.takeIf { it.isNotBlank() }?.let { POSTER_BASE_URL + it }
    }
}
