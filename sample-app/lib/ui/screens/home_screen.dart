import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:sample_shop/data/product_repository.dart';
import 'package:sample_shop/ui/screens/product_detail_screen.dart';
import 'package:sample_shop/ui/widgets/product_card.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final repo = context.read<ProductRepository>();
    final featured = repo.featured();
    final all = repo.products;

    return CustomScrollView(
      slivers: [
        SliverToBoxAdapter(
          child: Semantics(
            identifier: 'home_carousel_featured',
            child: SizedBox(
              height: 160,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                itemCount: featured.length,
                itemBuilder: (context, i) {
                  final p = featured[i];
                  return Semantics(
                    identifier: 'home_carousel_item_${p.id}',
                    button: true,
                    child: SizedBox(
                      width: 140,
                      child: ClipRect(
                        child: OverflowBox(
                          alignment: Alignment.topCenter,
                          maxHeight: double.infinity,
                          child: ProductCard(
                            product: p,
                            semanticsId: 'home_carousel_card_${p.id}',
                            onTap: () => _open(context, p.id),
                          ),
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
        ),
        SliverGrid(
          gridDelegate:
              const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 2, childAspectRatio: 0.75),
          delegate: SliverChildBuilderDelegate(
            (context, i) {
              final p = all[i];
              return ProductCard(
                product: p,
                semanticsId: 'home_product_card_${p.id}',
                onTap: () => _open(context, p.id),
              );
            },
            childCount: all.length,
          ),
        ),
      ],
    );
  }

  void _open(BuildContext context, String id) {
    Navigator.of(context).push(MaterialPageRoute<void>(
        builder: (_) => ProductDetailScreen(productId: id)));
  }
}
