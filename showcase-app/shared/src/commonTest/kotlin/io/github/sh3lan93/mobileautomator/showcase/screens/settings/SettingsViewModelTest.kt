package io.github.sh3lan93.mobileautomator.showcase.screens.settings

import io.github.sh3lan93.mobileautomator.showcase.data.Simulation
import io.github.sh3lan93.mobileautomator.showcase.store.InMemoryKeyValueStorage
import io.github.sh3lan93.mobileautomator.showcase.store.LocalStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SettingsViewModelTest {

    private val storage = InMemoryKeyValueStorage()
    private val store = LocalStore(storage)
    private val vm = SettingsViewModel(store)

    @Test
    fun startsWithBothSwitchesOff() {
        assertEquals(Simulation(), vm.switches())
    }

    @Test
    fun setSimulateOffline_updatesSimulation() {
        vm.setSimulateOffline(true)
        assertEquals(Simulation(offline = true), vm.switches())
        vm.setSimulateOffline(false)
        assertEquals(Simulation(), vm.switches())
    }

    @Test
    fun setSimulateServerError_updatesSimulation() {
        vm.setSimulateServerError(true)
        assertEquals(Simulation(serverError = true), vm.switches())
        vm.setSimulateServerError(false)
        assertEquals(Simulation(), vm.switches())
    }

    @Test
    fun toggling_persistsToTheStore() {
        vm.setSimulateOffline(true)
        assertEquals(Simulation(offline = true), LocalStore(storage).simulation())
    }

    @Test
    fun resetAppData_turnsBothOff_andClearsStorage() {
        vm.setSimulateOffline(true)
        vm.setSimulateServerError(true)
        vm.resetAppData()
        assertEquals(Simulation(), vm.switches())
        assertTrue(storage.keys().isEmpty(), "storage still holds ${storage.keys()}")
        assertEquals(Simulation(), LocalStore(storage).simulation())
    }

    @Test
    fun setCompactDetails_updatesStore() {
        assertFalse(vm.compactDetails.value)
        vm.setCompactDetails(true)
        assertTrue(vm.compactDetails.value)
        assertTrue(LocalStore(storage).compactDetails.value.value)
        vm.setCompactDetails(false)
        assertFalse(vm.compactDetails.value)
        assertFalse(LocalStore(storage).compactDetails.value.value)
    }

    @Test
    fun setConfirmRemoval_updatesStore() {
        assertFalse(vm.confirmWatchlistRemoval.value)
        vm.setConfirmWatchlistRemoval(true)
        assertTrue(vm.confirmWatchlistRemoval.value)
        assertTrue(LocalStore(storage).confirmWatchlistRemoval.value.value)
        vm.setConfirmWatchlistRemoval(false)
        assertFalse(vm.confirmWatchlistRemoval.value)
        assertFalse(LocalStore(storage).confirmWatchlistRemoval.value.value)
    }

    @Test
    fun reset_turnsFlagsOff() {
        vm.setCompactDetails(true)
        vm.setConfirmWatchlistRemoval(true)
        vm.resetAppData()
        assertFalse(vm.compactDetails.value)
        assertFalse(vm.confirmWatchlistRemoval.value)
        assertTrue(storage.keys().isEmpty(), "storage still holds ${storage.keys()}")
    }

    private fun SettingsViewModel.switches() = Simulation(simulateOffline.value, simulateServerError.value)
}
