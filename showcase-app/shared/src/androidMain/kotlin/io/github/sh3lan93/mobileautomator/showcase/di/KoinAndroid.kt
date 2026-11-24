package io.github.sh3lan93.mobileautomator.showcase.di

import android.content.Context
import io.github.sh3lan93.mobileautomator.showcase.store.KeyValueStorage
import io.github.sh3lan93.mobileautomator.showcase.store.SharedPreferencesStorage
import org.koin.dsl.module

/** Called from the Android app; a dedicated preferences file keeps reset away from anything outside the app's own data. */
fun initKoinAndroid(context: Context) = initKoin(
    module {
        single<KeyValueStorage> {
            SharedPreferencesStorage(context.applicationContext.getSharedPreferences("reel_tracker_store", Context.MODE_PRIVATE))
        }
    },
)
