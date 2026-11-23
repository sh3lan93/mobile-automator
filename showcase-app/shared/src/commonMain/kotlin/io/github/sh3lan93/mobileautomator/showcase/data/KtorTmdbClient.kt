package io.github.sh3lan93.mobileautomator.showcase.data

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.expectSuccess
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
 */
class KtorTmdbClient(private val http: HttpClient, apiKey: String) : TmdbClient {

    private val apiKey = apiKey.trim()

    override suspend fun popularMovies(): TmdbResult<List<Movie>> =
        call("movie/popular") { response ->
            response.body<PageDto>().results.map { it.toMovie() }
        }

    private suspend fun <T> call(path: String, parse: suspend (HttpResponse) -> T): TmdbResult<T> {
        if (apiKey.isEmpty()) return TmdbResult.Failed(TmdbFailure.MissingKey)
        return try {
            val response = http.get("$BASE_URL/$path") {
                expectSuccess = false
                parameter("api_key", apiKey)
                parameter("language", "en-US")
                parameter("page", 1)
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
    private data class PageDto(val results: List<MovieDto> = emptyList())

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
            releaseYear = releaseDate?.trim()?.takeIf { it.length >= 4 }?.take(4),
            posterUrl = posterPath?.takeIf { it.isNotBlank() }?.let { POSTER_BASE_URL + it },
        )
    }

    private companion object {
        const val BASE_URL = "https://api.themoviedb.org/3"
        const val POSTER_BASE_URL = "https://image.tmdb.org/t/p/w342"
    }
}
