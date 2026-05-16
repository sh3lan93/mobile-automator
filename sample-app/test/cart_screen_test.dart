import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:sample_shop/models/product.dart';
import 'package:sample_shop/state/cart_model.dart';
import 'package:sample_shop/ui/screens/cart_screen.dart';

const _p = Product(
    id: 'p001',
    title: 'Wireless Earbuds',
    price: 10.0,
    categorySlug: 'electronics',
    featured: true);

Widget _host(CartModel cart) => ChangeNotifierProvider<CartModel>.value(
      value: cart,
      child: const MaterialApp(home: CartScreen()),
    );

void main() {
  testWidgets('empty state shows label, hides checkout', (tester) async {
    await tester.pumpWidget(_host(CartModel()));
    await tester.pumpAndSettle();
    expect(find.bySemanticsIdentifier('cart_empty_label'), findsOneWidget);
    expect(find.bySemanticsIdentifier('cart_button_checkout'), findsNothing);
  });

  testWidgets('long-press → confirm removes item', (tester) async {
    final cart = CartModel()..add(_p);
    await tester.pumpWidget(_host(cart));
    await tester.pumpAndSettle();

    expect(find.bySemanticsIdentifier('cart_item_p001'), findsOneWidget);
    await tester.longPress(find.bySemanticsIdentifier('cart_item_p001'));
    await tester.pumpAndSettle();
    await tester.tap(find.bySemanticsIdentifier('cart_dialog_remove_confirm'));
    await tester.pumpAndSettle();
    expect(cart.isEmpty, isTrue);
  });

  testWidgets('checkout clears cart and routes to confirmation',
      (tester) async {
    final cart = CartModel()..add(_p);
    await tester.pumpWidget(_host(cart));
    await tester.pumpAndSettle();

    await tester.tap(find.bySemanticsIdentifier('cart_button_checkout'));
    await tester.pumpAndSettle();
    expect(
        find.bySemanticsIdentifier('order_confirmation_label'), findsOneWidget);
    expect(cart.isEmpty, isTrue);
  });
}
