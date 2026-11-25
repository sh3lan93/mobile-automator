package io.github.sh3lan93.mobileautomator.showcase.data

/** A film as the app shows it. A missing release date or poster stays `null`; the film is still listed. */
data class Movie(val id: Int, val title: String, val releaseYear: String?, val posterUrl: String?)

/**
 * One film's details screen. Each optional line is `null` (or empty) when TMDB leaves it out,
 * so the screen omits it instead of showing `null` or `0 min`.
 */
data class MovieDetails(
    val id: Int,
    val title: String,
    val releaseYear: String?,
    /** `null` when missing or 0. */
    val runtimeMinutes: Int?,
    /** Empty when missing. */
    val genres: List<String>,
    /** `null` when missing or blank. */
    val overview: String?,
    val posterUrl: String?,
)

/** A first page of results (a search or a discover call), and TMDB's count of every match (shown as the count line). */
data class SearchPage(val movies: List<Movie>, val totalResults: Int)

/** A film the guest session rated; [rating] is TMDB's value, 0.5..10. */
data class RatedMovie(val movie: Movie, val rating: Double)

/** The film as lists and the watchlist hold it: the fields a row shows. */
fun MovieDetails.toMovie() = Movie(id, title, releaseYear, posterUrl)
