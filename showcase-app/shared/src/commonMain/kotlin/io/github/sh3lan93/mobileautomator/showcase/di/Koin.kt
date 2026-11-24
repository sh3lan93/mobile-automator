package io.github.sh3lan93.mobileautomator.showcase.di

import io.github.sh3lan93.mobileautomator.showcase.TMDB_API_KEY
import io.github.sh3lan93.mobileautomator.showcase.data.GuestRatings
import io.github.sh3lan93.mobileautomator.showcase.data.KtorTmdbClient
import io.github.sh3lan93.mobileautomator.showcase.data.TmdbClient
import io.github.sh3lan93.mobileautomator.showcase.screens.details.DetailsViewModel
import io.github.sh3lan93.mobileautomator.showcase.screens.details.RatingViewModel
import io.github.sh3lan93.mobileautomator.showcase.screens.popular.PopularViewModel
import io.github.sh3lan93.mobileautomator.showcase.screens.search.SearchViewModel
import io.github.sh3lan93.mobileautomator.showcase.screens.settings.SettingsViewModel
import io.github.sh3lan93.mobileautomator.showcase.store.LocalStore
import io.ktor.client.HttpClient
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json
import org.koin.core.context.startKoin
import org.koin.core.module.Module
import org.koin.core.module.dsl.viewModel
import org.koin.core.module.dsl.viewModelOf
import org.koin.dsl.module

val appModule = module {
    // No engine argument: Ktor picks the platform engine on the classpath (OkHttp on Android, Darwin on iOS).
    single {
        HttpClient {
            install(ContentNegotiation) {
                json(Json { ignoreUnknownKeys = true })
            }
        }
    }
    single { LocalStore(get()) }
    single<TmdbClient> {
        val store = get<LocalStore>()
        KtorTmdbClient(get(), TMDB_API_KEY) { store.simulation() }
    }
    single { GuestRatings(get(), get()) }
    viewModelOf(::PopularViewModel)
    viewModelOf(::SearchViewModel)
    // The film id comes from the details route: koinViewModel { parametersOf(id) }.
    viewModel { (id: Int) -> DetailsViewModel(id, get()) }
    viewModel { (id: Int) -> RatingViewModel(id, get()) }
    viewModelOf(::SettingsViewModel)
}

/**
 * [platformModule] provides the platform's `KeyValueStorage`; it is required so no platform can forget it.
 * The apps call `initKoinAndroid` / `initKoinIos`, which own their platform's bindings.
 */
internal fun initKoin(platformModule: Module) {
    startKoin {
        modules(platformModule, appModule)
    }
}
