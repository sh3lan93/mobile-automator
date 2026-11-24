package io.github.sh3lan93.mobileautomator.showcase.data

/** The only failures a screen ever sees from TMDB. */
enum class TmdbFailure { MissingKey, RejectedKey, NoConnection, ServerError }

sealed interface TmdbResult<out T> {
    data class Ok<T>(val value: T) : TmdbResult<T>
    data class Failed(val failure: TmdbFailure) : TmdbResult<Nothing>
}

/** Every remote TMDB call goes through here; transport and HTTP outcomes are mapped to [TmdbFailure]. */
interface TmdbClient {
    suspend fun popularMovies(): TmdbResult<List<Movie>>
}
