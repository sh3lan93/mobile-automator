package io.github.sh3lan93.mobileautomator.showcase.screens.details

import io.github.sh3lan93.mobileautomator.showcase.data.MovieDetails
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class DetailsFormatTest {

    private val shawshank = MovieDetails(
        id = 278,
        title = "The Shawshank Redemption",
        releaseYear = "1994",
        runtimeMinutes = 142,
        genres = listOf("Drama", "Crime"),
        overview = "Two imprisoned men bond.",
        posterUrl = null,
    )

    @Test
    fun formatRuntime_hoursAndMinutes() = assertEquals("2h 22m", formatRuntime(142))

    @Test
    fun formatRuntime_wholeHours_dropsMinutes() = assertEquals("2h", formatRuntime(120))

    @Test
    fun formatRuntime_underAnHour_isMinutesOnly() = assertEquals("45m", formatRuntime(45))

    @Test
    fun compactFacts_joinsYearRuntimeAndGenres() =
        assertEquals("1994 · 2h 22m · Drama, Crime", compactFacts(shawshank))

    @Test
    fun compactFacts_skipsMissingParts() {
        assertEquals("2h 22m · Drama, Crime", compactFacts(shawshank.copy(releaseYear = null)))
        assertEquals("1994 · Drama, Crime", compactFacts(shawshank.copy(runtimeMinutes = null)))
        assertEquals("1994 · 2h 22m", compactFacts(shawshank.copy(genres = emptyList())))
        assertEquals("1994", compactFacts(shawshank.copy(runtimeMinutes = null, genres = emptyList())))
    }

    @Test
    fun compactFacts_nothingKnown_isNull() =
        assertNull(compactFacts(shawshank.copy(releaseYear = null, runtimeMinutes = null, genres = emptyList())))
}
