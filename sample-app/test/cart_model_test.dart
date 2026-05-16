import 'package:flutter_test/flutter_test.dart';
import 'package:sample_shop/models/product.dart';
import 'package:sample_shop/state/cart_model.dart';

const _p = Product(
    id: 'p001',
    title: 'Wireless Earbuds',
    price: 10.0,
    categorySlug: 'electronics',
    featured: true);

void main() {
  test('add increases count and total; remove + clear work', () {
    final cart = CartModel();
    var notified = 0;
    cart.addListener(() => notified++);

    cart.add(_p, qty: 2);
    expect(cart.totalItems, 2);
    expect(cart.totalPrice, 20.0);
    expect(cart.contains('p001'), isTrue);
    expect(notified, 1);

    cart.remove('p001');
    expect(cart.totalItems, 0);
    expect(cart.isEmpty, isTrue);

    cart.add(_p, qty: 1);
    cart.clear();
    expect(cart.isEmpty, isTrue);
    expect(notified, 4);
  });
}
