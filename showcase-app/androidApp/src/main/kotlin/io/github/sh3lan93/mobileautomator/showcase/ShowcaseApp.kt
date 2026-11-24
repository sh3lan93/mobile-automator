package io.github.sh3lan93.mobileautomator.showcase

import android.app.Application
import io.github.sh3lan93.mobileautomator.showcase.di.initKoin
import io.github.sh3lan93.mobileautomator.showcase.store.KeyValueStorage
import io.github.sh3lan93.mobileautomator.showcase.store.SharedPreferencesStorage
import org.koin.dsl.module

class ShowcaseApp : Application() {
    override fun onCreate() {
        super.onCreate()
        initKoin(
            module {
                single<KeyValueStorage> {
                    SharedPreferencesStorage(getSharedPreferences("reel_tracker_store", MODE_PRIVATE))
                }
            },
        )
    }
}
