package io.github.sh3lan93.mobileautomator.showcase.data

/** One call made to a [FakeTmdbClient], with its argument. */
sealed interface TmdbCall {
    data object Popular : TmdbCall
    data class Search(val query: String) : TmdbCall
    data class Details(val id: Int) : TmdbCall
    data class Discover(val query: Map<String, String>) : TmdbCall
    data object Genres : TmdbCall
    data object CreateGuestSession : TmdbCall
    data class Rate(val sessionId: String, val movieId: Int, val value: Double) : TmdbCall
    data class RemoveRating(val sessionId: String, val movieId: Int) : TmdbCall
    data class RatedMovies(val sessionId: String) : TmdbCall
}

/**
 * The view-model tests' [TmdbClient]. Each member runs its `on…` lambda, which a test sets (and
 * may swap mid-test, or make suspend on a gate); an unset member fails the test. Every call is
 * recorded in [calls], in order, before its lambda runs.
 */
class FakeTmdbClient(
    var onPopularMovies: suspend () -> TmdbResult<List<Movie>> = { error("not used") },
    var onSearchMovies: suspend (query: String) -> TmdbResult<SearchPage> = { error("not used") },
    var onMovieDetails: suspend (id: Int) -> TmdbResult<MovieDetails> = { error("not used") },
    var onDiscoverMovies: suspend (query: Map<String, String>) -> TmdbResult<SearchPage> = { error("not used") },
    var onMovieGenres: suspend () -> TmdbResult<List<Genre>> = { error("not used") },
    var onCreateGuestSession: suspend () -> TmdbResult<String> = { error("not used") },
    var onRateMovie: suspend (sessionId: String, movieId: Int, value: Double) -> TmdbResult<GuestCall<Unit>> =
        { _, _, _ -> error("not used") },
    var onRemoveRating: suspend (sessionId: String, movieId: Int) -> TmdbResult<GuestCall<Unit>> =
        { _, _ -> error("not used") },
    var onRatedMovies: suspend (sessionId: String) -> TmdbResult<GuestCall<List<RatedMovie>>> = { error("not used") },
) : TmdbClient {
    val calls = mutableListOf<TmdbCall>()

    override suspend fun popularMovies(): TmdbResult<List<Movie>> {
        calls += TmdbCall.Popular
        return onPopularMovies()
    }

    override suspend fun searchMovies(query: String): TmdbResult<SearchPage> {
        calls += TmdbCall.Search(query)
        return onSearchMovies(query)
    }

    override suspend fun movieDetails(id: Int): TmdbResult<MovieDetails> {
        calls += TmdbCall.Details(id)
        return onMovieDetails(id)
    }

    override suspend fun discoverMovies(query: Map<String, String>): TmdbResult<SearchPage> {
        calls += TmdbCall.Discover(query)
        return onDiscoverMovies(query)
    }

    override suspend fun movieGenres(): TmdbResult<List<Genre>> {
        calls += TmdbCall.Genres
        return onMovieGenres()
    }

    override suspend fun createGuestSession(): TmdbResult<String> {
        calls += TmdbCall.CreateGuestSession
        return onCreateGuestSession()
    }

    override suspend fun rateMovie(sessionId: String, movieId: Int, value: Double): TmdbResult<GuestCall<Unit>> {
        calls += TmdbCall.Rate(sessionId, movieId, value)
        return onRateMovie(sessionId, movieId, value)
    }

    override suspend fun removeRating(sessionId: String, movieId: Int): TmdbResult<GuestCall<Unit>> {
        calls += TmdbCall.RemoveRating(sessionId, movieId)
        return onRemoveRating(sessionId, movieId)
    }

    override suspend fun ratedMovies(sessionId: String): TmdbResult<GuestCall<List<RatedMovie>>> {
        calls += TmdbCall.RatedMovies(sessionId)
        return onRatedMovies(sessionId)
    }
}
