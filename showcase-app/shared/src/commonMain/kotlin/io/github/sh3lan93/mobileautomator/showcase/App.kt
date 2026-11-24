package io.github.sh3lan93.mobileautomator.showcase

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import io.github.sh3lan93.mobileautomator.showcase.screens.about.AboutScreen
import io.github.sh3lan93.mobileautomator.showcase.screens.details.DetailsScreen
import io.github.sh3lan93.mobileautomator.showcase.screens.popular.PopularScreen
import io.github.sh3lan93.mobileautomator.showcase.screens.search.SearchScreen

private const val ROUTE_POPULAR = "popular"
private const val ROUTE_ABOUT = "about"
private const val ROUTE_SEARCH = "search"
private const val ARG_MOVIE_ID = "movieId"
private const val ROUTE_DETAILS = "details/{$ARG_MOVIE_ID}"

private fun detailsRoute(movieId: Int) = "details/$movieId"

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
                        onSearch = { navController.navigate(ROUTE_SEARCH) },
                        onAbout = { navController.navigate(ROUTE_ABOUT) },
                        onOpen = { id -> navController.navigate(detailsRoute(id)) },
                    )
                }
                composable(ROUTE_ABOUT) {
                    AboutScreen(onBack = { navController.popBackStack() })
                }
                // The Search ViewModel is scoped to this entry, so back from details keeps the query and results.
                composable(ROUTE_SEARCH) {
                    SearchScreen(
                        onBack = { navController.popBackStack() },
                        onOpen = { id -> navController.navigate(detailsRoute(id)) },
                    )
                }
                composable(
                    ROUTE_DETAILS,
                    arguments = listOf(navArgument(ARG_MOVIE_ID) { type = NavType.IntType }),
                ) { entry ->
                    DetailsScreen(
                        movieId = checkNotNull(entry.savedStateHandle.get<Int>(ARG_MOVIE_ID)),
                        onBack = { navController.popBackStack() },
                    )
                }
            }
        }
    }
}
