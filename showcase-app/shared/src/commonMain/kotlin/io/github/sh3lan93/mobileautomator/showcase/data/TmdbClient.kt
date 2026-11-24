package io.github.sh3lan93.mobileautomator.showcase.data

/** The only failures a screen ever sees from TMDB. */
enum class TmdbFailure { MissingKey, RejectedKey, NoConnection, ServerError }

sealed interface TmdbResult<out T> {
    data class Ok<T>(val value: T) : TmdbResult<T>
    data class Failed(val failure: TmdbFailure) : TmdbResult<Nothing>
}

/** A guest-session call either did its work or found that TMDB no longer accepts the session. */
sealed interface GuestCall<out T> {
    data class Done<T>(val value: T) : GuestCall<T>
    data object SessionExpired : GuestCall<Nothing>
}

/** Every remote TMDB call goes through here; transport and HTTP outcomes are mapped to [TmdbFailure]. */
interface TmdbClient {
    suspend fun popularMovies(): TmdbResult<List<Movie>>
    suspend fun searchMovies(query: String): TmdbResult<SearchPage>
    suspend fun movieDetails(id: Int): TmdbResult<MovieDetails>

    /** A new guest session's id. */
    suspend fun createGuestSession(): TmdbResult<String>
    suspend fun rateMovie(sessionId: String, movieId: Int, value: Double): TmdbResult<GuestCall<Unit>>
    suspend fun removeRating(sessionId: String, movieId: Int): TmdbResult<GuestCall<Unit>>
    /** The session's rated films, oldest rating first; empty when it has rated none. */
    suspend fun ratedMovies(sessionId: String): TmdbResult<GuestCall<List<RatedMovie>>>
}
