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

/** First page of a search, and TMDB's count of every match (shown as the count line). */
data class SearchPage(val movies: List<Movie>, val totalResults: Int)
