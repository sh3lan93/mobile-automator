import 'package:flutter_test/flutter_test.dart';
import 'package:sample_shop/state/favorites_model.dart';

void main() {
  test('toggle flips membership and notifies', () {
    final favs = FavoritesModel();
    var notified = 0;
    favs.addListener(() => notified++);

    expect(favs.isFavorite('p001'), isFalse);
    favs.toggle('p001');
    expect(favs.isFavorite('p001'), isTrue);
    favs.toggle('p001');
    expect(favs.isFavorite('p001'), isFalse);
    expect(notified, 2);
  });
}
