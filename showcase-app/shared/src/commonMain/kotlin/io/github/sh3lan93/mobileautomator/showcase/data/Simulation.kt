package io.github.sh3lan93.mobileautomator.showcase.data

/** Failure switches from Settings; while one is on, the client answers without sending a request. */
data class Simulation(val offline: Boolean = false, val serverError: Boolean = false)
