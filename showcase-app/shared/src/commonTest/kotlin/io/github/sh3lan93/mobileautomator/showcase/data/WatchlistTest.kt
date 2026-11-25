package io.github.sh3lan93.mobileautomator.showcase.data

import io.github.sh3lan93.mobileautomator.showcase.store.InMemoryKeyValueStorage
import io.github.sh3lan93.mobileautomator.showcase.store.LocalStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WatchlistTest {

    private val store = LocalStore(InMemoryKeyValueStorage())
    private val watchlist = Watchlist(store)

    private val shawshank = Movie(278, "The Shawshank Redemption", "1994", "https://image.tmdb.org/t/p/w154/a.jpg")
    private val fightClub = Movie(550, "Fight Club", null, null)
    private val godfather = Movie(238, "The Godfather", "1972", null)

    @Test
    fun add_thenListed() {
        watchlist.add(shawshank)
        assertEquals(listOf(shawshank), watchlist.films.value)
    }

    @Test
    fun addTwice_keepsOne() {
        watchlist.add(shawshank)
        watchlist.add(shawshank)
        assertEquals(listOf(shawshank), watchlist.films.value)
    }

    @Test
    fun remove_dropsOnlyThatFilm() {
        watchlist.add(shawshank)
        watchlist.add(fightClub)
        watchlist.add(godfather)
        watchlist.remove(fightClub.id)
        assertEquals(listOf(shawshank, godfather), watchlist.films.value)
    }

    @Test
    fun remove_notSaved_noChange() {
        watchlist.add(shawshank)
        watchlist.remove(fightClub.id)
        assertEquals(listOf(shawshank), watchlist.films.value)
    }

    @Test
    fun contains_followsAddAndRemove() {
        val saved = watchlist.contains(shawshank.id)
        assertFalse(saved.value)
        watchlist.add(shawshank)
        assertTrue(saved.value)
        watchlist.remove(shawshank.id)
        assertFalse(saved.value)
    }

    @Test
    fun order_isOldestFirst() {
        watchlist.add(godfather)
        watchlist.add(shawshank)
        watchlist.add(fightClub)
        assertEquals(listOf(godfather, shawshank, fightClub), watchlist.films.value)
    }

    @Test
    fun reset_emptiesFilms() {
        watchlist.add(shawshank)
        val saved = watchlist.contains(shawshank.id)
        store.reset()
        assertEquals(emptyList(), watchlist.films.value)
        assertFalse(saved.value)
    }
}
