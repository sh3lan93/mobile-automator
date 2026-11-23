package io.github.sh3lan93.mobileautomator.showcase

import android.app.Application
import io.github.sh3lan93.mobileautomator.showcase.di.initKoin

class ShowcaseApp : Application() {
    override fun onCreate() {
        super.onCreate()
        initKoin()
    }
}
