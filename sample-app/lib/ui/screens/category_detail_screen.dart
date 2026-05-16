import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:sample_shop/data/product_repository.dart';
import 'package:sample_shop/ui/screens/product_detail_screen.dart';
import 'package:sample_shop/ui/widgets/product_card.dart';

class CategoryDetailScreen extends StatelessWidget {
  const CategoryDetailScreen(
      {super.key, required this.slug, required this.title});

  final String slug;
  final String title;

  @override
  Widget build(BuildContext context) {
    final products = context.read<ProductRepository>().byCategory(slug);
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: GridView.builder(
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2, childAspectRatio: 0.75),
        itemCount: products.length,
        itemBuilder: (context, i) {
          final p = products[i];
          return ProductCard(
            product: p,
            semanticsId: 'category_detail_product_card_${p.id}',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                  builder: (_) =>
                      ProductDetailScreen(productId: p.id)),
            ),
          );
        },
      ),
    );
  }
}
