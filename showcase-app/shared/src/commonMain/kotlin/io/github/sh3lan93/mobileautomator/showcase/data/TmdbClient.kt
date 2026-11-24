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
    suspend fun searchMovies(query: String): TmdbResult<SearchPage>
    suspend fun movieDetails(id: Int): TmdbResult<MovieDetails>

    /** TMDB's discover endpoint with [query] as its parameters (see [FilterState.toDiscoverQuery]). */
    suspend fun discoverMovies(query: Map<String, String>): TmdbResult<SearchPage>

    /** TMDB's film genres, in TMDB's order. */
    suspend fun movieGenres(): TmdbResult<List<Genre>>
}
