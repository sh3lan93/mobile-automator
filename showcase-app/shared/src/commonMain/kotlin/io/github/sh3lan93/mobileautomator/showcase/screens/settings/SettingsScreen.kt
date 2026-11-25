package io.github.sh3lan93.mobileautomator.showcase.screens.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.sh3lan93.mobileautomator.showcase.screens.common.BackTopBar
import org.koin.compose.viewmodel.koinViewModel

@Composable
fun SettingsScreen(onBack: () -> Unit, onReset: () -> Unit, viewModel: SettingsViewModel = koinViewModel()) {
    val offline by viewModel.simulateOffline.collectAsStateWithLifecycle()
    val serverError by viewModel.simulateServerError.collectAsStateWithLifecycle()
    val compactDetails by viewModel.compactDetails.collectAsStateWithLifecycle()
    val confirmRemoval by viewModel.confirmWatchlistRemoval.collectAsStateWithLifecycle()
    Scaffold(
        topBar = {
            BackTopBar("Settings", onBack)
        },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                "Simulation",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 24.dp),
            )
            // Each row states its own on/off in text, so scenarios assert the words, never the switch state.
            SwitchRow(
                label = "Simulate offline",
                status = if (offline) "Offline simulation is on" else "Offline simulation is off",
                checked = offline,
                onCheckedChange = viewModel::setSimulateOffline,
            )
            SwitchRow(
                label = "Simulate server error",
                status = if (serverError) "Server error simulation is on" else "Server error simulation is off",
                checked = serverError,
                onCheckedChange = viewModel::setSimulateServerError,
            )
            Column(
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(onClick = {
                    viewModel.resetAppData()
                    onReset()
                }) { Text("Reset app data") }
                Text(
                    "Clears everything the app saved on this device and returns to the start.",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            // Below Reset app data, so the button every scenario taps never moves.
            Text(
                "Feature flags",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 24.dp),
            )
            ChoiceGroup(
                label = "Details screen",
                choices = listOf(
                    Choice("Classic layout", false, status = "Details layout in use: classic"),
                    Choice("Compact layout", true, status = "Details layout in use: compact"),
                ),
                selected = compactDetails,
                onSelect = viewModel::setCompactDetails,
            )
            ChoiceGroup(
                label = "Removing from the watchlist",
                choices = listOf(
                    Choice("Remove at once", false, status = "Watchlist removal is immediate"),
                    Choice("Ask first", true, status = "Watchlist removal needs confirmation"),
                ),
                selected = confirmRemoval,
                onSelect = viewModel::setConfirmWatchlistRemoval,
            )
        }
    }
}

/** One option of a flag: the text to tap, the flag value it sets, and the status line shown while it is chosen. */
private class Choice<T>(val text: String, val value: T, val status: String)

/**
 * One flag: its label, one radio-style row per [choices] entry, and the chosen entry's status line,
 * which states the setting in words since selected state does not reach scenarios.
 * Choosing the option already chosen is a no-op.
 */
@Composable
private fun <T> ChoiceGroup(label: String, choices: List<Choice<T>>, selected: T, onSelect: (T) -> Unit) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(horizontal = 24.dp))
        choices.forEach { choice ->
            OptionRow(choice.text, selected = choice.value == selected) { onSelect(choice.value) }
        }
        choices.firstOrNull { it.value == selected }?.let {
            Text(it.status, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(horizontal = 24.dp))
        }
    }
}

/** One selectable row, so tapping the option text selects it too. */
@Composable
private fun OptionRow(text: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = 24.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = null)
        Text(text, style = MaterialTheme.typography.bodyLarge)
    }
}

/** One toggleable row, so tapping the label text toggles the switch too. */
@Composable
private fun SwitchRow(label: String, status: String, checked: Boolean, onCheckedChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .toggleable(value = checked, role = Role.Switch, onValueChange = onCheckedChange)
            .padding(horizontal = 24.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            Text(status, style = MaterialTheme.typography.bodyMedium)
        }
        Switch(checked = checked, onCheckedChange = null)
    }
}
