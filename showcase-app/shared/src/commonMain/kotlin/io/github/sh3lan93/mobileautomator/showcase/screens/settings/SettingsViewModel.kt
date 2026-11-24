package io.github.sh3lan93.mobileautomator.showcase.screens.settings

import androidx.lifecycle.ViewModel
import io.github.sh3lan93.mobileautomator.showcase.store.LocalStore
import kotlinx.coroutines.flow.StateFlow

/** The simulation switches and Reset app data; all state lives in [LocalStore]. */
class SettingsViewModel(private val store: LocalStore) : ViewModel() {

    val simulateOffline: StateFlow<Boolean> = store.simulateOffline.value

    val simulateServerError: StateFlow<Boolean> = store.simulateServerError.value

    fun setSimulateOffline(on: Boolean) = store.simulateOffline.set(on)

    fun setSimulateServerError(on: Boolean) = store.simulateServerError.set(on)

    /** Clears the store; the screen then navigates to the start with the back stack cleared. */
    fun resetAppData() = store.reset()
}
