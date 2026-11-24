package io.github.sh3lan93.mobileautomator.showcase.data

/** A TMDB film genre, as its genre list returns it. */
data class Genre(val id: Int, val name: String)

/** The popular list's sort orders: [label] is the chip text, [sortBy] TMDB's `sort_by` value. */
enum class Sort(val label: String, val sortBy: String) {
    MostPopular("Most popular", "popularity.desc"),
    HighestRated("Highest rated", "vote_average.desc"),
    MostVotes("Most votes", "vote_count.desc"),
    TopGrossing("Top grossing", "revenue.desc"),
}

/**
 * The fewest votes a film needs whenever the rating matters (a minimum rating, or the
 * [Sort.HighestRated] order); without it, films with one 10/10 vote top the list.
 */
const val MIN_VOTES_FOR_RATING = 200

/** The minimum-rating choices: `N` means an average of N or more. */
val RATING_STEPS = 5..9

private const val FIRST_DECADE = 1930

/**
 * The list's filters and sort order. `null` means "any". The default value is the plain
 * popular list ([isDefault]); anything else is a TMDB discover call ([toDiscoverQuery]).
 */
data class FilterState(
    val genre: Genre? = null,
    val year: Int? = null,
    /** One of [RATING_STEPS]: an average vote of at least this. */
    val minRating: Int? = null,
    val sort: Sort = Sort.MostPopular,
) {
    val isDefault: Boolean get() = this == FilterState()

    /** The discover endpoint's query parameters for this state. Never carries `api_key`. */
    fun toDiscoverQuery(): Map<String, String> = buildMap {
        put("sort_by", sort.sortBy)
        put("include_adult", "false")
        put("language", "en-US")
        put("page", "1")
        genre?.let { put("with_genres", it.id.toString()) }
        year?.let { put("primary_release_year", it.toString()) }
        minRating?.let { put("vote_average.gte", it.toString()) }
        if (minRating != null || sort == Sort.HighestRated) {
            put("vote_count.gte", MIN_VOTES_FOR_RATING.toString())
        }
    }

    /**
     * The set parts in a fixed order (genre, year, rating, then sort when not the default),
     * joined by ` · `; `All films` when nothing is set.
     */
    fun activeFiltersText(): String {
        val parts = listOfNotNull(
            genre?.name,
            year?.toString(),
            minRating?.let { "Rated $it+" },
            sort.takeIf { it != Sort.MostPopular }?.label,
        )
        return if (parts.isEmpty()) "All films" else parts.joinToString(" · ")
    }
}

/** Every decade's first year from the 1930s up to [currentYear]'s decade. */
fun decades(currentYear: Int): List<Int> = (FIRST_DECADE..(currentYear - currentYear % 10) step 10).toList()

/** [decade]'s years, none later than [currentYear]. */
fun yearsOf(decade: Int, currentYear: Int): List<Int> = (decade..minOf(decade + 9, currentYear)).toList()
