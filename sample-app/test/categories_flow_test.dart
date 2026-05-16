import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:sample_shop/data/product_repository.dart';
import 'package:sample_shop/state/cart_model.dart';
import 'package:sample_shop/state/favorites_model.dart';
import 'package:sample_shop/ui/screens/categories_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('category tap opens detail with filtered products',
      (tester) async {
    final repo = ProductRepository();
    await repo.load();
    await tester.pumpWidget(MultiProvider(
      providers: [
        Provider<ProductRepository>.value(value: repo),
        ChangeNotifierProvider(create: (_) => CartModel()),
        ChangeNotifierProvider(create: (_) => FavoritesModel()),
      ],
      child: const MaterialApp(home: Scaffold(body: CategoriesScreen())),
    ));
    await tester.pumpAndSettle();

    expect(find.bySemanticsIdentifier('categories_list_item_books'),
        findsOneWidget);
    await tester.tap(find.bySemanticsIdentifier('categories_list_item_books'));
    await tester.pumpAndSettle();

    expect(find.bySemanticsIdentifier('category_detail_product_card_p007'),
        findsOneWidget);
  });
}
