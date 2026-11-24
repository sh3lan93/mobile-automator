package io.github.sh3lan93.mobileautomator.showcase.screens.filters

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.sh3lan93.mobileautomator.showcase.data.FilterState
import io.github.sh3lan93.mobileautomator.showcase.data.RATING_STEPS
import io.github.sh3lan93.mobileautomator.showcase.data.Sort
import io.github.sh3lan93.mobileautomator.showcase.data.decadeLabel
import io.github.sh3lan93.mobileautomator.showcase.data.decades
import io.github.sh3lan93.mobileautomator.showcase.data.yearsOf
import io.github.sh3lan93.mobileautomator.showcase.screens.popular.PopularViewModel
import org.koin.compose.viewmodel.koinViewModel

/**
 * Edits the list's filters on [popularViewModel] (the popular screen's own instance): every chip
 * tap applies at once, so the list behind is already up to date when the user goes back. Tapping
 * a selected chip clears that choice. The active-filters text is deliberately not shown here: it
 * repeats chip labels, and a scenario tapping a label must find only the chip.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FiltersScreen(
    onBack: () -> Unit,
    popularViewModel: PopularViewModel,
    viewModel: FiltersViewModel = koinViewModel(),
) {
    val filters by popularViewModel.filters.collectAsStateWithLifecycle()
    val genres by viewModel.genres.collectAsStateWithLifecycle()
    // The decade whose years are listed. UI state only: choosing a decade alone filters nothing.
    var decade by rememberSaveable { mutableStateOf(filters.year?.let { it - it % 10 }) }
    val apply: (FilterState) -> Unit = popularViewModel::setFilters

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Filters") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    TextButton(onClick = {
                        decade = null
                        apply(FilterState())
                    }) { Text("Clear") }
                    TextButton(onClick = onBack) { Text("Done") }
                },
            )
        },
    ) { padding ->
        // Compact chips (no 48dp touch-target padding) so every section fits one phone screen
        // and no scenario needs to scroll; the scroll is only a safety net for small screens.
        CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides Dp.Unspecified) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Section("Sort by") {
                    Sort.entries.forEach { sort ->
                        Chip(sort.label, selected = filters.sort == sort) {
                            apply(filters.withSortToggled(sort))
                        }
                    }
                }
                Section("Minimum rating") {
                    Chip("Any rating", selected = filters.minRating == null) {
                        apply(filters.copy(minRating = null))
                    }
                    RATING_STEPS.forEach { rating ->
                        Chip("$rating+", selected = filters.minRating == rating) {
                            apply(filters.withRatingToggled(rating))
                        }
                    }
                }
                Section("Release year") {
                    Chip("Any year", selected = filters.year == null && decade == null) {
                        decade = null
                        apply(filters.copy(year = null))
                    }
                    decades(viewModel.currentYear).forEach { start ->
                        Chip(decadeLabel(start), selected = decade == start) { decade = start }
                    }
                }
                decade?.let { start ->
                    ChipRow {
                        yearsOf(start, viewModel.currentYear).forEach { year ->
                            Chip(year.toString(), selected = filters.year == year) {
                                apply(filters.withYearToggled(year))
                            }
                        }
                    }
                }
                Section("Genre") {
                    when (val g = genres) {
                        GenresUiState.Loading -> Text("Loading genres…")
                        is GenresUiState.Failed -> Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Genres could not load")
                            TextButton(onClick = viewModel::retry) { Text("Retry") }
                        }
                        is GenresUiState.Loaded -> {
                            Chip("Any genre", selected = filters.genre == null) {
                                apply(filters.copy(genre = null))
                            }
                            g.genres.forEach { genre ->
                                Chip(genre.name, selected = filters.genre?.id == genre.id) {
                                    apply(filters.withGenreToggled(genre))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Section(heading: String, content: @Composable () -> Unit) {
    Text(heading, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 4.dp))
    ChipRow(content)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChipRow(content: @Composable () -> Unit) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) { content() }
}

@Composable
private fun Chip(label: String, selected: Boolean, onClick: () -> Unit) {
    FilterChip(selected = selected, onClick = onClick, label = { Text(label) })
}
