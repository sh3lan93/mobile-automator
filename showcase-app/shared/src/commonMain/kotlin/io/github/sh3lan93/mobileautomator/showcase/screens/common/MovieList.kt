package io.github.sh3lan93.mobileautomator.showcase.screens.common

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import io.github.sh3lan93.mobileautomator.showcase.data.Movie

/** The count line both list screens show: `1 film`, `<n> films`. */
fun filmCount(n: Int): String = if (n == 1) "1 film" else "$n films"

/** The count line on My ratings: `1 rated film`, `<n> rated films`. */
fun ratedFilmCount(n: Int): String = if (n == 1) "1 rated film" else "$n rated films"

/** `8.0` → `"Your rating: 8/10"`, `6.5` → `"Your rating: 6.5/10"`: the one formatter both screens use. */
fun ratingText(value: Double): String {
    val number = if (value % 1.0 == 0.0) value.toInt().toString() else value.toString()
    return "Your rating: $number/10"
}

/** One row of a [MovieList]: the film and its second line, the release year unless a screen says otherwise. */
data class MovieRowData(val movie: Movie, val supporting: String? = movie.releaseYear)

/** A count line ([countLine]) above one clickable row per film; a row opens the film by id. */
@Composable
fun MovieList(
    rows: List<MovieRowData>,
    countLine: String,
    onOpen: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(modifier = modifier) {
        item {
            Text(
                countLine,
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
        items(rows, key = { it.movie.id }) { row ->
            MovieRow(row, onClick = { onOpen(row.movie.id) })
            HorizontalDivider()
        }
    }
}

@Composable
private fun MovieRow(row: MovieRowData, onClick: () -> Unit) {
    val movie = row.movie
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AsyncImage(
            model = movie.posterUrl,
            contentDescription = movie.title,
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(width = 46.dp, height = 69.dp),
        )
        Column {
            Text(movie.title, style = MaterialTheme.typography.titleMedium)
            // No supporting text (a film with no release date) shows no second line at all.
            row.supporting?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        }
    }
}
