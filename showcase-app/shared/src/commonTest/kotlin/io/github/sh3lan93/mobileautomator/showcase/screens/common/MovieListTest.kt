package io.github.sh3lan93.mobileautomator.showcase.screens.common

import kotlin.test.Test
import kotlin.test.assertEquals

class MovieListTest {

    @Test
    fun ratingText_formatsWholeAndHalf() {
        assertEquals("Your rating: 8/10", ratingText(8.0))
        assertEquals("Your rating: 10/10", ratingText(10.0))
        assertEquals("Your rating: 6.5/10", ratingText(6.5))
        assertEquals("Your rating: 0.5/10", ratingText(0.5))
    }
}
