package io.github.sh3lan93.mobileautomator.showcase.data

/** A film as the app shows it. A missing release date or poster stays `null`; the film is still listed. */
data class Movie(val id: Int, val title: String, val releaseYear: String?, val posterUrl: String?)
