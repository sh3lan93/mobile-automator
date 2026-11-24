package io.github.sh3lan93.mobileautomator.showcase

import android.app.Application
import io.github.sh3lan93.mobileautomator.showcase.di.initKoinAndroid

class ShowcaseApp : Application() {
    override fun onCreate() {
        super.onCreate()
        initKoinAndroid(this)
    }
}
