package io.github.sh3lan93.mobileautomator.showcase.data

/** One call made to a [FakeTmdbClient], with its argument. */
sealed interface TmdbCall {
    data object Popular : TmdbCall
    data class Search(val query: String) : TmdbCall
    data class Details(val id: Int) : TmdbCall
    data class Discover(val query: Map<String, String>) : TmdbCall
    data object Genres : TmdbCall
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
}
