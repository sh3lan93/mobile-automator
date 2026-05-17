import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:sample_shop/data/product_repository.dart';
import 'package:sample_shop/state/cart_model.dart';
import 'package:sample_shop/state/favorites_model.dart';
import 'package:sample_shop/ui/screens/product_detail_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('add to cart + favorite via button and double-tap',
      (tester) async {
    final repo = ProductRepository();
    await repo.load();
    final cart = CartModel();
    final favs = FavoritesModel();

    await tester.pumpWidget(MultiProvider(
      providers: [
        Provider<ProductRepository>.value(value: repo),
        ChangeNotifierProvider<CartModel>.value(value: cart),
        ChangeNotifierProvider<FavoritesModel>.value(value: favs),
      ],
      child: const MaterialApp(
          home: ProductDetailScreen(productId: 'p001')),
    ));
    await tester.pumpAndSettle();

    await tester.tap(find.bySemanticsIdentifier('product_stepper_qty_inc'));
    await tester.pump();
    await tester.tap(find.bySemanticsIdentifier('product_button_add_to_cart'));
    await tester.pump();
    expect(cart.totalItems, 2);

    expect(favs.isFavorite('p001'), isFalse);
    await tester.tap(find.bySemanticsIdentifier('product_button_favorite'));
    await tester.pump();
    expect(favs.isFavorite('p001'), isTrue);

    await tester.tap(find.bySemanticsIdentifier('product_image'));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.tap(find.bySemanticsIdentifier('product_image'));
    await tester.pumpAndSettle();
    expect(favs.isFavorite('p001'), isFalse);
  });
}
