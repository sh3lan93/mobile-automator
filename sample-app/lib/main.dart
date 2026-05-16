import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:sample_shop/data/product_repository.dart';
import 'package:sample_shop/state/cart_model.dart';
import 'package:sample_shop/state/favorites_model.dart';
import 'package:sample_shop/ui/root_scaffold.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final repo = ProductRepository();
  await repo.load();
  runApp(SampleShopApp(repository: repo));
}

class SampleShopApp extends StatelessWidget {
  const SampleShopApp({super.key, required this.repository});
  final ProductRepository repository;

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<ProductRepository>.value(value: repository),
        ChangeNotifierProvider(create: (_) => CartModel()),
        ChangeNotifierProvider(create: (_) => FavoritesModel()),
      ],
      child: MaterialApp(
        title: 'Sample Shop',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(useMaterial3: true, colorSchemeSeed: Colors.indigo),
        home: const RootScaffold(),
      ),
    );
  }
}
