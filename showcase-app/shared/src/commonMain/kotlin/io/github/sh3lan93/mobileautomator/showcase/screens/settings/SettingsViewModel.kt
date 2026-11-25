package io.github.sh3lan93.mobileautomator.showcase.screens.settings

import androidx.lifecycle.ViewModel
import io.github.sh3lan93.mobileautomator.showcase.store.LocalStore
import kotlinx.coroutines.flow.StateFlow

/** The simulation switches, the feature flags and Reset app data; all state lives in [LocalStore]. */
class SettingsViewModel(private val store: LocalStore) : ViewModel() {

    val simulateOffline: StateFlow<Boolean> = store.simulateOffline.value

    val simulateServerError: StateFlow<Boolean> = store.simulateServerError.value

    fun setSimulateOffline(on: Boolean) = store.simulateOffline.set(on)

    fun setSimulateServerError(on: Boolean) = store.simulateServerError.set(on)

    /** `true` when Details uses the compact layout, `false` for classic. */
    val compactDetails: StateFlow<Boolean> = store.compactDetails.value

    /** `true` when removing from the watchlist asks first, `false` when it removes at once. */
    val confirmWatchlistRemoval: StateFlow<Boolean> = store.confirmWatchlistRemoval.value

    fun setCompactDetails(on: Boolean) = store.compactDetails.set(on)

    fun setConfirmWatchlistRemoval(on: Boolean) = store.confirmWatchlistRemoval.set(on)

    /** Clears the store; the screen then navigates to the start with the back stack cleared. */
    fun resetAppData() = store.reset()
}
