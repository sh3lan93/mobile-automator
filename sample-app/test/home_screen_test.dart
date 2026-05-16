import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:sample_shop/data/product_repository.dart';
import 'package:sample_shop/state/cart_model.dart';
import 'package:sample_shop/state/favorites_model.dart';
import 'package:sample_shop/ui/screens/home_screen.dart';

Future<ProductRepository> _repo() async {
  final r = ProductRepository();
  await r.load();
  return r;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('renders featured carousel and product grid', (tester) async {
    final repo = await _repo();
    await tester.pumpWidget(MultiProvider(
      providers: [
        Provider<ProductRepository>.value(value: repo),
        ChangeNotifierProvider(create: (_) => CartModel()),
        ChangeNotifierProvider(create: (_) => FavoritesModel()),
      ],
      child: const MaterialApp(home: Scaffold(body: HomeScreen())),
    ));
    await tester.pumpAndSettle();

    expect(find.bySemanticsIdentifier('home_carousel_featured'),
        findsOneWidget);
    expect(find.bySemanticsIdentifier('home_product_card_p001'),
        findsOneWidget);
  });
}
