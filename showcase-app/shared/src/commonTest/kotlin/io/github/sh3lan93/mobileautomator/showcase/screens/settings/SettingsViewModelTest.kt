package io.github.sh3lan93.mobileautomator.showcase.screens.settings

import io.github.sh3lan93.mobileautomator.showcase.data.Simulation
import io.github.sh3lan93.mobileautomator.showcase.store.InMemoryKeyValueStorage
import io.github.sh3lan93.mobileautomator.showcase.store.LocalStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SettingsViewModelTest {

    private val storage = InMemoryKeyValueStorage()
    private val store = LocalStore(storage)
    private val vm = SettingsViewModel(store)

    @Test
    fun startsWithBothSwitchesOff() {
        assertEquals(Simulation(), vm.simulation.value)
    }

    @Test
    fun setSimulateOffline_updatesSimulation() {
        vm.setSimulateOffline(true)
        assertEquals(Simulation(offline = true), vm.simulation.value)
        vm.setSimulateOffline(false)
        assertEquals(Simulation(), vm.simulation.value)
    }

    @Test
    fun setSimulateServerError_updatesSimulation() {
        vm.setSimulateServerError(true)
        assertEquals(Simulation(serverError = true), vm.simulation.value)
        vm.setSimulateServerError(false)
        assertEquals(Simulation(), vm.simulation.value)
    }

    @Test
    fun toggling_persistsToTheStore() {
        vm.setSimulateOffline(true)
        assertEquals(Simulation(offline = true), LocalStore(storage).simulation.value)
    }

    @Test
    fun resetAppData_turnsBothOff_andClearsStorage() {
        vm.setSimulateOffline(true)
        vm.setSimulateServerError(true)
        vm.resetAppData()
        assertEquals(Simulation(), vm.simulation.value)
        assertTrue(storage.keys().isEmpty(), "storage still holds ${storage.keys()}")
        assertEquals(Simulation(), LocalStore(storage).simulation.value)
    }
}
