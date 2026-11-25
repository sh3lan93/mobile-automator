package io.github.sh3lan93.mobileautomator.showcase.data

import io.github.sh3lan93.mobileautomator.showcase.store.InMemoryKeyValueStorage
import io.github.sh3lan93.mobileautomator.showcase.store.LocalStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
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
    fun add_thenListed() = runTest {
        watchlist.add(shawshank)
        assertEquals(listOf(shawshank), watchlist.films.first())
    }

    @Test
    fun addTwice_keepsOne() = runTest {
        watchlist.add(shawshank)
        watchlist.add(shawshank)
        assertEquals(listOf(shawshank), watchlist.films.first())
    }

    @Test
    fun remove_dropsOnlyThatFilm() = runTest {
        watchlist.add(shawshank)
        watchlist.add(fightClub)
        watchlist.add(godfather)
        watchlist.remove(fightClub.id)
        assertEquals(listOf(shawshank, godfather), watchlist.films.first())
    }

    @Test
    fun remove_notSaved_noChange() = runTest {
        watchlist.add(shawshank)
        watchlist.remove(fightClub.id)
        assertEquals(listOf(shawshank), watchlist.films.first())
    }

    @Test
    fun contains_followsAddAndRemove() = runTest {
        val saved = watchlist.contains(shawshank.id)
        assertFalse(saved.first())
        watchlist.add(shawshank)
        assertTrue(saved.first())
        watchlist.remove(shawshank.id)
        assertFalse(saved.first())
    }

    @Test
    fun order_isOldestFirst() = runTest {
        watchlist.add(godfather)
        watchlist.add(shawshank)
        watchlist.add(fightClub)
        assertEquals(listOf(godfather, shawshank, fightClub), watchlist.films.first())
    }

    @Test
    fun reset_emptiesFilms() = runTest {
        watchlist.add(shawshank)
        val saved = watchlist.contains(shawshank.id)
        store.reset()
        assertEquals(emptyList(), watchlist.films.first())
        assertFalse(saved.first())
    }
}
