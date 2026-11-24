package io.github.sh3lan93.mobileautomator.showcase.di

import io.github.sh3lan93.mobileautomator.showcase.store.KeyValueStorage
import io.github.sh3lan93.mobileautomator.showcase.store.UserDefaultsStorage
import org.koin.dsl.module
import platform.Foundation.NSUserDefaults

/** Called from Swift; a dedicated suite keeps reset away from anything outside the app's own data. */
fun initKoinIos() = initKoin(
    module {
        single<KeyValueStorage> {
            UserDefaultsStorage(NSUserDefaults(suiteName = "io.github.sh3lan93.mobileautomator.showcase.store"))
        }
    },
)
