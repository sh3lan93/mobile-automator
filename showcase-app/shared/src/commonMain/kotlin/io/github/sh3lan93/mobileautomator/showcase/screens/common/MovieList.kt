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

/** A count line ([countLine]) above one clickable row per film; a row opens the film by id. */
@Composable
fun MovieList(movies: List<Movie>, countLine: String, onOpen: (Int) -> Unit, modifier: Modifier = Modifier) {
    LazyColumn(modifier = modifier) {
        item {
            Text(
                countLine,
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
        }
        items(movies, key = { it.id }) { movie ->
            MovieRow(movie, onClick = { onOpen(movie.id) })
            HorizontalDivider()
        }
    }
}

@Composable
private fun MovieRow(movie: Movie, onClick: () -> Unit) {
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
            // A film with no release date shows no year line at all.
            movie.releaseYear?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        }
    }
}
