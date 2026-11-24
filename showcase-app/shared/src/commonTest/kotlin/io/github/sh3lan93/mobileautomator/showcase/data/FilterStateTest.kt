package io.github.sh3lan93.mobileautomator.showcase.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class FilterStateTest {

    private val drama = Genre(18, "Drama")
    private val animation = Genre(16, "Animation")

    private val base = mapOf(
        "include_adult" to "false",
        "language" to "en-US",
        "page" to "1",
    )

    @Test
    fun default_queriesPopularityWithNoFilterKeys() {
        val state = FilterState()
        assertTrue(state.isDefault)
        assertEquals(base + ("sort_by" to "popularity.desc"), state.toDiscoverQuery())
    }

    @Test
    fun anySetField_isNotDefault() {
        assertFalse(FilterState(genre = drama).isDefault)
        assertFalse(FilterState(year = 1994).isDefault)
        assertFalse(FilterState(minRating = 8).isDefault)
        assertFalse(FilterState(sort = Sort.MostVotes).isDefault)
    }

    @Test
    fun genreAlone_addsWithGenres() {
        assertEquals(
            base + mapOf("sort_by" to "popularity.desc", "with_genres" to "18"),
            FilterState(genre = drama).toDiscoverQuery(),
        )
    }

    @Test
    fun yearAlone_addsPrimaryReleaseYear() {
        assertEquals(
            base + mapOf("sort_by" to "popularity.desc", "primary_release_year" to "1994"),
            FilterState(year = 1994).toDiscoverQuery(),
        )
    }

    @Test
    fun ratingAlone_addsAverageAndVoteFloor() {
        assertEquals(
            base + mapOf(
                "sort_by" to "popularity.desc",
                "vote_average.gte" to "8",
                "vote_count.gte" to "$MIN_VOTES_FOR_RATING",
            ),
            FilterState(minRating = 8).toDiscoverQuery(),
        )
    }

    @Test
    fun highestRated_addsVoteFloor() {
        assertEquals(
            base + mapOf("sort_by" to "vote_average.desc", "vote_count.gte" to "200"),
            FilterState(sort = Sort.HighestRated).toDiscoverQuery(),
        )
    }

    @Test
    fun otherSorts_haveNoVoteFloor() {
        for (sort in listOf(Sort.MostPopular, Sort.MostVotes, Sort.TopGrossing)) {
            val query = FilterState(sort = sort).toDiscoverQuery()
            assertEquals(base + ("sort_by" to sort.sortBy), query, "for $sort")
        }
        assertEquals("vote_count.desc", Sort.MostVotes.sortBy)
        assertEquals("revenue.desc", Sort.TopGrossing.sortBy)
    }

    @Test
    fun fullCombination() {
        val state = FilterState(genre = drama, year = 1994, minRating = 8, sort = Sort.HighestRated)
        assertEquals(
            base + mapOf(
                "sort_by" to "vote_average.desc",
                "with_genres" to "18",
                "primary_release_year" to "1994",
                "vote_average.gte" to "8",
                "vote_count.gte" to "200",
            ),
            state.toDiscoverQuery(),
        )
    }

    @Test
    fun query_neverCarriesApiKey() {
        val state = FilterState(genre = drama, year = 1994, minRating = 8, sort = Sort.HighestRated)
        assertFalse("api_key" in state.toDiscoverQuery())
        assertFalse("api_key" in FilterState().toDiscoverQuery())
    }

    @Test
    fun activeFiltersText() {
        assertEquals("All films", FilterState().activeFiltersText())
        assertEquals(
            "Drama · 1994 · Rated 8+ · Highest rated",
            FilterState(genre = drama, year = 1994, minRating = 8, sort = Sort.HighestRated).activeFiltersText(),
        )
        assertEquals("Most votes", FilterState(sort = Sort.MostVotes).activeFiltersText())
        assertEquals(
            "Animation · 1931 · Rated 9+",
            FilterState(genre = animation, year = 1931, minRating = 9).activeFiltersText(),
        )
    }

    @Test
    fun sortLabels() {
        assertEquals(
            listOf("Most popular", "Highest rated", "Most votes", "Top grossing"),
            Sort.entries.map { it.label },
        )
    }

    @Test
    fun ratingSteps_areFiveToNine() {
        assertEquals(listOf(5, 6, 7, 8, 9), RATING_STEPS.toList())
    }

    @Test
    fun decades_runFrom1930sToCurrentDecade() {
        assertEquals(listOf(1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020), decades(2026))
    }

    @Test
    fun decadeLabel_isApostropheTwoDigitsAndS() {
        assertEquals("'90s", decadeLabel(1990))
        assertEquals("'00s", decadeLabel(2000))
        assertEquals("'20s", decadeLabel(2020))
    }

    @Test
    fun noYear_isASubstringOfAnyDecadeLabel() {
        val labels = decades(2026).map(::decadeLabel)
        for (year in decades(2026).flatMap { yearsOf(it, 2026) }) {
            for (label in labels) {
                assertFalse(label.contains(year.toString(), ignoreCase = true), "$year inside $label")
            }
        }
    }

    @Test
    fun yearsOf_currentDecade_isCappedAtCurrentYear() {
        assertEquals((2020..2026).toList(), yearsOf(2020, 2026))
    }

    @Test
    fun yearsOf_pastDecade_isTenYears() {
        assertEquals((1990..1999).toList(), yearsOf(1990, 2026))
    }
}
