package io.github.sh3lan93.mobileautomator.showcase.screens.about

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.sh3lan93.mobileautomator.showcase.resources.Res
import io.github.sh3lan93.mobileautomator.showcase.resources.tmdb_logo
import org.jetbrains.compose.resources.painterResource

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AboutScreen(onBack: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("About") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("Reel Tracker", style = MaterialTheme.typography.headlineMedium)
            Text("Reel Tracker is a demonstration app for mobile-automator.", style = MaterialTheme.typography.bodyLarge)
            // TMDB attribution: the logo stays less prominent than the app's own heading.
            Image(
                painter = painterResource(Res.drawable.tmdb_logo),
                contentDescription = "TMDB logo",
                modifier = Modifier.height(16.dp),
            )
            Text(
                "This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.",
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}
