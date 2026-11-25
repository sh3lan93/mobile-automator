package io.github.sh3lan93.mobileautomator.showcase.screens.details

import io.github.sh3lan93.mobileautomator.showcase.data.MovieDetails

/** A runtime as hours and minutes: `142` is `2h 22m`, `120` is `2h`, `45` is `45m`. */
fun formatRuntime(minutes: Int): String {
    val hours = minutes / 60
    val rest = minutes % 60
    return when {
        hours == 0 -> "${rest}m"
        rest == 0 -> "${hours}h"
        else -> "${hours}h ${rest}m"
    }
}

/**
 * The compact layout's one facts line: year, runtime and genres joined with ` · `, each part only
 * when TMDB sent it (`1994 · 2h 22m · Drama, Crime`); `null` when none was sent.
 */
fun compactFacts(details: MovieDetails): String? = listOfNotNull(
    details.releaseYear,
    details.runtimeMinutes?.let(::formatRuntime),
    details.genres.takeIf { it.isNotEmpty() }?.joinToString(", "),
).takeIf { it.isNotEmpty() }?.joinToString(" · ")
