package io.github.sh3lan93.mobileautomator.showcase

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import io.github.sh3lan93.mobileautomator.showcase.screens.about.AboutScreen
import io.github.sh3lan93.mobileautomator.showcase.screens.popular.PopularScreen
import io.github.sh3lan93.mobileautomator.showcase.screens.settings.SettingsScreen

private const val ROUTE_POPULAR = "popular"
private const val ROUTE_ABOUT = "about"
private const val ROUTE_SETTINGS = "settings"

@Composable
fun App() {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()
    ) {
        Surface {
            val navController = rememberNavController()
            NavHost(navController = navController, startDestination = ROUTE_POPULAR) {
                composable(ROUTE_POPULAR) {
                    PopularScreen(
                        onSettings = { navController.navigate(ROUTE_SETTINGS) },
                        onAbout = { navController.navigate(ROUTE_ABOUT) },
                    )
                }
                composable(ROUTE_SETTINGS) {
                    SettingsScreen(
                        onBack = { navController.popBackStack() },
                        // Clearing the whole back stack recreates every screen's view model, so nothing
                        // shown before the reset survives it: the app is back at its first-launch state.
                        onReset = {
                            navController.navigate(ROUTE_POPULAR) {
                                popUpTo(navController.graph.id) { inclusive = true }
                            }
                        },
                    )
                }
                composable(ROUTE_ABOUT) {
                    AboutScreen(onBack = { navController.popBackStack() })
                }
            }
        }
    }
}
